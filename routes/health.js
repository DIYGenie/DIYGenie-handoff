// routes/health.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { maskEnv, log } from '../utils/logger.js';
import { readFileSync } from 'fs';

const router = express.Router();

// Read package.json for version info
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function modeFlags() {
  const decor8Mode = !process.env.DECOR8_BASE_URL || process.env.DECOR8_BASE_URL.startsWith('stub') ? 'stub' : 'live';
  const openaiMode = process.env.OPENAI_API_KEY ? 'live' : 'stub';
  return { decor8: decor8Mode, openai: openaiMode };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', version: pkg.version, uptime_s: Math.floor(process.uptime()) });
});

router.get('/health/live', (_req, res) => {
  res.json({ ok: true, status: 'live' });
});

router.get('/health/ready', async (_req, res) => {
  const checks = [];
  
  // DB check using Supabase - simple query to test connection
  try {
    const { error } = await supabase.from('projects').select('id').limit(1);
    checks.push({ name: 'db', ok: !error });
  } catch (e) {
    checks.push({ name: 'db', ok: false, err: String(e.message || e) });
  }
  
  // Env presence
  checks.push({ name: 'env.SUPABASE_URL', ok: !!process.env.SUPABASE_URL });
  checks.push({ name: 'env.SUPABASE_SERVICE_KEY', ok: !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) });
  checks.push({ name: 'env.DECOR8_BASE_URL', ok: !!process.env.DECOR8_BASE_URL });
  
  const allOk = checks.every(c => c.ok);
  if (!allOk) log('health.ready.fail', { checks });
  res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
});

router.get('/health/full', async (_req, res) => {
  const started = Date.now();
  const checks = [];

  // DB roundtrip using Supabase
  try {
    const { error } = await supabase.from('projects').select('id').limit(1);
    checks.push({ name: 'db.query', ok: !error });
  } catch (e) {
    checks.push({ name: 'db.query', ok: false, err: String(e.message || e) });
  }

  // Versions + modes
  const version = {
    service: pkg.name || 'diy-genie-webhooks',
    version: pkg.version || '0.0.0',
    node: process.version,
  };
  const modes = modeFlags();

  // Env summary (redacted)
  const env = maskEnv();

  const payload = {
    ok: checks.every(c => c.ok),
    checks,
    modes,
    version,
    uptime_s: Math.floor(process.uptime()),
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    duration_ms: Date.now() - started,
    env_summary: {
      DECOR8_BASE_URL: env.DECOR8_BASE_URL || process.env.DECOR8_BASE_URL || 'unset',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'unset',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'unset',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'set' : 'unset'
    }
  };

  log('health.full', { ok: payload.ok, modes, duration_ms: payload.duration_ms });
  res.status(payload.ok ? 200 : 503).json(payload);
});

export default router;
