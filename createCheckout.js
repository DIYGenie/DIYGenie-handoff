// node createCheckout.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

(async () => {
  const usePro = process.argv.includes('--pro');
  const priceId = usePro ? process.env.PRO_PRICE_ID : process.env.CASUAL_PRICE_ID;
  console.log('USING PRICE', process.argv.includes('--pro')?'PRO':'CASUAL', priceId);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: process.env.TEST_USER_ID,
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel'
  });
  console.log('Checkout URL:', session.url);
})();