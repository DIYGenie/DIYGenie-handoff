const cors = require('cors');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- CORS: allow Expo preview & QR domains ---
app.use(cors({
  origin: (origin, cb) => cb(null, true),   // reflect any origin (dev only)
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

// Extra safety for frameworks that send unusual preflights
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const Stripe = require('stripe');
const multer = require('multer');

const PORT = process.env.PORT || 5000;
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_ID_CASUAL = process.env.CASUAL_PRICE_ID;
const PRICE_ID_PRO    = process.env.PRO_PRICE_ID;
const BUCKET = process.env.SUPABASE_BUCKET || "uploads";
const DECOR8_URL = "https://api.decor8.ai/generate_designs_for_room";

// Helper function for credit gating
async function checkCredit(user_id, kind='plan') {
  const { data, error } = await supabase.rpc('use_plan_credit', { p_user_id: user_id, p_kind: kind });
  if (error) return { ok:false, code:500, error: 'supabase_error' };
  if (!data.ok) {
    const code = data.error === 'exhausted' ? 402 : 403;
    return { ok:false, code, error: data.error, meta: data };
  }
  return { ok:true, meta: data };
}

// Request logging middleware
app.use((req,_res,next)=>{ console.log('REQ', req.method, req.url); next(); });

// Webhook route MUST be before any JSON middleware - uses raw body
app.post('/webhook', express.raw({ type:'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Bad signature:', err.message);
    return res.sendStatus(400);
  }

  const obj = event.data.object;

  console.log('EVENT', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      // client_reference_id should be your Supabase user_id when you create the session
      await supabase.from('profiles')
        .update({ stripe_customer_id: obj.customer })
        .eq('user_id', obj.client_reference_id);
    }

    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id || sub.items?.data?.[0]?.plan?.id;
      console.log('SUB MAP', {
        priceId,
        CASUAL: process.env.CASUAL_PRICE_ID,
        PRO: process.env.PRO_PRICE_ID
      });
      const m = priceId===process.env.PRO_PRICE_ID ? {tier:'pro',quota:25}
              : priceId===process.env.CASUAL_PRICE_ID ? {tier:'casual',quota:5}
              : {tier:'free',quota:0};
      const periodEndSec = sub.current_period_end || sub.current_period?.end || null;
      const currentPeriodEnd = periodEndSec ? new Date(periodEndSec*1000).toISOString() : null;

      await supabase.from('profiles').update({
        stripe_subscription_id: sub.id,
        stripe_subscription_status: sub.status,
        is_subscribed: sub.status === 'active',
        subscription_tier: m.tier,
        plan_quota_monthly: m.quota,
        plan_credits_used_month: 0,
        current_period_end: currentPeriodEnd,
      }).eq('stripe_customer_id', sub.customer);
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await supabase.from('profiles').update({
        stripe_subscription_id: sub.id,
        stripe_subscription_status: 'canceled',
        is_subscribed: false,
        subscription_tier: 'free',
        plan_quota_monthly: 0
      }).eq('stripe_customer_id', sub.customer);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.sendStatus(500);
  }
});

// --- ENTITLEMENTS (dev stub) ---
function entitlementsHandler(req, res) {
  res.json({ ok: true, tier: 'Free', quota: 5, remaining: 5 });
}

// Support both with and without /api and with/without :user_id
app.get('/me/entitlements/:user_id', entitlementsHandler);
app.get('/api/me/entitlements/:user_id', entitlementsHandler);
app.get('/me/entitlements', entitlementsHandler);
app.get('/api/me/entitlements', entitlementsHandler);

/* plan/previews credit */
app.post('/use-plan', async (req, res) => {
  try {
    const { user_id, kind } = req.body || {};
    if (!user_id) return res.status(400).json({ ok:false, error:'missing user_id' });
    const k = (kind === 'preview') ? 'preview' : 'plan';
    const { data, error } = await supabase.rpc('use_plan_credit', { p_user_id: user_id, p_kind: k });
    if (error) return res.status(400).json({ ok:false, error: error.message });
    return res.json(data);
  } catch (e) {
    console.error('use-plan error', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

// Credit-gated plan generation
app.post('/generate-plan', async (req,res) => {
  const { user_id, ...rest } = req.body || {};
  if (!user_id) return res.status(400).json({ ok:false, error:'missing user_id' });
  const gate = await checkCredit(user_id, 'plan');
  if (!gate.ok) return res.status(gate.code).json(gate.meta);
  // ...do plan generation...
  return res.json({ ok:true, used: gate.meta.used, remaining: gate.meta.remaining });
});

// Credit-gated preview generation
app.post('/generate-preview', async (req,res) => {
  const { user_id, ...rest } = req.body || {};
  if (!user_id) return res.status(400).json({ ok:false, error:'missing user_id' });
  const gate = await checkCredit(user_id, 'preview');
  if (!gate.ok) return res.status(gate.code).json(gate.meta);
  // ...call Decor8...
  return res.json({ ok:true, used: gate.meta.used, remaining: gate.meta.remaining });
});

// List projects for a user
app.get('/api/projects', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ ok:false, error:'missing_user_id' });

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending:false });

  if (error) return res.status(500).json({ ok:false, error:'db_error' });
  res.json({ ok:true, items:data });
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { user_id, name, input_image_url } = req.body;
    if (!user_id || !name) return res.status(400).json({ ok:false, error:'missing_fields' });

    const { data, error } = await supabase
      .from('projects')
      .insert([{ user_id, name, status: 'new', input_image_url }])
      .select()
      .single();

    if (error) throw error;
    res.json({ ok:true, item: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// Get single project by ID
app.get('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) return res.status(500).json({ ok:false, error: String(error.message || error) });
  res.json({ ok:true, item: data });
});

// --- Preview helpers ---
async function setProjectFields(id, fields) {
  const { error } = await supabase.from('projects').update(fields).eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// Start preview (immediate ack + flip to ready after 5s with placeholder image)
async function startPreview(req, res) {
  const { id } = req.params;
  try {
    await setProjectFields(id, { status: 'preview_requested' });
    // simulate generation
    setTimeout(async () => {
      try {
        await setProjectFields(id, {
          status: 'preview_ready',
          preview_url: `https://picsum.photos/seed/${id}/1200/800`,
        });
      } catch (_) { /* swallow */ }
    }, 5000);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

// Force ready now (handy for manual unstick & testing)
async function forceReady(req, res) {
  const { id } = req.params;
  try {
    await setProjectFields(id, {
      status: 'preview_ready',
      preview_url: `https://picsum.photos/seed/${id}/1200/800`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

// Routes (both POST and GET for convenience in browser)
app.post('/api/projects/:id/preview', startPreview);
app.get ('/api/projects/:id/preview',  startPreview); // optional

app.post('/api/projects/:id/force-ready', forceReady);
app.get ('/api/projects/:id/force-ready',  forceReady); // optional

// --- FORCE READY ALL PREVIEWS ---
app.get('/api/projects/force-ready-all', async (req, res) => {
  try {
    const { user_id } = req.query;
    let q = supabase
      .from('projects')
      .update({
        status: 'preview_ready',
        preview_url: `https://picsum.photos/seed/bulk-${Date.now()}/1200/800`,
      })
      .eq('status', 'preview_requested');
    if (user_id) q = q.eq('user_id', user_id);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Build without preview
app.patch('/api/projects/:id/build_without_preview', async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('projects').update({ status:'plan_ready' }).eq('id', id);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// Set cache control headers to prevent caching issues in Replit
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Basic route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is running!',
    packages: ['express', 'stripe', 'body-parser', '@supabase/supabase-js'],
    status: 'ready'
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Create checkout session route - based on your original code
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ 
        price: process.env.CASUAL_PRICE_ID, 
        quantity: 1 
      }],
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      client_reference_id: process.env.TEST_USER_ID, // your Supabase user_id
    });
    
    res.json({ 
      checkoutUrl: session.url,
      sessionId: session.id 
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      message: error.message 
    });
  }
});

// Route to create and display checkout URL (like your node script)
app.get('/create-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ 
        price: process.env.CASUAL_PRICE_ID, 
        quantity: 1 
      }],
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      client_reference_id: process.env.TEST_USER_ID,
    });
    
    res.json({
      message: 'Checkout session created successfully!',
      checkoutUrl: session.url,
      sessionId: session.id,
      instructions: 'Use the checkoutUrl to redirect users to Stripe checkout'
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      message: error.message 
    });
  }
});

// Start server - bind to all hosts for Replit compatibility
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
