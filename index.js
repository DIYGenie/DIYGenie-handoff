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

// ====== Provider env ======
const {
  DECOR8_BASE_URL,
  DECOR8_API_KEY,
  DECOR8_PREVIEW_CREATE_PATH = '/v1/preview',
  DECOR8_PREVIEW_STATUS_PATH = '/v1/preview/',
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  PREVIEW_PROVIDER = 'decor8',
  PLAN_PROVIDER = 'openai',
} = process.env;

// Tiny helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Decor8 preview helpers ----------
async function decor8CreatePreview({ image_url, style = 'modern' }) {
  const url = new URL(DECOR8_PREVIEW_CREATE_PATH, DECOR8_BASE_URL).toString();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DECOR8_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image_url, style }),
  });
  if (!resp.ok) throw new Error(`Decor8 create failed: ${await resp.text()}`);
  return resp.json(); // could be {preview_url} or {job_id}
}

async function decor8PollStatus(job_id, { maxMs = 60_000, everyMs = 2000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const url = new URL(`${DECOR8_PREVIEW_STATUS_PATH}${job_id}`, DECOR8_BASE_URL).toString();
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${DECOR8_API_KEY}` }
    });
    if (!r.ok) throw new Error(`Decor8 status failed: ${await r.text()}`);
    const data = await r.json(); // expect {status, preview_url?, error?}
    if (data.status === 'completed' && data.preview_url) return data.preview_url;
    if (data.status === 'failed') throw new Error(data.error || 'Decor8 job failed');
    await sleep(everyMs);
  }
  throw new Error('Decor8 preview timed out');
}

async function runPreviewWithDecor8(projectId, image_url) {
  const out = await decor8CreatePreview({ image_url });
  if (out.preview_url) return out.preview_url;       // synchronous response style
  if (out.job_id) return await decor8PollStatus(out.job_id); // job/polling style
  throw new Error('Unexpected Decor8 response');
}

// ---------- OpenAI plan helper ----------
async function buildPlanWithOpenAI(project) {
  const sys = `You are a renovation planning assistant. 
Return JSON only. Include steps, materials with quantities, tools, estimated hours, and a cost range aligned to the budget tier ($, $$, $$$).`;

  const user = {
    role: 'user',
    content: [
      { type: 'text', text:
`Create a concise step-by-step DIY plan.

Project: ${project.name || ''}
Budget: ${project.budget || ''}
Skill level: ${project.skill_level || ''}

If helpful, reference the room photo URL: ${project.input_image_url || 'N/A'}

Return a JSON object with:
{
  "summary": string,
  "steps": [{ "title": string, "detail": string, "est_hours": number }],
  "materials": [{ "name": string, "qty": string, "approx_cost": number }],
  "tools": [string],
  "total_est_hours": number,
  "cost_range": { "low": number, "high": number }
}`
      }
    ]
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      messages: [
        { role: 'system', content: sys },
        user
      ]
    })
  });
  if (!resp.ok) throw new Error(`OpenAI failed: ${await resp.text()}`);
  const data = await resp.json();
  const txt = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(txt);
}

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

// --- Projects: REQUEST PREVIEW (kick off) ---
app.post('/api/projects/:id/preview', async (req, res) => {
  const { id } = req.params;
  try {
    // Mark requested
    await supabase.from('projects').update({ status: 'preview_requested' }).eq('id', id);
    res.status(202).json({ ok: true });

    // Fire & forget worker
    (async () => {
      try {
        const { data: p, error: pe } = await supabase.from('projects')
          .select('id, input_image_url').eq('id', id).single();
        if (pe) throw pe;
        if (!p?.input_image_url) throw new Error('No image_url on project');

        let previewUrl;
        switch (PREVIEW_PROVIDER) {
          case 'decor8':
          default:
            previewUrl = await runPreviewWithDecor8(id, p.input_image_url);
            break;
        }

        await supabase.from('projects')
          .update({ status: 'preview_ready', preview_url: previewUrl })
          .eq('id', id);
      } catch (err) {
        console.error('Preview worker failed:', err);
        await supabase.from('projects').update({ status: 'failed' }).eq('id', id);
      }
    })();

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// build-without-preview (NEW)
app.post('/api/projects/:id/build-without-preview', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: proj, error: pe } = await supabase.from('projects')
      .select('id, name, budget, skill_level, input_image_url')
      .eq('id', id).single();
    if (pe) throw pe;

    let plan;
    switch (PLAN_PROVIDER) {
      case 'openai':
      default:
        plan = await buildPlanWithOpenAI(proj);
        break;
    }

    const { error: ue } = await supabase.from('projects')
      .update({ status: 'planning', plan_json: plan })
      .eq('id', id);
    if (ue) throw ue;

    res.json({ ok: true, plan });
  } catch (err) {
    console.error(err);
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
