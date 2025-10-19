import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import previewRouter from './routes/preview.js';
import planRouter from './routes/plan.js';
import entitlementsRouter from './routes/entitlements.js';
import healthRouter, { healthGet, liveGet, readyGet, fullGet, healthHead } from './routes/health.js';
import versionRouter, { versionGet, versionHead } from './routes/version.js';
import iosRouter from './routes/ios.js';
import projectsRouter from './routes/projects.js';
import { thumb } from './lib/image.js';

const app = express();
app.use(cors({ origin: (o, cb)=>cb(null,true), methods: ['GET','POST','PATCH','OPTIONS'] }));
app.use(express.json({ limit: '10kb' }));

// Request logging
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

// Unified error helper
app.use((req, _res, next) => {
  req.fail = (code, message, hint) => next(Object.assign(new Error(message), { status: 400, code, hint }));
  next();
});

// --- ROUTE MOUNTS (make sure these exist in Production) ---
app.use('/preview', previewRouter);
app.use('/plan', planRouter);
app.use('/entitlements', entitlementsRouter);
app.use('/health', healthRouter);
app.use('/version', versionRouter);
app.use('/api/ios', iosRouter);
app.use('/api/projects', projectsRouter);

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
const TEST_USER_ID = process.env.TEST_USER_ID;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'dev+test@diygenieapp.com';

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

// Helper to resolve user_id safely for dev/testing
function resolveUserId(raw) {
  const id = (raw || '').trim();
  if (!id || id === 'auto') return TEST_USER_ID || null;
  return id;
}

// Resolver util to extract user_id from req
function resolveUserIdFrom(req) {
  const raw = (req.query.user_id || req.body?.user_id || req.params?.user_id || '').trim();
  if (!raw || raw === 'auto') return process.env.TEST_USER_ID;
  return raw;
}

// Helper to get project by ID
async function getProjectById(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Helper to get project for user (with ownership check)
async function getProjectForUser(projectId, userId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, user_id, preview_status, preview_job_id, preview_url, input_image_url')
    .eq('id', projectId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  return data;
}

// Helper to update preview state
async function updatePreviewState(projectId, patch) {
  return supabase.from('projects').update(patch).eq('id', projectId).select('id').maybeSingle();
}

// Normalize helpers
function norm(x, fallback = '') { 
  return (x ?? fallback).toString().trim(); 
}

function normSkill(x) { 
  return (x || 'intermediate').toString().toLowerCase(); 
}

function normBudget(x) { 
  return (x || '$$').toString(); 
}

// Dev bypass constant
const DEV_BYPASS = process.env.NODE_ENV !== 'production' && process.env.DEV_NO_QUOTA === '1';

// Ensure there is an auth.users row; required before touching `profiles`
async function ensureAuthUserExists(supabase, userId, email) {
  if (!userId) return { ok: false, error: 'missing_test_user_id' };
  try {
    const { data: getRes, error: getErr } = await supabase.auth.admin.getUserById(userId);
    if (getErr && !String(getErr.message || '').includes('not found')) {
      return { ok: false, error: String(getErr.message || getErr) };
    }
    if (getRes?.user) return { ok: true };

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      user_id: userId,
      email,
      email_confirm: true
    });
    if (createErr) return { ok: false, error: String(createErr.message || createErr) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// --- ENTITLEMENTS CONFIG ---
const TIER_RULES = {
  free:   { quota: process.env.DEV_NO_QUOTA ? 999 : 2,  preview: false },
  casual: { quota: 5,  preview: true  },
  pro:    { quota: 25, preview: true  },
};

async function getEntitlements(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_tier, plan_tier')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) throw error;
    
    const tier = data?.subscription_tier || data?.plan_tier || 'free';
    const quota = tier === 'pro' ? 25 : tier === 'casual' ? 5 : (process.env.DEV_NO_QUOTA ? 999 : 2);
    
    // Count user's projects
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const used = count || 0;
    const remaining = Math.max(0, quota - used);
    
    return { 
      tier, 
      remaining, 
      previewAllowed: tier === 'pro' || tier === 'casual'
    };
  } catch (e) {
    if (DEV_BYPASS) {
      console.warn('[ENTS] bypassing entitlements in dev', e?.message || e);
      return { tier: 'free', remaining: 999, previewAllowed: false, devBypass: true };
    }
    throw e;
  }
}

async function ensureProfile(supabase, userId) {
  // Try to read existing
  let { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('user_id, plan_tier, subscription_tier, is_subscribed, stripe_subscription_status')
    .eq('user_id', userId)
    .maybeSingle();

  // If missing, create a minimal free profile
  if (!prof && (profErr?.code === 'PGRST116' || !profErr)) {
    const { data: newProf, error: insErr } = await supabase
      .from('profiles')
      .insert({ user_id: userId, plan_tier: 'free' })
      .select('user_id, plan_tier')
      .maybeSingle();
    if (insErr && insErr.code !== '23505') { // ignore dupe
      throw insErr;
    }
    prof = newProf || prof;
  } else if (profErr) {
    throw profErr;
  }
  return prof;
}

// Middleware to check preview/build quota (for preview and build endpoints only)
async function requirePreviewOrBuildQuota(req, res, next) {
  try {
    let userId = resolveUserIdFrom(req);
    if (!userId) return res.status(403).json({ ok: false, error: 'no_user' });
    req.user_id = userId;

    let ent;
    try {
      ent = await getEntitlements(userId);
    } catch (err) {
      ent = { tier: 'free', remaining: 2, previewAllowed: false };
    }

    req.entitlements = ent;
    next();
  } catch (e) {
    console.log('[ERROR] requirePreviewOrBuildQuota:', e.message);
    res.status(500).json({ ok: false, error: String(e) });
  }
}

// --- Feature Flags -----------------------------------------------------------
const PREVIEW_PROVIDER = process.env.PREVIEW_PROVIDER || 'stub'; // 'decor8' or 'stub'
const PLAN_PROVIDER = process.env.PLAN_PROVIDER || 'stub';       // 'openai' or 'stub'
const SUGGESTIONS_PROVIDER = process.env.SUGGESTIONS_PROVIDER || 'stub'; // 'stub' | 'openai'
const SUGGESTIONS_OPENAI_MODEL = process.env.SUGGESTIONS_OPENAI_MODEL || 'gpt-4o-mini';
const SUGGESTIONS_OPENAI_BASE = process.env.SUGGESTIONS_OPENAI_BASE || 'https://api.openai.com/v1';

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

async function callDecor8Status(jobId) {
  if (!jobId) throw new Error('jobId required');
  
  const res = await fetch(`${DECOR8_BASE_URL}/job_status/${jobId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${DECOR8_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Decor8 status ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  
  // Expected response: { status: 'queued'|'running'|'done'|'failed', url?: string }
  return data;
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

// --- Root endpoint ---
app.get('/', (req, res) => res.json({
  message: 'Server is running',
  status: 'ready',
  base: 'v1'
}));

// --- Entitlements endpoint ---
// GET /me/entitlements/:userId
app.get('/me/entitlements/:userId', async (req, res) => {
  const defaults = { tier: 'Free', quota: 2, remaining: 2, previewAllowed: false };
  try {
    const userId = req.params.userId?.trim();
    if (!userId) return res.json({ ok: true, ...defaults });

    // attempt lookup; if not found, fall back
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('subscription_tier, plan_quota_monthly, plan_credits_used_month')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !profile) return res.json({ ok: true, ...defaults });

    const tier = profile.subscription_tier || 'Free';
    const quota = profile.plan_quota_monthly ?? (tier === 'Pro' ? 25 : tier === 'Casual' ? 5 : 2);
    const used  = profile.plan_credits_used_month ?? 0;
    const remaining = Math.max(0, quota - used);

    return res.json({ ok: true, tier, quota, remaining, previewAllowed: tier !== 'Free' });
  } catch {
    return res.json({ ok: true, tier: 'Free', quota: 2, remaining: 2, previewAllowed: false });
  }
});

app.get('/api/me/entitlements/:userId', async (req, res) => {
  const defaults = { tier: 'Free', quota: 2, remaining: 2, previewAllowed: false };
  try {
    const userId = req.params.userId?.trim();
    if (!userId) return res.json({ ok: true, ...defaults });

    // attempt lookup; if not found, fall back
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('subscription_tier, plan_quota_monthly, plan_credits_used_month')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !profile) return res.json({ ok: true, ...defaults });

    const tier = profile.subscription_tier || 'Free';
    const quota = profile.plan_quota_monthly ?? (tier === 'Pro' ? 25 : tier === 'Casual' ? 5 : 2);
    const used  = profile.plan_credits_used_month ?? 0;
    const remaining = Math.max(0, quota - used);

    return res.json({ ok: true, tier, quota, remaining, previewAllowed: tier !== 'Free' });
  } catch {
    return res.json({ ok: true, tier: 'Free', quota: 2, remaining: 2, previewAllowed: false });
  }
});

// GET /me/entitlements (query param version)
app.get('/me/entitlements', async (req, res) => {
  const defaults = { tier: 'Free', quota: 2, remaining: 2, previewAllowed: false };
  try {
    const userId = req.query.user_id?.trim();
    if (!userId) return res.json({ ok: true, ...defaults });

    // attempt lookup; if not found, fall back
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('subscription_tier, plan_quota_monthly, plan_credits_used_month')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !profile) return res.json({ ok: true, ...defaults });

    const tier = profile.subscription_tier || 'Free';
    const quota = profile.plan_quota_monthly ?? (tier === 'Pro' ? 25 : tier === 'Casual' ? 5 : 2);
    const used  = profile.plan_credits_used_month ?? 0;
    const remaining = Math.max(0, quota - used);

    return res.json({ ok: true, tier, quota, remaining, previewAllowed: tier !== 'Free' });
  } catch {
    return res.json({ ok: true, tier: 'Free', quota: 2, remaining: 2, previewAllowed: false });
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

function normLower(s='') { return String(s||'').toLowerCase(); }

function inferBudgetLabel(b) {
  const t = (b||'').trim();
  if (t.includes('$$$') || t==='$$$') return '$$$';
  if (t.includes('$$') || t==='$$') return '$$';
  if (t.includes('$') || t==='$') return '$';
  return 'flexible';
}

function inferDifficulty(skill) {
  const s = normLower(skill);
  if (s.includes('begin')) return 'beginner';
  if (s.includes('inter')) return 'medium';
  if (s.includes('adv') || s.includes('expert') || s.includes('pro')) return 'advanced';
  return 'medium';
}

function inferStyle(desc) {
  const d = normLower(desc);
  if (d.match(/\b(minimal|clean|simple)\b/)) return 'minimal';
  if (d.match(/\b(modern|contemporary)\b/)) return 'modern';
  if (d.match(/\b(rustic|farmhouse)\b/)) return 'rustic';
  if (d.match(/\b(industrial)\b/)) return 'industrial';
  if (d.match(/\b(scandi|scandinavian)\b/)) return 'scandinavian';
  return 'modern';
}

function buildSuggestions({ description, budget, skill }) {
  const diff = inferDifficulty(skill);
  const bud  = inferBudgetLabel(budget);
  const style = inferStyle(description);
  const items = [];

  // universal
  items.push(`Match materials: pick finishes that suit ${style} style.`);
  items.push(`Pre-plan cuts and verify wall studs before mounting.`);
  items.push(`Label hardware and pre-finish small parts to save time.`);

  // difficulty hints
  if (diff === 'beginner') {
    items.push(`Keep joinery simple (pocket screws / brackets); dry-fit before glue.`);
  } else if (diff === 'advanced') {
    items.push(`Use scribe lines and a shooting board for tight reveals.`);
  } else {
    items.push(`Use a square and stop-blocks for consistent repeat cuts.`);
  }

  // budget hints
  if (bud === '$') {
    items.push(`Save costs: pine/ply core + iron-on edge banding, paint to finish.`);
  } else if (bud === '$$$') {
    items.push(`Upgrade: hardwood, hidden fasteners, and a sprayed finish.`);
  } else {
    items.push(`Balance cost: veneered ply shelves with hardwood fronts.`);
  }

  // last one tailored to description
  if (norm(description).includes('shelf') || norm(description).includes('shelves')) {
    items.push(`For floating shelves, use rated concealed brackets and hit studs at 16" OC.`);
  }

  return { items, style, diff, bud };
}

// Minimal, deterministic design suggestions for $0 testing
function stubDesignSuggestions({ description, budget, skill_level }) {
  const desc = (description || '').slice(0, 140);
  const bullets = [
    `Materials: use oak or walnut with matte black hardware.`,
    `Palette: warm whites + light gray; keep ${desc ? 'style consistent with the photo' : 'tones cohesive'}.`,
    `Layout: balance symmetry; keep spacing even and respect studs @ 16" OC.`,
    `Lighting: add warm LED strips or a single soft accent light.`,
    `Accents: linen/rattan textures; one focal piece to avoid clutter.`
  ];
  return { bullets, tags: ['materials', 'palette', 'layout', 'lighting', 'accents'] };
}

// OpenAI provider via REST (no ESM import)
async function openaiDesignSuggestions({ description, budget, skill_level }) {
  if (!OPENAI_API_KEY) throw new Error('missing_openai_key');

  const system = [
    'You are an interior design assistant.',
    'Return exactly 5 concise visual/design suggestions.',
    'DO NOT include tool/safety/measurement advice.',
    'Focus on: materials, color palette, layout/spacing, lighting, accents.',
    'Output strict JSON with keys: { "bullets": string[5], "tags": string[] }.',
    'Tags must be from: ["materials","palette","layout","lighting","accents"].'
  ].join(' ');

  const user = [
    `Project: ${description || '(none)'}`,
    `Budget: ${budget || '(unspecified)'}`,
    `Skill: ${skill_level || '(unspecified)'}`
  ].join('\n');

  const body = {
    model: SUGGESTIONS_OPENAI_MODEL,
    temperature: 0.2,
    max_tokens: 350,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };

  const res = await fetch(`${SUGGESTIONS_OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `openai_${res.status}`);

  let parsed;
  try {
    parsed = JSON.parse(json?.choices?.[0]?.message?.content || '{}');
  } catch (_) { /* fall through */ }

  if (!parsed || !Array.isArray(parsed.bullets))
    throw new Error('openai_bad_json');

  return {
    bullets: parsed.bullets.slice(0, 5),
    tags: Array.isArray(parsed.tags) ? parsed.tags : []
  };
}

// Single entry that chooses provider (+ tiny 60s memo to cut repeats)
const _memo = new Map();
function _memoKey(p) {
  return `${(p.description||'').trim()}|${p.budget||''}|${p.skill_level||''}|${SUGGESTIONS_PROVIDER}`;
}
async function makeDesignSuggestions(payload) {
  const key = _memoKey(payload);
  const hit = _memo.get(key);
  const now = Date.now();
  if (hit && (now - hit.t) < 60000) return hit.v;

  let v;
  if (SUGGESTIONS_PROVIDER === 'openai') {
    try { v = await openaiDesignSuggestions(payload); }
    catch (e) {
      // Fail safe to stub to avoid UX dead-ends
      v = stubDesignSuggestions(payload);
      v.error = String(e.message || e);
      v.provider = 'openai(fallback-stub)';
      _memo.set(key, { v, t: now }); 
      return v;
    }
    v.provider = 'openai';
  } else {
    v = stubDesignSuggestions(payload);
    v.provider = 'stub';
  }

  _memo.set(key, { v, t: now });
  return v;
}

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

// --- Projects: CARDS (Lightweight List) ---
// NOTE: Must come BEFORE /:id route to avoid "cards" being treated as an ID
app.get('/api/projects/cards', async (req, res) => {
  try {
    const user_id = req.query.user_id || DEV_USER;
    
    const rawLimit = parseInt(req.query.limit);
    const rawOffset = parseInt(req.query.offset);
    
    const limit = (!isNaN(rawLimit) && rawLimit > 0 && rawLimit <= 50) ? rawLimit : 10;
    const offset = (!isNaN(rawOffset) && rawOffset >= 0) ? rawOffset : 0;

    const { data, error} = await supabase
      .from('projects')
      .select('id,name,status,preview_url,updated_at')
      .eq('user_id', user_id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const items = (data || []).map(project => ({
      ...project,
      preview_thumb_url: thumb(project.preview_url, 640, 70)
    }));

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
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
    const { user_id, name, budget, skill, skill_level } = req.body || {};

    // Require user_id from the app
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'user_id required' });
    }

    // Map skill → skill_level if present
    const skillLevel = skill_level || skill;

    // Basic validation
    if (!name || String(name).trim().length < 10) return res.status(422).json({ ok: false, error: 'invalid_name' });
    if (!budget) return res.status(422).json({ ok: false, error: 'invalid_budget' });
    if (!skillLevel) return res.status(422).json({ ok: false, error: 'invalid_skill_level' });

    // Upsert profile to avoid foreign key errors
    await supabase
      .from('profiles')
      .upsert(
        { user_id, plan_tier: 'free' },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    // Create project
    const { data: inserted, error: projectErr } = await supabase
      .from('projects')
      .insert({
        user_id,
        name: String(name).trim(),
        budget,
        status: 'draft'
      })
      .select('id, status')
      .maybeSingle();

    if (projectErr || !inserted?.id) {
      console.log(`[POST /api/projects] insert_failed: ${projectErr?.message || 'no_id'}`);
      return res.status(422).json({ ok: false, error: 'insert_failed' });
    }

    console.log(`[POST /api/projects] user_id=${user_id}, project_id=${inserted.id}`);
    return res.json({ ok: true, item: inserted });
  } catch (e) {
    console.log(`[POST /api/projects] error: ${e.message}`);
    return res.status(422).json({ ok: false, error: 'invalid_request' });
  }
});

// --- Projects: PATCH (update with whitelist) ---
app.patch('/api/projects/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = (req.body?.user_id || req.query?.user_id || '').trim();
    
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'user_id_required' });
    }
    
    console.log('[projects PATCH] start', { projectId, user_id: userId });
    
    // Load project and verify ownership
    const { data: proj, error: projError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();
    
    if (projError) throw projError;
    if (!proj) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    if (proj.user_id !== userId) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    
    // Whitelist fields
    const whitelist = ['status', 'name', 'preview_url'];
    const updates = {};
    
    for (const key of whitelist) {
      if (req.body.hasOwnProperty(key)) {
        updates[key] = req.body[key];
      }
    }
    
    // Require at least one updatable field
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'no_updatable_fields_provided' });
    }
    
    // Always bump updated_at
    updates.updated_at = new Date().toISOString();
    
    // Update project
    const { data: updated, error: updateError } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .select('id, user_id, name, status, preview_url, updated_at, created_at')
      .maybeSingle();
    
    if (updateError) throw updateError;
    
    console.log('[projects PATCH] updated', { 
      id: updated.id, 
      status: updated.status, 
      hasPreview: !!updated.preview_url 
    });
    
    return res.json({ ok: true, item: updated });
  } catch (e) {
    console.error('[projects PATCH] error:', e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- Demo Project: CREATE OR FETCH ---
// POST /api/demo-project - Creates or returns existing demo project for user
app.post('/api/demo-project', async (req, res) => {
  try {
    const user_id = (req.body?.user_id || '').trim();
    
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'missing_user_id' });
    }
    
    console.log('[POST /api/demo-project] user_id=', user_id);
    
    // 1) Check if demo project already exists for this user
    const { data: existing, error: checkErr } = await supabase
      .from('projects')
      .select('id, name, status, input_image_url, preview_url')
      .eq('user_id', user_id)
      .eq('is_demo', true)
      .limit(1)
      .maybeSingle();
    
    if (checkErr) {
      console.error('[demo-project] select existing error', {
        message: checkErr.message,
        details: checkErr.details,
        hint: checkErr.hint,
        code: checkErr.code
      });
    }
    
    // If demo exists, return it
    if (existing?.id) {
      console.log('[demo-project] Returning existing demo:', existing.id);
      return res.json({ ok: true, item: existing, existed: true });
    }
    
    // 2) Upsert profile to avoid foreign key errors
    await supabase
      .from('profiles')
      .upsert(
        { user_id, plan_tier: 'free' },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );
    
    // 3) Define demo project data
    const demoPlanJson = {
      summary: {
        title: 'Modern Floating Shelves',
        est_time: '3-4 hours',
        est_cost: '$85',
        overview: 'Build clean, minimalist shelves with concealed brackets.',
        difficulty: 'intermediate'
      },
      materials: [
        { name: `Birch plywood 3/4" (4x8)`, qty: 1, unit: 'sheet', cost: '$68', subtotal: 68 },
        { name: 'Edge banding 3/4"', qty: 1, unit: 'ea', cost: '$7.50', subtotal: 7.5 },
        { name: 'Wood screws 2.5"', qty: 1, unit: 'box', cost: '$9.50', subtotal: 9.5 }
      ],
      tools: [
        { name: 'Circular saw', optional: false },
        { name: 'Drill', optional: false },
        { name: 'Level', optional: false },
        { name: 'Miter saw', optional: true }
      ],
      cuts: [
        { board: 'Birch plywood', dims: '48" x 10"', qty: 2 },
        { board: 'Birch plywood', dims: '12" x 10"', qty: 4 }
      ],
      steps: [
        { order: 1, title: 'Cut shelves', detail: 'Cut plywood to size using circular saw', duration: 45 },
        { order: 2, title: 'Apply edge banding', detail: 'Iron on edge banding to all exposed edges', duration: 30 },
        { order: 3, title: 'Locate studs', detail: 'Use stud finder to mark wall studs', duration: 15 },
        { order: 4, title: 'Install brackets', detail: 'Mount floating shelf brackets to studs', duration: 60 },
        { order: 5, title: 'Attach shelves', detail: 'Slide shelves onto brackets and secure', duration: 30 }
      ],
      safety: [
        'Wear safety glasses when cutting',
        'Use dust mask for sanding',
        'Ensure proper wall anchoring for load capacity'
      ],
      tips: [
        'Pre-drill screw holes to prevent splitting',
        'Use a level to ensure shelves are perfectly horizontal'
      ]
    };
    
    // 4) Create demo project with all required fields
    const demoProject = {
      user_id,
      name: 'Modern Floating Shelves (Demo)',
      budget: '$$',                    // Valid budget value: $, $$, or $$$
      status: 'plan_ready',
      is_demo: true,
      input_image_url: 'https://images.unsplash.com/photo-1582582429416-456273091821?q=80&w=1200&auto=format&fit=crop',
      preview_url: 'https://images.unsplash.com/photo-1549187774-b4e9b0445b41?q=80&w=1200&auto=format&fit=crop',
      plan_json: demoPlanJson
    };
    
    const { data: created, error: insertErr } = await supabase
      .from('projects')
      .insert(demoProject)
      .select('id, name, status, input_image_url, preview_url')
      .single();
    
    if (insertErr) {
      // Log full error details for diagnosis
      console.error('[demo-project] Insert error:', {
        message: insertErr.message,
        details: insertErr.details,
        hint: insertErr.hint,
        code: insertErr.code
      });
      return res.status(500).json({ 
        ok: false, 
        error: 'insert_failed', 
        details: insertErr.message 
      });
    }
    
    if (!created?.id) {
      console.error('[demo-project] No ID returned after insert');
      return res.status(500).json({ ok: false, error: 'insert_failed', details: 'no_id_returned' });
    }
    
    console.log('[demo-project] Created new demo:', created.id);
    return res.json({ ok: true, item: created, existed: false });
  } catch (e) {
    console.error('[demo-project] Exception:', {
      message: e?.message,
      stack: e?.stack
    });
    return res.status(500).json({ 
      ok: false, 
      error: 'exception', 
      details: e?.message 
    });
  }
});

// --- Events: CREATE ---
app.post('/api/events', async (req, res) => {
  try {
    const { user_id, project_id, event_type, props } = req.body || {};

    // Validate user_id (must be UUID)
    if (!user_id || typeof user_id !== 'string' || user_id.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'missing_user_id' });
    }

    // Validate event_type (must be non-empty string)
    if (!event_type || typeof event_type !== 'string' || event_type.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'missing_event_type' });
    }

    // Insert into events table
    const { error: insertErr } = await supabase
      .from('events')
      .insert({
        user_id,
        project_id: project_id || null,
        event_type: event_type.trim(),
        props: props || {}
      });

    if (insertErr) {
      console.error('[events] insert fail', insertErr?.message);
      return res.status(500).json({ ok: false, error: 'insert_failed' });
    }

    console.log('[events] insert ok', user_id, event_type);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[events] insert fail', e?.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
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
// COMMENTED OUT - Replaced by minimal preview endpoints below (lines ~1425)
// OLD: Gated by tier - requires previewAllowed and remaining quota
// app.post('/api/projects/:id/preview', requirePreviewOrBuildQuota, async (req, res) => {
app.post('/api/projects/:id/preview-OLD-DISABLED', requirePreviewOrBuildQuota, async (req, res) => {
  try {
    const { id } = req.params;
    const { room_type, design_style } = req.body || {};

    // Validate project exists and has image
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('id, input_image_url, preview_url, status')
      .eq('id', id)
      .single();

    if (pErr || !project) {
      return res.status(404).json({ ok:false, error: 'project_not_found' });
    }
    if (!project.input_image_url) {
      return res.status(422).json({ ok:false, error: 'missing_input_image_url' });
    }

    // Enforce max 1 preview per project
    if (project.preview_url || project.status === 'preview_ready') {
      return res.status(409).json({ ok:false, error: 'preview_already_used' });
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
app.post('/api/projects/:id/build-without-preview', async (req, res) => {
  try {
    const id = (req.params.id || req.body?.project_id || req.body?.id)?.trim();
    if (!id) return res.status(400).json({ ok: false, error: 'missing_project_id' });

    // Optional: honor user id if provided via body, query, or header
    const userId =
      req.body?.user_id ||
      req.query?.user_id ||
      req.headers['x-user-id'] ||
      null;

    // Verify project exists
    const { data: proj, error: getErr } = await supabase
      .from('projects')
      .select('id, status, input_image_url')
      .eq('id', id)
      .maybeSingle();

    if (getErr) return res.status(500).json({ ok: false, error: getErr.message });
    if (!proj) return res.status(404).json({ ok: false, error: 'project_not_found' });

    // Minimal preconditions: allow build without preview; just ensure we have an image if your flow requires it
    // If you want to require an image, uncomment the next lines:
    // if (!proj.input_image_url) {
    //   return res.status(400).json({ ok: false, error: 'missing_input_image_url' });
    // }

    // Mark project ready; clear preview_url
    const { error: updErr } = await supabase
      .from('projects')
      .update({ status: 'ready', preview_url: null })
      .eq('id', id);

    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    // Optionally enqueue a background job here later

    // 202 to indicate accepted for processing
    return res.status(202).json({ ok: true, project_id: id, accepted: true, user_id: userId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'server_error' });
  }
});

// --- Smart Suggestions endpoint (beta) -------------------------------------
// POST /api/projects/:id/suggestions
app.post('/api/projects/:id/suggestions', async (req, res) => {
  try {
    const { id } = req.params;
    const p = await getProjectById(id);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });

    const b = req.body || {};
    const desc = norm(b.desc || b.description || p.name || p.description, '');
    const budget = normBudget(b.budget || p.budget);
    const skill = normSkill(b.skill_level || b.skill || p.skill_level);

    // You can later swap this stub with OpenAI. For now: always return 200.
    const suggestions = [
      'Match materials to the room palette (oak/walnut for warm tones).',
      'Find studs and align brackets (16" OC typical).',
      'Pre-finish shelf parts to save time.',
      'Label hardware in small bags.',
      'Keep lighting consistent (warm LED).'
    ];
    const tags = [skill, budget].filter(Boolean);

    return res.json({ ok: true, suggestions, tags, desc, budget, skill });
  } catch (e) {
    console.error('[SUGGESTIONS]', e);
    // Still 200 with minimal fallback so the client never sees 422
    return res.json({
      ok: true,
      suggestions: [
        'Use sturdy anchors if no studs are available.',
        'Dry-fit layout and mark level lines first.'
      ],
      tags: []
    });
  }
});

// --- Smart prompt coach route ---
app.post('/api/projects/:id/suggestions-smart', async (req, res) => {
  try {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ ok:false, error:'missing_project_id' });

    const { data: p, error } = await supabase
      .from('projects')
      .select('id, goal, name, budget, skill_level, input_image_url')
      .eq('id', id)
      .maybeSingle();
    if (error) return res.status(500).json({ ok:false, error:error.message });
    if (!p) return res.status(404).json({ ok:false, error:'project_not_found' });

    const goal = (p.goal || p.name || '').toLowerCase();
    const budget = (p.budget || '').toUpperCase();
    const skill  = (p.skill_level || '').toLowerCase();
    const hasPhoto = !!p.input_image_url;

    const tips = [];
    const add = (text, tag='general') => { tips.push({ text, tag }); };

    // --- Core prompt sharpeners ---
    if (goal.length < 30) add('Add size or material details (width × depth × finish)', 'clarity');
    add('Mention room and main colors for a better visual match', 'context');

    // --- Category-based heuristics ---
    if (/\bshelf|shelv/.test(goal)) {
      add('Specify shelf thickness (¾" vs 1")', 'materials');
      add('Hidden vs visible brackets?', 'style');
    }
    if (/\bbench\b/.test(goal)) {
      add('Seat height 17–18", depth 16–18"', 'ergonomics');
      add('Include storage type (cubbies vs drawers)', 'storage');
    }
    if (/\bpaint|accent wall\b/.test(goal)) {
      add('Include paint sheen + surface prep', 'finish');
    }

    // --- Budget / skill cues ---
    if (budget === '$') add('Ask for cost-saving alternatives', 'budget');
    if (budget === '$$$') add('Call out premium hardware or finish', 'premium');
    if (skill === 'beginner') add('Ask for tool-light or pre-cut method', 'beginner');
    if (skill === 'advanced') add('Allow joinery (dados, domino, lamination)', 'advanced');

    // --- Photo-aware ---
    if (hasPhoto) {
      add('Note outlets or trim clearances visible in photo', 'photo');
      add('Match wood tone to lightest furniture in photo', 'photo');
      add('Target ~70% wall width for balanced proportion', 'photo');
    } else {
      add('Upload a clear room photo for layout-aware ideas', 'photo');
    }

    // --- Dedup + cap 6 ---
    const seen = new Set();
    const uniq = tips.filter(t => !seen.has(t.text) && seen.add(t.text)).slice(0, 6);

    return res.json({ ok:true, suggestions: uniq });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message || 'server_error' });
  }
});

/**
 * GET /api/projects/:id/plan
 * Returns comprehensive plan data for the Plan screen
 * 
 * @param {string} id - Project UUID
 * @returns {object} Plan data with summary, preview, materials, tools, steps, etc.
 */
app.get('/api/projects/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch project with all needed fields
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, user_id, status, plan_json, name, input_image_url, preview_url')
      .eq('id', id)
      .maybeSingle();
    
    if (error) {
      console.log('[ERROR] GET plan database error:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }
    
    if (!project) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }

    // Get user quota/entitlements
    let quota = { tier: 'free', plansUsed: 0, plansLimit: 2 };
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier, plan_tier')
        .eq('user_id', project.user_id)
        .maybeSingle();
      
      const tier = profile?.subscription_tier || profile?.plan_tier || 'free';
      const limit = tier === 'pro' ? 25 : tier === 'casual' ? 5 : 2;
      
      const { count } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', project.user_id);
      
      quota = {
        tier,
        plansUsed: count || 0,
        plansLimit: limit
      };
    } catch (e) {
      console.warn('[WARN] Could not fetch quota:', e.message);
    }

    // Extract plan_json data with defaults
    const plan = project.plan_json || {};
    const planSummary = plan.overview || plan.summary || {};
    const planSteps = plan.steps || [];
    const planMaterials = plan.materials || [];
    const planTools = plan.tools || [];
    const planCuts = plan.cuts || [];
    const planSafety = plan.safety || [];
    
    // Parse estimated time (convert to hours)
    let estTimeHours = 0;
    const estTimeStr = planSummary.est_time || planSummary.estimatedTime || '';
    const hourMatch = estTimeStr.match(/(\d+)\s*h/i);
    if (hourMatch) {
      estTimeHours = parseInt(hourMatch[1], 10);
    } else if (estTimeStr.includes('-')) {
      const [min, max] = estTimeStr.split('-').map(s => parseInt(s, 10));
      estTimeHours = Math.ceil((min + max) / 2);
    }
    
    // Parse estimated cost (convert to USD)
    let estCostUsd = 0;
    const estCostStr = planSummary.est_cost || planSummary.estimatedCost || '';
    if (estCostStr.includes('$')) {
      const costMatch = estCostStr.match(/\$?\s*(\d+)/);
      if (costMatch) estCostUsd = parseInt(costMatch[1], 10);
    }

    // Build response following the frozen schema
    const response = {
      projectId: project.id,
      
      summary: {
        title: planSummary.title || project.name || 'DIY Project Plan',
        heroImageUrl: project.preview_url || project.input_image_url || null,
        estTimeHours,
        estCostUsd
      },
      
      preview: {
        beforeUrl: project.input_image_url || null,
        afterUrl: project.preview_url || null
      },
      
      materials: planMaterials.map(mat => {
        if (typeof mat === 'string') {
          return { name: mat, qty: 0, unit: 'ea', subtotalUsd: 0 };
        }
        return {
          name: mat.name || 'Material',
          qty: parseFloat(mat.qty || mat.quantity || 0),
          unit: mat.unit || 'ea',
          subtotalUsd: parseFloat(mat.subtotal || mat.unit_price || mat.price || 0)
        };
      }),
      
      tools: {
        required: Array.isArray(planTools) 
          ? planTools.filter(t => typeof t === 'string' || !t.optional).map(t => typeof t === 'string' ? t : t.name)
          : [],
        optional: Array.isArray(planTools)
          ? planTools.filter(t => typeof t === 'object' && t.optional).map(t => t.name)
          : []
      },
      
      cutList: {
        items: planCuts.map(cut => ({
          board: cut.item || cut.board || 'Board',
          dims: cut.size || cut.dims || cut.dimensions || '',
          qty: parseInt(cut.qty || cut.quantity || 1, 10)
        })),
        layoutSvgUrl: null  // No layout diagrams yet
      },
      
      steps: planSteps.map((step, idx) => ({
        n: parseInt(step.order || step.step || idx + 1, 10),
        title: step.title || `Step ${idx + 1}`,
        text: step.text || step.detail || step.description || '',
        diagramUrl: step.diagramUrl || null
      })),
      
      safety: {
        notes: Array.isArray(planSafety) 
          ? planSafety.map(s => typeof s === 'string' ? s : s.note || s.text || '')
          : []
      },
      
      permits: {
        needed: false,  // Default to no permits needed
        note: 'Check local building codes for structural modifications'
      },
      
      quota
    };

    return res.json(response);
  } catch (e) {
    console.log('[ERROR] GET plan exception:', e.message);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// POST /api/projects/:id/plan - Update project plan
app.post('/api/projects/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_json, status } = req.body;
    
    if (!plan_json) {
      return res.status(400).json({ ok: false, error: 'plan_json required' });
    }
    
    const updateData = { 
      plan_json,
      updated_at: new Date().toISOString()
    };
    
    // Update status if provided
    if (status) {
      updateData.status = status;
    }
    
    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .select()
      .maybeSingle();
    
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    
    console.log(`[plan UPDATE] Project ${id} plan updated, status: ${data.status}`);
    return res.json({ ok: true, project: data });
  } catch (e) {
    console.error('[ERROR] POST plan exception:', e.message);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- Plan Normalization Helpers ---
function arr(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
function num(n, d=0){ const v = Number(n); return Number.isFinite(v) ? v : d; }

function mapPlanToNormalized(input = {}) {
  const src = input || {};
  const overview = {
    title: src.overview?.title ?? src.title ?? null,
    est_time: src.overview?.est_time ?? src.time ?? null,
    est_cost: src.overview?.est_cost ?? src.cost ?? null,
    skill: src.overview?.skill ?? src.skill ?? null,
    notes: src.overview?.notes ?? null,
  };

  const materials = arr(src.materials).map(m => ({
    name: String(m?.name ?? m?.item ?? '').trim(),
    qty: m?.qty ?? m?.quantity ?? m?.amount ?? null,
    notes: m?.notes ?? null,
  })).filter(m => m.name);

  const tools = arr(src.tools).map(t => ({
    name: String(t?.name ?? t?.tool ?? '').trim(),
    notes: t?.notes ?? null,
  })).filter(t => t.name);

  const cuts = arr(src.cuts).map(c => ({
    item: String(c?.item ?? c?.name ?? '').trim(),
    size: c?.size ?? c?.dimensions ?? null,
    qty: num(c?.qty ?? c?.quantity, null),
    notes: c?.notes ?? null,
  })).filter(c => c.item);

  const stepsRaw = arr(src.steps).map((s, i) => ({
    order: num(s?.order, i + 1),
    text: String(s?.text ?? s?.step ?? '').trim(),
    notes: s?.notes ?? null,
  })).filter(s => s.text);

  const steps = stepsRaw.sort((a,b) => a.order - b.order);

  const normalized = { overview, materials, tools, cuts, steps };
  console.log('[plan map] counts', {
    materials: materials.length, tools: tools.length, cuts: cuts.length, steps: steps.length
  });
  return normalized;
}

async function savePlan(projectId, plan) {
  const normalized = mapPlanToNormalized(plan);
  
  const { data, error } = await supabase
    .from('projects')
    .update({
      plan_json: normalized,
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', projectId)
    .select('id, plan_json')
    .maybeSingle();
  
  if (error) throw error;
  
  const pj = data?.plan_json || {};
  const counts = {
    materials: Array.isArray(pj?.materials) ? pj.materials.length : 0,
    tools: Array.isArray(pj?.tools) ? pj.tools.length : 0,
    cuts: Array.isArray(pj?.cuts) ? pj.cuts.length : 0,
    steps: Array.isArray(pj?.steps) ? pj.steps.length : 0,
  };
  
  console.log('[plan save] upsert ok', { projectId, counts });
  return { ok: true, counts };
}

// --- Plan Diagnostic & Ingest Endpoints ---

// GET /selftest/plan/:projectId - Diagnostic endpoint
app.get('/selftest/plan/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('plan_json')
      .eq('id', projectId)
      .maybeSingle();
    
    if (error) throw error;
    
    const pj = data?.plan_json || {};
    const counts = {
      materials: Array.isArray(pj?.materials) ? pj.materials.length : 0,
      tools: Array.isArray(pj?.tools) ? pj.tools.length : 0,
      cuts: Array.isArray(pj?.cuts) ? pj.cuts.length : 0,
      steps: Array.isArray(pj?.steps) ? pj.steps.length : 0,
    };
    console.log('[plan selftest]', { projectId, counts });
    res.json({ ok: true, counts, keys: Object.keys(pj || {}) });
  } catch (e) {
    console.error('[plan selftest] error', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /projects/:projectId/plan - Ingest raw plan and normalize
app.patch('/projects/:projectId/plan', async (req, res) => {
  const { projectId } = req.params;
  const raw = req.body || {};
  try {
    const result = await savePlan(projectId, raw);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[plan ingest] error', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- Progress tracking endpoints ---
// GET progress for a project
app.get('/api/projects/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('projects')
      .select('completed_steps, current_step_index')
      .eq('id', id)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    
    res.json({
      ok: true,
      completed_steps: data?.completed_steps || [],
      current_step_index: data?.current_step_index || 0
    });
  } catch (err) {
    console.error('[progress GET error]', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch progress' });
  }
});

// POST progress for a project
app.post('/api/projects/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { completed_steps, current_step_index } = req.body;
    
    const { data, error } = await supabase
      .from('projects')
      .update({ 
        completed_steps,
        current_step_index 
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[progress POST error]', err);
    res.status(500).json({ ok: false, error: 'Failed to update progress' });
  }
});

// --- Measurement endpoints ---
// POST /api/projects/:projectId/scans/:scanId/measure
app.post('/api/projects/:projectId/scans/:scanId/measure', async (req, res) => {
  try {
    const { projectId, scanId } = req.params;
    const userId = resolveUserIdFrom(req);
    
    // Validate inputs
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'user_id required' });
    }
    if (!projectId || !scanId) {
      return res.status(400).json({ ok: false, error: 'projectId and scanId required' });
    }
    
    console.log('[measure web] start', { projectId, scanId, userId });
    
    // Query 1: Verify scan exists and belongs to project
    const { data: scan, error: scanError } = await supabase
      .from('room_scans')
      .select('id, project_id')
      .eq('id', scanId)
      .eq('project_id', projectId)
      .single();
    
    if (scanError || !scan) {
      return res.status(404).json({ ok: false, error: 'scan_not_found' });
    }
    
    // Query 2: Verify user owns the project
    const { data: proj, error: projError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();
    
    if (projError || !proj) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    
    if (proj.user_id !== userId) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    
    // Update scan with measurement result
    const { error: updateError } = await supabase
      .from('room_scans')
      .update({
        measure_status: 'done',
        measure_result: {
          px_per_in: 15.0,
          width_in: 48,
          height_in: 30,
          roi: req.body?.roi ?? null
        }
      })
      .eq('id', scanId);
    
    if (updateError) throw updateError;
    
    console.log('[measure web] update complete', { scanId, status: 'done' });
    
    res.json({ ok: true, status: 'done' });
  } catch (e) {
    console.error('[measure web] error:', e.message);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/projects/:projectId/scans/:scanId/measure/status
app.get('/api/projects/:projectId/scans/:scanId/measure/status', async (req, res) => {
  try {
    const { projectId, scanId } = req.params;
    const userId = resolveUserIdFrom(req);
    
    // Validate inputs
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'user_id required' });
    }
    if (!projectId || !scanId) {
      return res.status(400).json({ ok: false, error: 'projectId and scanId required' });
    }
    
    console.log('[measure web] status check', { projectId, scanId, userId });
    
    // Query 1: Verify scan exists and belongs to project
    const { data: scan, error: scanError } = await supabase
      .from('room_scans')
      .select('id, project_id')
      .eq('id', scanId)
      .eq('project_id', projectId)
      .single();
    
    if (scanError || !scan) {
      return res.status(404).json({ ok: false, error: 'scan_not_found' });
    }
    
    // Query 2: Verify user owns the project
    const { data: proj, error: projError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();
    
    if (projError || !proj) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    
    if (proj.user_id !== userId) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    
    // Query 3: Read measurement status and result
    const { data: rec, error: recError } = await supabase
      .from('room_scans')
      .select('measure_status, measure_result')
      .eq('id', scanId)
      .single();
    
    if (recError) throw recError;
    
    // Check if measurement is ready
    if (rec.measure_status !== 'done') {
      return res.status(409).json({ ok: false, error: 'not_ready' });
    }
    
    res.json({ 
      ok: true, 
      status: 'done', 
      result: rec.measure_result 
    });
  } catch (e) {
    console.error('[measure web] status error:', e.message);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- Preview Endpoints with Decor8 Integration ---

// POST /api/projects/:projectId/preview/start
app.post('/api/projects/:projectId/preview/start', async (req, res) => {
  try {
    const userId = (req.body?.user_id || req.query?.user_id || '').trim();
    const projectId = req.params.projectId;
    if (!userId) return res.status(400).json({ ok: false, error: 'user_id_required' });

    const proj = await getProjectForUser(projectId, userId);
    if (!proj) return res.status(404).json({ ok: false, error: 'project_not_found_or_forbidden' });

    // Allow re-use guard: if already done and url present, just return
    if (proj.preview_status === 'done' && proj.preview_url) {
      return res.json({ ok: true, status: 'done', url: proj.preview_url });
    }

    // Source image: prefer uploaded scan image; fallback to project input_image_url
    const imageUrl = proj.input_image_url || req.body?.image_url;
    const roi = req.body?.roi || null;
    const prompt = req.body?.prompt || 'Decorate this space in a modern DIY-friendly style.';

    if (!imageUrl) {
      return res.status(409).json({ ok: false, error: 'image_required_for_preview' });
    }

    // Kick job
    console.log('[preview] start', { projectId, hasROI: !!roi });
    const start = await callDecor8Generate({ 
      input_image_url: imageUrl, 
      room_type: req.body?.room_type || 'livingroom',
      design_style: req.body?.design_style || 'modern'
    });
    
    if (!start?.jobId) return res.status(502).json({ ok: false, error: 'decor8_start_failed' });

    await updatePreviewState(projectId, {
      preview_status: 'queued',
      preview_job_id: start.jobId,
      preview_url: null,
      updated_at: new Date().toISOString(),
    });

    return res.json({ ok: true, status: 'queued', jobId: start.jobId });
  } catch (e) {
    console.error('[preview] start error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// GET /api/projects/:projectId/preview/status
app.get('/api/projects/:projectId/preview/status', async (req, res) => {
  try {
    const userId = (req.body?.user_id || req.query?.user_id || '').trim();
    const projectId = req.params.projectId;
    if (!userId) return res.status(400).json({ ok: false, error: 'user_id_required' });

    const proj = await getProjectForUser(projectId, userId);
    if (!proj) return res.status(404).json({ ok: false, error: 'project_not_found_or_forbidden' });

    const { preview_status, preview_job_id, preview_url } = proj;

    // Already done? Return final result
    if (preview_status === 'done') {
      return res.json({ ok: true, status: 'done', url: preview_url });
    }

    // Background job check
    if (!preview_job_id) {
      return res.json({ ok: true, status: preview_status || 'none' });
    }

    const jobStatus = await callDecor8Status(preview_job_id);
    console.log('[preview] status poll', { projectId, jobStatus: jobStatus.status });

    if (jobStatus.status === 'done' && jobStatus.url) {
      await updatePreviewState(projectId, {
        preview_status: 'done',
        preview_url: jobStatus.url,
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, status: 'done', url: jobStatus.url });
    }

    if (jobStatus.status === 'failed') {
      await updatePreviewState(projectId, {
        preview_status: 'error',
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, status: 'error', error: 'decor8_job_failed' });
    }

    const mapped = jobStatus.status === 'running' ? 'processing' : 'queued';
    await updatePreviewState(projectId, {
      preview_status: mapped,
      updated_at: new Date().toISOString(),
    });

    return res.json({ ok: true, status: mapped });
  } catch (e) {
    console.error('[preview] status error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Helper: list all storage keys under a prefix with pagination
async function listAllKeys(bucket, prefix) {
  const keys = [];
  let page = 0;
  const size = 100;
  
  while (true) {
    const { data, error } = await supabase.storage.from(bucket)
      .list(prefix, { limit: size, offset: page * size });
    
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    keys.push(...data.map(f => `${prefix}/${f.name}`));
    
    if (data.length < size) break;
    page += 1;
  }
  
  return keys;
}

// Helper: chunk array into groups of n
function chunkArray(arr, n = 100) {
  const result = [];
  for (let i = 0; i < arr.length; i += n) {
    result.push(arr.slice(i, i + n));
  }
  return result;
}

// --- Projects: DELETE (safe deep delete) ---
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isDryRun = req.query.dry === '1';

    // 1. List storage files in uploads bucket with pagination
    const uploadsPrefix = `projects/${id}`;
    let uploadsFiles = [];
    try {
      uploadsFiles = await listAllKeys(UPLOADS_BUCKET, uploadsPrefix);
    } catch (e) {
      // Ignore errors (bucket/prefix might not exist)
    }

    // 2. Query room_scans to find storage files in room-scans bucket
    let roomScansFiles = [];
    try {
      const { data: scans, error: scansErr } = await supabase
        .from('room_scans')
        .select('image_url')
        .eq('project_id', id);
      
      if (!scansErr && scans) {
        roomScansFiles = scans
          .filter(s => s.image_url)
          .map(s => s.image_url.replace(/^.*\/room-scans\//, ''))
          .filter(Boolean);
      }
    } catch (e) {
      // Ignore errors (table might not exist)
    }

    // 3. Count database rows
    let previewsCount = 0;
    let roomScansCount = 0;
    let projectsCount = 0;

    try {
      const { count: pCount } = await supabase
        .from('previews')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', id);
      previewsCount = pCount || 0;
    } catch (e) {
      // Ignore errors
    }

    try {
      const { count: rsCount } = await supabase
        .from('room_scans')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', id);
      roomScansCount = rsCount || 0;
    } catch (e) {
      // Ignore errors
    }

    try {
      const { count: pjCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('id', id);
      projectsCount = pjCount || 0;
    } catch (e) {
      // Ignore errors
    }

    // 4. DRY RUN MODE: Return what would be removed
    if (isDryRun) {
      return res.json({
        ok: true,
        dry: true,
        wouldRemove: {
          uploads: uploadsFiles,
          roomScans: roomScansFiles,
          rows: {
            previews: previewsCount,
            room_scans: roomScansCount,
            projects: projectsCount
          }
        }
      });
    }

    // 5. REAL DELETE: Remove storage files in chunks
    let filesRemoved = 0;

    // Delete uploads files (in chunks of ≤100)
    for (const chunk of chunkArray(uploadsFiles)) {
      try {
        const { error: removeErr } = await supabase.storage.from(UPLOADS_BUCKET).remove(chunk);
        if (removeErr) {
          console.warn(`[delete] uploads remove error: ${removeErr.message}`);
        } else {
          filesRemoved += chunk.length;
        }
      } catch (e) {
        console.warn(`[delete] uploads remove exception: ${e.message}`);
      }
    }

    // Delete room-scans files (in chunks of ≤100)
    for (const chunk of chunkArray(roomScansFiles)) {
      try {
        const { error: removeErr } = await supabase.storage.from('room-scans').remove(chunk);
        if (removeErr) {
          console.warn(`[delete] room-scans remove error: ${removeErr.message}`);
        } else {
          filesRemoved += chunk.length;
        }
      } catch (e) {
        console.warn(`[delete] room-scans remove exception: ${e.message}`);
      }
    }

    // 6. Delete database rows (in order: previews, room_scans, projects)
    try {
      await supabase.from('previews').delete().eq('project_id', id);
    } catch (e) {
      // Continue even if deletion fails (table might not exist or no rows)
    }

    try {
      await supabase.from('room_scans').delete().eq('project_id', id);
    } catch (e) {
      // Continue even if deletion fails
    }

    try {
      await supabase.from('projects').delete().eq('id', id);
    } catch (e) {
      // Continue even if deletion fails
    }

    // 7. Log summary
    console.log(`[delete] ${id} filesRemoved=${filesRemoved} rows={previews:${previewsCount},room_scans:${roomScansCount},projects:${projectsCount}}`);

    res.json({ ok: true });
  } catch (e) {
    console.error('[delete] error', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
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

// --- Admin Cleanup Endpoint ---
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.delete('/api/admin/purge-test-data', async (req, res) => {
  try {
    // Auth guard
    const token = req.headers['x-admin-token'];
    if (!token || !ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    // Required params
    const userParam = req.query.user;
    if (!userParam) {
      return res.status(400).json({ ok: false, error: 'user parameter required' });
    }

    const userIds = userParam.split(',').map(u => u.trim()).filter(Boolean);
    const dryRun = String(req.query.dryRun ?? 'false') === 'true';

    console.log('[admin purge] start', { userIds, dryRun });

    const userDetails = [];
    let totalProjects = 0;
    let totalScans = 0;
    let totalFiles = 0;

    // Process each user
    for (const userId of userIds) {
      // Find projects for this user
      const { data: projects, error: projErr } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', userId);
      if (projErr) throw projErr;

      // Find scans for this user
      const { data: scans, error: scanErr } = await supabase
        .from('room_scans')
        .select('id')
        .eq('user_id', userId);
      if (scanErr) throw scanErr;

      // Find storage files for this user (list files in user's folder)
      const bucket = supabase.storage.from('room-scans');
      let files = [];
      let offset = 0;
      const limit = 1000;
      
      while (true) {
        const { data: fileList, error: listErr } = await bucket.list(userId, {
          limit,
          offset,
          search: ''
        });
        if (listErr) throw listErr;
        if (!fileList || fileList.length === 0) break;
        files = files.concat(fileList.map(f => `${userId}/${f.name}`));
        if (fileList.length < limit) break;
        offset += limit;
      }

      const userDetail = {
        user_id: userId,
        projects: projects?.length || 0,
        scans: scans?.length || 0,
        files: files.length
      };

      userDetails.push(userDetail);
      totalProjects += userDetail.projects;
      totalScans += userDetail.scans;
      totalFiles += userDetail.files;

      console.log('[admin purge] user', userDetail);
    }

    // Dry run - return counts only
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        users: userDetails
      });
    }

    // Execute deletion
    let deletedFiles = 0;
    let deletedScans = 0;
    let deletedProjects = 0;

    // Delete storage files for each user
    const bucket = supabase.storage.from('room-scans');
    for (const userId of userIds) {
      let offset = 0;
      const limit = 1000;
      
      while (true) {
        const { data: fileList, error: listErr } = await bucket.list(userId, {
          limit,
          offset,
          search: ''
        });
        if (listErr) throw listErr;
        if (!fileList || fileList.length === 0) break;
        
        const paths = fileList.map(f => `${userId}/${f.name}`);
        const { error: removeErr } = await bucket.remove(paths);
        if (removeErr) throw removeErr;
        
        deletedFiles += paths.length;
        if (fileList.length < limit) break;
        offset += limit;
      }
    }

    // Delete scans
    const { error: delScansErr } = await supabase
      .from('room_scans')
      .delete()
      .in('user_id', userIds);
    if (delScansErr) throw delScansErr;
    deletedScans = totalScans;

    // Delete projects
    const { error: delProjErr } = await supabase
      .from('projects')
      .delete()
      .in('user_id', userIds);
    if (delProjErr) throw delProjErr;
    deletedProjects = totalProjects;

    console.log('[admin purge] deleted', { projects: deletedProjects, scans: deletedScans, files: deletedFiles });

    return res.json({
      ok: true,
      deleted: {
        projects: deletedProjects,
        scans: deletedScans,
        files: deletedFiles
      },
      users: userDetails
    });
  } catch (err) {
    console.error('[admin purge] error', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
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

// --- Health & Version Aliases under /api ---
app.get('/api/health', healthGet);
app.get('/api/health/live', liveGet);
app.get('/api/health/ready', readyGet);
app.get('/api/health/full', fullGet);
app.get('/api/version', versionGet);

// HEAD handlers for /api aliases
app.head('/api/health', healthHead);
app.head('/api/health/live', healthHead);
app.head('/api/health/ready', healthHead);
app.head('/api/health/full', healthHead);
app.head('/api/version', versionHead);

// --- 404 handler (catch unmatched routes) ---
app.use((_req, _res, next) => {
  next(Object.assign(new Error("Route not found"), { status: 404, code: "not_found" }));
});

// --- Unified error handler ---
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    code: err.code || "internal_error",
    message: err.message || "Server error",
    hint: err.hint,
  });
});

// --- Listen ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`API on ${PORT}`));
