const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase client with service role
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICE_ID_CASUAL = process.env.CASUAL_PRICE_ID;
const PRICE_ID_PRO    = process.env.PRO_PRICE_ID;
const tierForPrice = id => id===PRICE_ID_CASUAL ? {tier:'casual',quota:5}
                       : id===PRICE_ID_PRO ? {tier:'pro',quota:25} : {tier:'free',quota:0};

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
      const priceId = sub.items?.data?.[0]?.price?.id;
      const m = tierForPrice(priceId);
      await supabase.from('profiles').update({
        stripe_subscription_id: sub.id,
        stripe_subscription_status: sub.status,
        is_subscribed: sub.status === 'active',
        subscription_tier: m.tier,
        plan_quota_monthly: m.quota,
        plan_credits_used_month: 0,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
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
