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
  // Get tier from profiles (auto-create if doesn't exist)
  let { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('plan_tier')
    .eq('user_id', userId)
    .single();

  // If user doesn't exist, create them with free tier
  if (profErr && profErr.code === 'PGRST116') {
    const { data: newProf } = await supabase
      .from('profiles')
      .insert({ user_id: userId, plan_tier: 'free' })
      .select('plan_tier')
      .single();
    prof = newProf;
    profErr = null;
  }

  if (profErr) {
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

// --- Feature Flags -----------------------------------------------------------
const PREVIEW_PROVIDER = process.env.PREVIEW_PROVIDER || 'stub'; // 'decor8' or 'stub'
const PLAN_PROVIDER = process.env.PLAN_PROVIDER || 'stub';       // 'openai' or 'stub'

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

// --- OpenAI helpers ----------------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callOpenAIGeneratePlan({ description, budget, skill_level }) {
  const prompt = `Generate a detailed DIY project plan in JSON format for the following:
Description: ${description}
Budget: ${budget}
Skill Level: ${skill_level}

Return a JSON object with this structure:
{
  "title": "Project Title",
  "materials": ["item1", "item2", ...],
  "tools": ["tool1", "tool2", ...],
  "steps": [
    {"step": 1, "title": "Step title", "description": "Step details"},
    ...
  ],
  "estimatedTime": "X hours",
  "difficulty": "beginner|intermediate|advanced"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a DIY project planning assistant. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });

  const data = await res.json();
  
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');
  
  return JSON.parse(content);
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

// POST /api/projects/:id/image  (accepts multipart file/image OR direct_url)
app.post('/api/projects/:id/image', upload.any(), async (req, res) => {
  try {
    const { id } = req.params;
    const { direct_url } = req.body || {};
    let publicUrl;

    // Handle direct_url (no upload needed)
    if (direct_url) {
      publicUrl = direct_url;
    } 
    // Handle file upload (support both 'file' and 'image' field names)
    else if (req.files && req.files.length > 0) {
      const req_file = req.files[0];
      const ext = (req_file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
      const path = `projects/${id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase
        .storage.from(UPLOADS_BUCKET)
        .upload(path, req_file.buffer, { contentType: req_file.mimetype, upsert: true });
      if (upErr) return res.status(500).json({ ok:false, error: upErr.message });

      const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
      publicUrl = pub?.publicUrl;
    } 
    else if (req.file) {
      const ext = (req.file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
      const path = `projects/${id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase
        .storage.from(UPLOADS_BUCKET)
        .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (upErr) return res.status(500).json({ ok:false, error: upErr.message });

      const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
      publicUrl = pub?.publicUrl;
    } 
    else {
      return res.status(400).json({ ok:false, error:'missing_file_or_direct_url' });
    }

    // Update project with image URL (NO auto-actions)
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
    const { room_type, design_style } = req.body || {};

    // Validate project exists and has image
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, input_image_url')
      .eq('id', id)
      .single();

    if (pErr || !project) {
      return res.status(404).json({ ok:false, error: 'project_not_found' });
    }
    if (!project.input_image_url) {
      return res.status(422).json({ ok:false, error: 'missing_input_image_url' });
    }

    // Mark preview requested
    await supabase.from('projects')
      .update({ status: 'preview_requested' })
      .eq('id', id);

    // Return immediately
    res.json({ ok:true });

    // Background processing with provider selection
    (async () => {
      try {
        let preview_url = project.input_image_url; // Default fallback
        let useStubDelay = false;

        if (PREVIEW_PROVIDER === 'decor8' && DECOR8_API_KEY) {
          try {
            console.log(`[Preview] Calling Decor8 for project ${id}`);
            const result = await callDecor8Generate({
              input_image_url: project.input_image_url,
              room_type: room_type || 'livingroom',
              design_style: design_style || 'modern'
            });
            
            // Extract preview URL from Decor8 response
            if (result?.info?.images?.[0]) {
              preview_url = result.info.images[0];
              console.log(`[Preview] Decor8 success for ${id}: ${preview_url}`);
            }
          } catch (decor8Err) {
            console.error(`[Preview] Decor8 failed for ${id}, falling back to stub:`, decor8Err.message);
            useStubDelay = true;
          }
        } else {
          console.log(`[Preview] Using stub for ${id} (provider: ${PREVIEW_PROVIDER})`);
          useStubDelay = true;
        }

        // Apply stub delay for fallback or stub mode
        if (useStubDelay) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Update to preview_ready
        await supabase.from('projects')
          .update({ 
            status: 'preview_ready',
            preview_url
          })
          .eq('id', id);
        
        console.log(`[Preview] Completed for ${id}`);
      } catch (bgErr) {
        console.error(`[Preview] Background error for ${id}:`, bgErr);
        // Set to error state
        await supabase.from('projects')
          .update({ status: 'preview_error' })
          .eq('id', id);
      }
    })();

  } catch (err) {
    console.error('[Preview] error:', err);
    return res.status(500).json({ ok:false, error: String(err.message || err) });
  }
});

// --- Build without preview route --------------------------------------------
// POST /api/projects/:id/build-without-preview
app.post('/api/projects/:id/build-without-preview', requireQuota, async (req, res) => {
  try {
    const { id } = req.params;
    const { description, budget, skill_level } = req.body || {};

    // Get project details
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', id)
      .single();

    if (pErr || !project) {
      return res.status(404).json({ ok:false, error: 'project_not_found' });
    }

    // Mark plan requested
    await supabase.from('projects')
      .update({ status: 'plan_requested' })
      .eq('id', id);

    // Return immediately
    res.json({ ok:true });

    // Background processing with provider selection
    (async () => {
      try {
        let planData = null;
        let useStubDelay = false;

        if (PLAN_PROVIDER === 'openai' && OPENAI_API_KEY) {
          try {
            console.log(`[Plan] Calling OpenAI for project ${id}`);
            planData = await callOpenAIGeneratePlan({
              description: description || project.name || 'DIY project',
              budget: budget || 'medium',
              skill_level: skill_level || 'beginner'
            });
            console.log(`[Plan] OpenAI success for ${id}`);
          } catch (openaiErr) {
            console.error(`[Plan] OpenAI failed for ${id}, falling back to stub:`, openaiErr.message);
            useStubDelay = true;
          }
        } else {
          console.log(`[Plan] Using stub for ${id} (provider: ${PLAN_PROVIDER})`);
          useStubDelay = true;
        }

        // Apply stub delay for fallback or stub mode
        if (useStubDelay) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Update to plan_ready with optional plan data
        const updateData = { status: 'plan_ready' };
        if (planData) {
          updateData.plan_json = planData;
        }

        await supabase.from('projects')
          .update(updateData)
          .eq('id', id);
        
        console.log(`[Plan] Completed for ${id}`);
      } catch (bgErr) {
        console.error(`[Plan] Background error for ${id}:`, bgErr);
        // Set to error state
        await supabase.from('projects')
          .update({ status: 'plan_error' })
          .eq('id', id);
      }
    })();

  } catch (err) {
    console.error('[build-without-preview] error:', err);
    return res.status(500).json({ ok:false, error:'build_without_preview_failed' });
  }
});

// --- Projects: DELETE ---
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
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
