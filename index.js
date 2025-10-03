import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const app = express();
app.use(cors({ origin: (o, cb)=>cb(null,true), methods: ['GET','POST','PATCH','OPTIONS'] }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

// Fail fast if Supabase service role key is missing
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[FATAL] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('[FATAL] SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING');
  console.error('[FATAL] SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'set' : 'MISSING');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  console.warn('[WARN] Running in dev mode without service key - operations may fail');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
console.log('[INIT] Supabase client created with service role key');

const UPLOADS_BUCKET = process.env.EXPO_PUBLIC_UPLOADS_BUCKET || "uploads";

// Stripe initialization (optional, only if key is present)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('[INIT] Stripe initialized');
} else {
  console.warn('[WARN] STRIPE_SECRET_KEY not set - billing endpoints will return errors');
}

// Dev user the app uses in preview
const DEV_USER = '00000000-0000-0000-0000-000000000001';

// Utility to compute base URL for redirect fallbacks
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

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

// Middleware to check preview/build quota (for preview and build endpoints only)
async function requirePreviewOrBuildQuota(req, res, next) {
  try {
    let userId = req.query.user_id || req.body.user_id || req.params.user_id || req.user_id;
    
    // Handle "auto" user_id - create temporary user with valid UUID
    if (userId === 'auto') {
      // Generate valid UUID v4
      userId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      req.user_id = userId;
      // Auto-create profile with free tier
      await supabase.from('profiles').insert({ user_id: userId, plan_tier: 'free' }).select().single();
    }
    
    if (!userId) {
      console.log('[ERROR] missing_user_id - body:', JSON.stringify(req.body || {}));
      return res.status(400).json({ ok:false, error:'missing_user_id' });
    }

    const ent = await getEntitlements(supabase, userId);
    
    // Check if preview is allowed (for preview endpoint)
    if (!ent.previewAllowed) {
      return res.status(403).json({ ok:false, error:'upgrade_required' });
    }
    
    // Check if quota remaining (for both preview and build)
    if (ent.remaining <= 0) {
      return res.status(403).json({ ok:false, error:'upgrade_required' });
    }

    req.entitlements = ent;
    req.user_id = userId;
    next();
  } catch (e) {
    console.log('[ERROR] requirePreviewOrBuildQuota:', e.message);
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

// GET /me/entitlements (query param version)
app.get('/me/entitlements', async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id_required' });
    const ent = await getEntitlements(supabase, userId);
    res.json({ ok:true, ...ent });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// --- Billing endpoints ---
// POST /api/billing/checkout - Create Stripe checkout session
app.post('/api/billing/checkout', async (req, res) => {
  try {
    const { tier, user_id } = req.body || {};
    
    if (!tier || !['casual', 'pro'].includes(tier)) {
      return res.status(404).json({ ok: false, error: 'unknown_tier' });
    }

    const priceId = tier === 'pro' ? process.env.PRO_PRICE_ID : process.env.CASUAL_PRICE_ID;
    
    if (!priceId) {
      return res.status(500).json({ ok: false, error: 'missing_price_id' });
    }

    const base = getBaseUrl(req);
    const success_url = process.env.SUCCESS_URL || `${base}/billing/success`;
    const cancel_url = process.env.CANCEL_URL || `${base}/billing/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      client_reference_id: user_id || 'anon',
      metadata: { user_id: user_id || 'anon', tier },
      subscription_data: { metadata: { user_id: user_id || 'anon', tier } },
    });

    console.info('[billing] checkout created', { tier, user_id, url: session.url });
    return res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error('[billing] checkout error', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// POST /api/billing/portal - Create Stripe billing portal session
app.post('/api/billing/portal', async (req, res) => {
  try {
    const { user_id, customer_id } = req.body || {};
    let customerId = (customer_id || '').trim();

    // Look up by user_id if customer_id not provided
    if (!customerId && user_id) {
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('user_id', user_id)
        .maybeSingle();
      if (error) throw error;
      customerId = (prof && prof.stripe_customer_id) ? String(prof.stripe_customer_id).trim() : '';
    }

    if (!customerId) {
      console.info('[billing] portal: no customer id', { user_id });
      return res.status(501).json({ ok: false, error: 'no_customer' });
    }

    const base = getBaseUrl(req);
    const return_url = process.env.PORTAL_RETURN_URL || `${base}/billing/portal-return`;

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url,
      });
      console.info('[billing] portal session created', { user_id, customerId });
      return res.json({ ok: true, url: session.url });
    } catch (se) {
      // Stripe error handling → map to friendly 501 codes
      const msg = String(se.message || se);
      const code = (se && se.code) ? String(se.code) : '';
      // Common cases: portal not enabled, invalid customer, test/live mismatch, etc.
      if (/portal/i.test(msg) && /enable|configur/i.test(msg)) {
        console.warn('[billing] portal not configured', { code, msg });
        return res.status(501).json({ ok: false, error: 'portal_not_configured' });
      }
      if (/no such customer/i.test(msg) || code === 'resource_missing') {
        console.warn('[billing] invalid customer id', { customerId, msg });
        return res.status(501).json({ ok: false, error: 'invalid_customer' });
      }
      console.error('[billing] portal Stripe error', { code, msg });
      return res.status(501).json({ ok: false, error: 'portal_unavailable' });
    }
  } catch (e) {
    console.error('[billing] portal handler error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// POST /api/billing/upgrade - Dev stub for manual tier upgrades
app.post('/api/billing/upgrade', async (req, res) => {
  try {
    const { tier, user_id } = req.body || {};
    
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'missing_user_id' });
    }

    if (!tier || !['free', 'casual', 'pro'].includes(tier)) {
      return res.status(404).json({ ok: false, error: 'unknown_tier' });
    }

    console.info('[billing] upgrade', { user_id, tier });

    // Upsert: insert if doesn't exist, update if exists
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id, plan_tier: tier }, { onConflict: 'user_id' });

    if (error) {
      console.error('[ERROR] Upgrade failed:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true, tier });
  } catch (e) {
    console.error('[ERROR] Upgrade failed:', e.message);
    res.status(500).json({ ok: false, error: String(e.message || e) });
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
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok:false, error:'not_found' });
    res.json({ ok: true, project: data });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Projects: CREATE ---
// NEVER gated - project creation is always allowed regardless of tier
app.post('/api/projects', async (req, res) => {
  try {
    let { user_id, name, budget, skill } = req.body || {};
    
    // Handle "auto" user_id - create temporary user with valid UUID
    if (user_id === 'auto') {
      // Generate valid UUID v4
      user_id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      // Auto-create profile with free tier
      await supabase.from('profiles').insert({ user_id, plan_tier: 'free' }).select().single();
    }
    
    // Validate name (≥10 chars)
    const trimmedName = (name || '').trim();
    if (trimmedName.length < 10) {
      console.log('[ERROR] Invalid name (must be ≥10 chars):', trimmedName);
      return res.status(400).json({ ok:false, error:'name_must_be_at_least_10_characters' });
    }
    
    const insert = {
      user_id: user_id || '00000000-0000-0000-0000-000000000001',
      name: trimmedName,
      status: 'draft',
      input_image_url: null,
      preview_url: null,
    };
    
    // Add budget and skill if provided (columns may not exist in DB yet)
    if (budget) insert.budget = budget;
    if (skill) insert.skill = skill;
    
    const { data, error } = await supabase
      .from('projects')
      .insert(insert)
      .select()
      .single();
    
    if (error) {
      console.log('[ERROR] Database insert failed:', error.message, error);
      return res.status(500).json({ ok:false, error: error.message });
    }
    
    return res.json({ ok:true, id: data.id });
  } catch (e) {
    console.log('[ERROR] POST /api/projects exception:', e.message);
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
      // Validate it's http(s)
      if (!direct_url.startsWith('http://') && !direct_url.startsWith('https://')) {
        console.log('[ERROR] Invalid direct_url (must be http/https):', direct_url);
        return res.status(400).json({ ok:false, error:'invalid_direct_url_must_be_http_or_https' });
      }
      publicUrl = direct_url;
    } 
    // Handle file upload (support both 'file' and 'image' field names)
    else if (req.files && req.files.length > 0) {
      const req_file = req.files[0];
      
      // Validate it's an image
      if (!req_file.mimetype || !req_file.mimetype.startsWith('image/')) {
        console.log('[ERROR] Invalid file type:', req_file.mimetype);
        return res.status(400).json({ ok:false, error:'invalid_file_type_must_be_image' });
      }
      
      const ext = (req_file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
      const path = `projects/${id}/${Date.now()}.${ext}`;

      // Try to upload to Supabase, fallback to stub URL on error
      const { error: upErr } = await supabase
        .storage.from(UPLOADS_BUCKET)
        .upload(path, req_file.buffer, { contentType: req_file.mimetype, upsert: true });
      
      if (upErr) {
        console.log('[WARN] Supabase upload failed, using stub URL:', upErr.message);
        // Stub fallback - simulate a storage URL
        publicUrl = `https://example.com/stub-uploads/${id}/room-${Date.now()}.${ext}`;
      } else {
        const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
        publicUrl = pub?.publicUrl;
      }
    } 
    else if (req.file) {
      const req_file = req.file;
      
      // Validate it's an image
      if (!req_file.mimetype || !req_file.mimetype.startsWith('image/')) {
        console.log('[ERROR] Invalid file type:', req_file.mimetype);
        return res.status(400).json({ ok:false, error:'invalid_file_type_must_be_image' });
      }
      
      const ext = (req_file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
      const path = `projects/${id}/${Date.now()}.${ext}`;

      // Try to upload to Supabase, fallback to stub URL on error
      const { error: upErr } = await supabase
        .storage.from(UPLOADS_BUCKET)
        .upload(path, req_file.buffer, { contentType: req_file.mimetype, upsert: true });
      
      if (upErr) {
        console.log('[WARN] Supabase upload failed, using stub URL:', upErr.message);
        // Stub fallback - simulate a storage URL
        publicUrl = `https://example.com/stub-uploads/${id}/room-${Date.now()}.${ext}`;
      } else {
        const { data: pub } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(path);
        publicUrl = pub?.publicUrl;
      }
    } 
    else {
      console.log('[ERROR] No file or direct_url provided');
      return res.status(400).json({ ok:false, error:'missing_file_or_direct_url' });
    }

    // Update project with image URL (NO auto-actions, status stays 'draft')
    const { error: dbErr } = await supabase
      .from('projects')
      .update({ input_image_url: publicUrl })
      .eq('id', id);
    
    if (dbErr) {
      console.log('[ERROR] Database update failed:', dbErr.message);
      return res.status(500).json({ ok:false, error: dbErr.message });
    }

    return res.json({ ok:true });
  } catch (e) {
    console.log('[ERROR] Image upload exception:', e.message);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// --- Preview generation route ------------------------------------------------
// POST /api/projects/:id/preview
// Gated by tier - requires previewAllowed and remaining quota
app.post('/api/projects/:id/preview', requirePreviewOrBuildQuota, async (req, res) => {
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
// Gated by tier - requires remaining quota (free tier blocked via previewAllowed check)
app.post('/api/projects/:id/build-without-preview', requirePreviewOrBuildQuota, async (req, res) => {
  try {
    const { id } = req.params;
    const { description, budget, skill_level } = req.body || {};

    // Get project details
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (pErr || !project) {
      return res.status(404).json({ ok:false, error: 'project_not_found' });
    }

    // Mark plan requested (idempotent - skip if already has plan)
    if (!project.plan_json) {
      await supabase.from('projects')
        .update({ status: 'plan_requested' })
        .eq('id', id);
    }

    // Return immediately
    res.json({ ok:true });

    // Background processing with provider selection (skip if already has plan)
    if (!project.plan_json) {
      (async () => {
        try {
          let planData = null;
          let useStubDelay = false;

          if (PLAN_PROVIDER === 'openai' && OPENAI_API_KEY) {
            try {
              console.log(`[Plan] Calling OpenAI for project ${id}`);
              planData = await callOpenAIGeneratePlan({
                description: description || project.name || 'DIY project',
                budget: budget || project.budget || 'medium',
                skill_level: skill_level || project.skill || 'beginner'
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

          // Generate stub plan if needed
          if (!planData) {
            const projBudget = budget || project.budget || 'medium';
            const projSkill = skill_level || project.skill || 'beginner';
            const budgetMap = { low: '$', medium: '$$', high: '$$$' };
            const budgetLabel = budgetMap[projBudget] || '$$';
            
            planData = {
              summary: {
                title: project.name || 'DIY Project',
                est_cost: budgetLabel,
                est_time: projSkill === 'advanced' ? '8-12 hours' : projSkill === 'intermediate' ? '4-8 hours' : '2-4 hours',
                difficulty: projSkill
              },
              steps: [
                { title: 'Preparation', detail: 'Gather all materials and prepare workspace', duration_minutes: 30 },
                { title: 'Main Work', detail: 'Execute the core project tasks', duration_minutes: 120 },
                { title: 'Finishing Touches', detail: 'Add final details and clean up', duration_minutes: 45 }
              ],
              tools: ['Basic toolkit', 'Safety equipment'],
              materials: [
                { name: 'Primary materials', qty: '1', unit: 'set' }
              ],
              safety: ['Wear safety goggles', 'Keep workspace ventilated'],
              tips: ['Take your time', 'Measure twice, cut once']
            };
          }

          // Update to plan_ready with plan data
          await supabase.from('projects')
            .update({ 
              status: 'plan_ready',
              plan_json: planData
            })
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
    }

  } catch (err) {
    console.error('[build-without-preview] error:', err);
    return res.status(500).json({ ok:false, error:'build_without_preview_failed' });
  }
});

// --- GET /api/projects/:id/plan ---
app.get('/api/projects/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, status, plan_json, name')
      .eq('id', id)
      .maybeSingle();
    
    if (error) {
      console.log('[ERROR] GET plan database error:', error.message);
      return res.status(500).json({ ok:false, error: error.message });
    }
    if (!project) {
      return res.status(404).json({ ok:false, error:'project_not_found' });
    }

    // Check if plan is ready
    if (project.status !== 'plan_ready') {
      return res.status(409).json({ ok:false, error:'plan_not_ready', status: project.status });
    }

    // Generate plan_text from plan_json
    const plan_json = project.plan_json || {};
    const summary = plan_json.summary || {};
    const steps = plan_json.steps || [];
    const tools = plan_json.tools || [];
    const materials = plan_json.materials || [];
    const safety = plan_json.safety || [];
    const tips = plan_json.tips || [];

    let plan_text = `## ${summary.title || project.name || 'DIY Plan'} (stub)\n\n`;
    plan_text += `**Difficulty:** ${summary.difficulty || 'beginner'}  \n`;
    plan_text += `**Estimated Cost:** ${summary.est_cost || '$$'}  \n`;
    plan_text += `**Estimated Time:** ${summary.est_time || '2-4 hours'}  \n\n`;
    
    plan_text += `### Steps\n`;
    steps.forEach((step, idx) => {
      plan_text += `${idx + 1}. **${step.title}** - ${step.detail} (${step.duration_minutes || 30} min)\n`;
    });
    
    if (tools.length > 0) {
      plan_text += `\n### Tools Needed\n`;
      tools.forEach(tool => {
        plan_text += `- ${tool}\n`;
      });
    }
    
    if (materials.length > 0) {
      plan_text += `\n### Materials\n`;
      materials.forEach(mat => {
        const matName = typeof mat === 'string' ? mat : mat.name;
        const qty = mat.qty ? ` (${mat.qty} ${mat.unit || ''})` : '';
        plan_text += `- ${matName}${qty}\n`;
      });
    }
    
    if (safety.length > 0) {
      plan_text += `\n### Safety Tips\n`;
      safety.forEach(tip => {
        plan_text += `- ${tip}\n`;
      });
    }
    
    if (tips.length > 0) {
      plan_text += `\n### Pro Tips\n`;
      tips.forEach(tip => {
        plan_text += `- ${tip}\n`;
      });
    }

    return res.json({ ok:true, plan_text });
  } catch (e) {
    console.log('[ERROR] GET plan exception:', e.message);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
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

// --- Billing redirect pages ---
app.get('/billing/success', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).type('html').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIY Genie</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:40px auto;padding:20px;line-height:1.5"><h1>All set 🎉</h1><p>You can return to the DIY Genie app now.</p><p style="opacity:.7">If this tab didn't close automatically, just switch back to the app.</p></body>`
  );
});

app.get('/billing/cancel', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).type('html').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIY Genie</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:40px auto;padding:20px;line-height:1.5"><h1>Checkout canceled</h1><p>You can return to the DIY Genie app now.</p><p style="opacity:.7">If this tab didn't close automatically, just switch back to the app.</p></body>`
  );
});

app.get('/billing/portal-return', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).type('html').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIY Genie</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:40px auto;padding:20px;line-height:1.5"><h1>Portal closed</h1><p>You can return to the DIY Genie app now.</p><p style="opacity:.7">If this tab didn't close automatically, just switch back to the app.</p></body>`
  );
});

// --- Listen ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`API on ${PORT}`));
