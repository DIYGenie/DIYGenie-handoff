const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(bodyParser.json());
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
