import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors({ origin: (o, cb)=>cb(null,true), methods: ['GET','POST','PATCH','OPTIONS'] }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY   // service key (bypasses RLS for server)
);

const UPLOADS_BUCKET = process.env.EXPO_PUBLIC_UPLOADS_BUCKET || "uploads";

// Dev user the app uses in preview
const DEV_USER = '00000000-0000-0000-0000-000000000001';

// --- Health ---
app.get('/health', (req, res) => res.json({ ok: true, status: 'healthy' }));
app.get('/', (req, res) => res.json({
  message: 'Server is running',
  status: 'ready',
  base: 'v1'
}));

// --- Entitlements (stub for Free/Casual/Pro gating) ---
function entitlementsHandler(req, res) {
  // Return a consistent shape the app expects
  res.json({ ok: true, tier: 'Free', remaining: 5, quota: 5 });
}
app.get('/api/me/entitlements/:user_id', entitlementsHandler);
app.get('/me/entitlements/:user_id', entitlementsHandler);

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
app.post('/api/projects', async (req, res) => {
  try {
    const { user_id, name, input_image_url } = req.body || {};
    const insert = {
      user_id: user_id || '00000000-0000-0000-0000-000000000001',
      name: name || 'Untitled',
      status: 'new',
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
      .update({ input_image_url: publicUrl, status: 'preview_requested' })
      .eq('id', id)
      .select('id, user_id, name, status, input_image_url, preview_url')
      .single();
    if (dbErr) return res.status(500).json({ ok:false, error: dbErr.message });

    return res.json({ ok:true, item: data, url: publicUrl });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Projects: REQUEST PREVIEW (kick off) ---
app.post('/api/projects/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    // mark requested
    let { error } = await supabase
      .from('projects')
      .update({ status: 'preview_requested' })
      .eq('id', id);
    if (error) throw error;

    // simulate generation: flip to ready after 6s
    setTimeout(async () => {
      await supabase
        .from('projects')
        .update({ status: 'preview_ready', preview_url: picsum(id) })
        .eq('id', id);
    }, 6000);

    res.json({ ok: true, id, status: 'preview_requested' });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// ---- Build plan WITHOUT preview ----
// POST /api/projects/:id/build-without-preview
app.post('/api/projects/:id/build-without-preview', async (req, res) => {
  const { id } = req.params;

  try {
    // (Optional) you can pull other fields out of req.body if you want
    // const { user_id, description, budget, skill_level } = req.body;

    // Mark plan as ready (no AI image preview step)
    const { data, error } = await supabase
      .from('projects')
      .update({
        status: 'plan_ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Return a simple placeholder "plan" so the UI can continue
    res.json({
      ok: true,
      project: data,
      plan: {
        summary: 'Plan generated without AI preview.',
        steps: [
          { title: 'Measure & mark', minutes: 10 },
          { title: 'Find studs', minutes: 10 },
          { title: 'Drill anchors', minutes: 15 },
          { title: 'Mount shelves', minutes: 20 },
        ],
      },
    });
  } catch (err) {
    console.error('build-without-preview error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
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
