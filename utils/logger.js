// utils/logger.js
const SENSITIVE_KEYS = ['DECOR8_API_KEY','OPENAI_API_KEY','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','STRIPE_SECRET_KEY'];

function redact(val='') {
  if (!val) return val;
  try {
    const u = new URL(val);
    const host = u.host || 'hidden';
    return `***@${host}`;
  } catch {
    if (val.length <= 6) return '***';
    return `${val.slice(0,2)}***${val.slice(-2)}`;
  }
}

function maskEnv(env = process.env) {
  const out = {};
  for (const k of Object.keys(env)) {
    if (SENSITIVE_KEYS.includes(k)) out[k] = '***';
  }
  if (env.DATABASE_URL) out.DATABASE_URL = redact(env.DATABASE_URL);
  if (env.DECOR8_BASE_URL) out.DECOR8_BASE_URL = env.DECOR8_BASE_URL.startsWith('stub') ? 'stub' : env.DECOR8_BASE_URL;
  return out;
}

function log(event, payload = {}) {
  // single line JSON for easier parsing
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

export { log, maskEnv, redact };
