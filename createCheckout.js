// node createCheckout.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

(async () => {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: process.env.CASUAL_PRICE_ID, quantity: 1 }],
    success_url: "https://example.com/success",
    cancel_url: "https://example.com/cancel",
    client_reference_id: process.env.TEST_USER_ID, // <-- Supabase user_id UUID
  });
  console.log("Checkout URL:", session.url);
})();