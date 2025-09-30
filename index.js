import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors({ origin: (o, cb)=>cb(null,true), methods: ['GET','POST','PATCH','OPTIONS'] }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY   // service key (bypasses RLS for server)
);

const UPLOADS_BUCKET = process.env.EXPO_PUBLIC_UPLOADS_BUCKET || "uploads";

// Dev user the app uses in preview
const DEV_USER = '00000000-0000-0000-0000-000000000001';

// --- ENTITLEMENTS CONFIG ---
const TIER_RULES = {
  free:   { quota: 2,  preview: false },
  casual: { quota: 5,  preview: true  },
  pro:    { quota: 25, preview: true  },
};

async function getEntitlements(supabase, userId) {
  // Get tier from profiles
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('plan_tier')
    .eq('user_id', userId)
    .single();

  if (profErr && profErr.code !== 'PGRST116') {
    // return something sane if RLS or lookup issues
    return { tier: 'free', quota: 2, previewAllowed: false, remaining: 0, error: String(profErr.message || profErr) };
  }

  const tier = (prof && prof.plan_tier) || 'free';
  const rules = TIER_RULES[tier] || TIER_RULES.free;

  // Count user's projects
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const used = count || 0;
  const remaining = Math.max(0, rules.quota - used);

  return {
    tier,
    quota: rules.quota,
    previewAllowed: !!rules.preview,
    remaining
  };
}

// Simple guards
async function requireQuota(req, res, next) {
  try {
    const userId = req.query.user_id || req.body.user_id || req.params.user_id || req.user_id; // be tolerant
    if (!userId) return res.status(400).json({ ok:false, error:'missing_user_id' });

    const ent = await getEntitlements(supabase, userId);
    if (ent.remaining <= 0) return res.status(403).json({ ok:false, error:'quota_exhausted', entitlements: ent });

    req.entitlements = ent;
    req.user_id = userId;
    next();
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}

async function requirePreviewAllowed(req, res, next) {
  try {
    const userId = req.query.user_id || req.body.user_id || req.params.user_id || req.user_id;
    if (!userId) return res.status(400).json({ ok:false, error:'missing_user_id' });

    const ent = await getEntitlements(supabase, userId);
    if (!ent.previewAllowed) return res.status(403).json({ ok:false, error:'preview_not_in_plan', entitlements: ent });

    req.entitlements = ent;
    req.user_id = userId;
    next();
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}

// --- Decor8 helpers ----------------------------------------------------------
const DECOR8_BASE_URL = process.env.DECOR8_BASE_URL || 'https://api.decor8.ai';
const DECOR8_API_KEY  = process.env.DECOR8_API_KEY;

async function callDecor8Generate({ input_image_url, room_type, design_style }) {
  // Minimal, known-good body. Add optional fields later.
  const body = {
    input_image_url,           // MUST be a public URL
    room_type,                 // e.g. "livingroom"
    design_style,              // e.g. "minimalist"
    num_images: 1
  };

  const res = await fetch(`${DECOR8_BASE_URL}/generate_designs_for_room`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DECOR8_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Decor8 ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data; // expected: { error: "", message: "...", info: { images: [...] } }
}

// --- Health ---
app.get('/health', (req, res) => res.json({ ok: true, status: 'healthy' }));
app.get('/', (req, res) => res.json({
  message: 'Server is running',
  status: 'ready',
  base: 'v1'
}));

// --- Entitlements endpoint ---
// GET /me/entitlements/:userId
app.get('/me/entitlements/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ ok:false, error:'missing_user_id' });
    const ent = await getEntitlements(supabase, userId);
    res.json({ ok:true, ...ent });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});
app.get('/api/me/entitlements/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ ok:false, error:'missing_user_id' });
    const ent = await getEntitlements(supabase, userId);
    res.json({ ok:true, ...ent });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// --- Helpers ---
const picsum = seed => `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/800`;

// --- Projects: LIST ---
app.get('/api/projects', async (req, res) => {
  try {
    const user_id = req.query.user_id || DEV_USER;
    const { data, error } = await supabase
      .from('projects')
      .select('id,name,status,input_image_url,preview_url')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, items: data || [] });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Projects: GET ONE ---
app.get('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('projects')
      .select('id,name,status,input_image_url,preview_url')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok:false, error:'not_found' });
    res.json({ ok: true, item: data });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Projects: CREATE ---
app.post('/api/projects', requireQuota, async (req, res) => {
  try {
    const { user_id, name, input_image_url } = req.body || {};
    const insert = {
      user_id: user_id || '00000000-0000-0000-0000-000000000001',
      name: name || 'Untitled',
      status: 'draft',
      input_image_url: input_image_url || null,
      preview_url: null,
    };
    const { data, error } = await supabase
      .from('projects')
      .insert(insert)
      .select('id, user_id, name, status, input_image_url, preview_url')
      .single();
    if (error) return res.status(500).json({ ok:false, error: error.message });
    return res.json({ ok:true, item: data });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// POST /api/projects/:id/image  (field name: "file")
app.post('/api/projects/:id/image', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ ok:false, error:'missing_file' });

    const ext = (req.file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
    const path = `projects/${id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase
      .storage.from(UPLOADS_BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) return res.status(500).json({ ok:false, error: upErr.message });

    const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl;

    const { data, error: dbErr } = await supabase
      .from('projects')
      .update({ input_image_url: publicUrl })
      .eq('id', id)
      .select('id, user_id, name, status, input_image_url, preview_url')
      .single();
    if (dbErr) return res.status(500).json({ ok:false, error: dbErr.message });

    return res.json({ ok:true, item: data, url: publicUrl });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Preview generation route ------------------------------------------------
// POST /api/projects/:id/preview
app.post('/api/projects/:id/preview', requirePreviewAllowed, async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Load project (we expect columns: input_image_url, room_type, design_style)
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, input_image_url, room_type, design_style')
      .eq('id', id)
      .single();

    if (pErr || !project) {
      return res.status(404).json({ ok:false, error: 'project_not_found' });
    }
    if (!project.input_image_url) {
      return res.status(422).json({ ok:false, error: 'missing_input_image_url' });
    }

    // 2) Mark preview requested
    await supabase.from('projects')
      .update({ status: 'preview_requested' })
      .eq('id', id);

    // 3) Call Decor8
    const deco = await callDecor8Generate({
      input_image_url: project.input_image_url,
      room_type: project.room_type || 'livingroom',
      design_style: project.design_style || 'minimalist',
    });

    // 4) Pull first image URL and save
    const preview_url = deco?.info?.images?.[0] || null;

    await supabase.from('projects')
      .update({
        status: preview_url ? 'preview_ready' : 'preview_failed',
        preview_url
      })
      .eq('id', id);

    return res.json({ ok:true, status: preview_url ? 'preview_ready' : 'preview_failed', preview_url, deco });
  } catch (err) {
    console.error('[Decor8] error:', err.status, err.message, err.data || '');
    return res.status(502).json({
      ok:false,
      error: 'decor8_failed',
      detail: err.message,
      provider_status: err.status || 500,
      provider: 'decor8'
    });
  }
});

// --- Build without preview route --------------------------------------------
// POST /api/projects/:id/build-without-preview
app.post('/api/projects/:id/build-without-preview', requireQuota, async (req, res) => {
  try {
    const { id } = req.params;

    // Example: mark requested. You'll hook this into your plan generator next.
    await supabase.from('projects')
      .update({ status: 'plan_requested' })
      .eq('id', id);

    return res.json({ ok:true, status:'plan_requested' });
  } catch (err) {
    console.error('[build-without-preview] error:', err);
    return res.status(500).json({ ok:false, error:'build_without_preview_failed' });
  }
});

// --- Utilities to unstick states ---
app.get('/api/projects/force-ready-all', async (req, res) => {
  try {
    const { user_id } = req.query;
    let q = supabase
      .from('projects')
      .update({ status: 'preview_ready', preview_url: picsum(`bulk-${Date.now()}`) })
      .eq('status', 'preview_requested');
    if (user_id) q = q.eq('user_id', user_id);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

app.get('/api/projects/:id/force-ready', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('projects')
      .update({ status: 'preview_ready', preview_url: picsum(id) })
      .eq('id', id);
    if (error) throw error;
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Listen ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`API on ${PORT}`));
