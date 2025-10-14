// routes/entitlements.js (ESM)
import express from 'express';
import { log } from '../utils/logger.js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function yyyymm(d = new Date()) {
  return d.toISOString().slice(0,7).replace('-','');
}

async function supaRest(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json, headers: res.headers };
}

async function getProfile(user_id) {
  const { ok, status, data } = await supaRest(
    'GET',
    `/profiles?user_id=eq.${user_id}&select=user_id,subscription_tier,plan_quota_monthly,plan_credits_used_month,credits_month_key,is_subscribed`,
    null
  );
  if (!ok) throw new Error(`profiles_get_failed_${status}`);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function updateProfile(user_id, patch) {
  const { ok, status, data } = await supaRest(
    'PATCH',
    `/profiles?user_id=eq.${user_id}`,
    patch
  );
  if (!ok) throw new Error(`profiles_patch_failed_${status}`);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function ensureRollover(user_id, profile) {
  const nowKey = yyyymm();
  if (!profile) throw new Error('profile_not_found');
  if (profile.credits_month_key === nowKey) return profile;
  // rollover → reset used to 0 and set current key
  const updated = await updateProfile(user_id, {
    plan_credits_used_month: 0,
    credits_month_key: nowKey
  });
  return updated || profile;
}

function view(profile) {
  const quota = Number(profile.plan_quota_monthly || 0);
  const used  = Number(profile.plan_credits_used_month || 0);
  const remaining = Math.max(0, quota - used);
  return {
    tier: profile.subscription_tier,
    quota, used, remaining,
    credits_month_key: profile.credits_month_key
  };
}

// POST /check  { user_id }
router.post('/check', async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ ok:false, error:'missing_user_id' });
  try {
    let profile = await getProfile(user_id);
    profile = await ensureRollover(user_id, profile);
    const out = view(profile);
    log('entitlements_check', { route:'/entitlements/check', user_id, out });
    return res.status(200).json({ ok:true, ...out });
  } catch (e) {
    log('entitlements_check_error', { route:'/entitlements/check', user_id, err:String(e) });
    return res.status(500).json({ ok:false, error:'entitlements_check_failed' });
  }
});

// POST /consume  { user_id }
router.post('/consume', async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ ok:false, error:'missing_user_id' });
  try {
    // fetch + rollover
    let profile = await getProfile(user_id);
    profile = await ensureRollover(user_id, profile);
    const nowKey = profile.credits_month_key;
    const quota = Number(profile.plan_quota_monthly || 0);
    const used  = Number(profile.plan_credits_used_month || 0);
    const remaining = Math.max(0, quota - used);

    if (remaining <= 0) {
      log('entitlements_quota_exhausted', { route:'/entitlements/consume', user_id, quota, used });
      return res.status(402).json({ ok:false, error:'quota_exhausted', quota, used, remaining:0 });
    }

    // optimistic increment: only update if current used matches
    const nextUsed = used + 1;
    const { ok, status, data } = await supaRest(
      'PATCH',
      `/profiles?user_id=eq.${user_id}&credits_month_key=eq.${nowKey}&plan_credits_used_month=eq.${used}`,
      { plan_credits_used_month: nextUsed }
    );

    if (!ok || !Array.isArray(data) || data.length === 0) {
      // retry once (refetch current and attempt again)
      const fresh = await getProfile(user_id);
      const freshUsed = Number(fresh?.plan_credits_used_month || 0);
      if (freshUsed >= quota) {
        return res.status(402).json({ ok:false, error:'quota_exhausted', quota, used:freshUsed, remaining:0 });
      }
      const retry = await supaRest(
        'PATCH',
        `/profiles?user_id=eq.${user_id}&credits_month_key=eq.${nowKey}&plan_credits_used_month=eq.${freshUsed}`,
        { plan_credits_used_month: freshUsed + 1 }
      );
      if (!retry.ok || !Array.isArray(retry.data) || retry.data.length === 0) {
        log('entitlements_consume_conflict', { route:'/entitlements/consume', user_id, status, retry_status: retry.status });
        return res.status(409).json({ ok:false, error:'consume_conflict' });
      }
      const out2 = view(retry.data[0]);
      log('entitlements_consume_ok', { route:'/entitlements/consume', user_id, out: out2 });
      return res.status(200).json({ ok:true, used: out2.used, remaining: out2.remaining });
    }

    const out = view(data[0]);
    log('entitlements_consume_ok', { route:'/entitlements/consume', user_id, out });
    return res.status(200).json({ ok:true, used: out.used, remaining: out.remaining });
  } catch (e) {
    log('entitlements_consume_error', { route:'/entitlements/consume', user_id, err:String(e) });
    return res.status(500).json({ ok:false, error:'entitlements_consume_failed' });
  }
});

export default router;
