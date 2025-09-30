const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase client with service role
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// JSON middleware AFTER webhook route
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Entitlements summary
app.get('/me/entitlements/:uid', async (req, res) => {
  const uid = req.params.uid;
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', uid).single();
  if (error || !data) return res.status(404).json({ ok:false, error:'not_found' });
  const tier = data.subscription_tier || 'free';
  const base = tier==='pro'?25 : tier==='casual'?5 : 2;
  const quota = data.plan_quota_monthly>0 ? data.plan_quota_monthly : base;
  const used = data.plan_credits_used_month || 0;
  return res.json({ ok:true, tier, status:data.stripe_subscription_status, is_subscribed:data.is_subscribed, quota, used, remaining: Math.max(0, quota-used), current_period_end:data.current_period_end });
});

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
  const { data, error } = await supabase.from('projects').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ ok:false, error:'not_found' });
  res.json({ ok:true, item:data });
});

// Request a preview
app.post('/api/projects/:id/preview', async (req, res) => {
  const { id } = req.params;
  try {
    // mark requested
    await supabase.from('projects').update({ status:'preview_requested' }).eq('id', id);

    // dev-only: fake background job → ready in ~6s
    setTimeout(async () => {
      await supabase.from('projects')
        .update({
          status: 'preview_ready',
          preview_url: `https://picsum.photos/seed/${id}/1200/800`
        })
        .eq('id', id);
    }, 6000);

    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
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
