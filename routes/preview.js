// routes/preview.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { submitPreviewJob, fetchPreviewStatus, isStub } from '../services/decor8Client.js';
import { log } from '../utils/logger.js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, user_id, name, goal, room_type, input_image_url, preview_url, preview_status, scale_px_per_in, dimensions_json, preview_meta')
    .eq('id', projectId)
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

async function savePreviewQueued(projectId, jobId, extras = {}) {
  const meta = { ...(extras || {}), jobId, mode: isStub() ? 'stub' : 'live' };
  
  const { error } = await supabase
    .from('projects')
    .update({
      preview_status: 'queued',
      preview_meta: meta,
      updated_at: new Date().toISOString()
    })
    .eq('id', projectId);
  
  if (error) throw error;
}

async function savePreviewReady(projectId, previewUrl, extras = {}) {
  const meta = { ...(extras || {}) };
  
  const { error } = await supabase
    .from('projects')
    .update({
      preview_url: previewUrl,
      preview_status: 'ready',
      preview_meta: meta,
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', projectId);
  
  if (error) throw error;
}

/**
 * POST /
 * Stub Decor8 preview: validates input and returns a fake preview_url.
 * No external calls. Safe for offline/dev use.
 */
router.post('/', (req, res) => {
  const { photo_url, prompt, measurements } = req.body || {};

  const missing = [];
  if (!photo_url || typeof photo_url !== 'string') missing.push('photo_url');
  if (!prompt || typeof prompt !== 'string') missing.push('prompt');

  if (missing.length) {
    log('preview.validation_error', {
      route: '/preview',
      event: 'validation_error',
      missing,
    });
    return res.status(400).json({
      ok: false,
      error: 'invalid_payload',
      fields_missing: missing,
    });
  }

  // Build deterministic stub URL using a short, iOS-safe seed:
  // Use SHA-1 hex of (photo_url|prompt) to avoid very long/encoded seeds that iOS Image chokes on.
  const seedRaw = `${photo_url}|${prompt}`.trim();
  const seed = createHash('sha1').update(seedRaw).digest('hex'); // e.g. "a94a8fe5ccb19ba61c4c..."
  const previewUrl = `https://picsum.photos/seed/${seed}/1024/768`;

  log('preview.stub_generate', {
    route: '/preview',
    event: 'stub_generate',
    source: 'stub|decor8',
    has_measurements: Boolean(measurements && typeof measurements === 'object'),
  });

  return res.status(200).json({
    ok: true,
    source: 'stub|decor8',
    preview_url: previewUrl,
    echo: {
      photo_url,
      prompt,
      measurements: measurements || null,
    },
  });
});

router.post('/decor8', async (req, res) => {
  try {
    const { projectId } = req.body || {};
    if (!projectId) return res.status(400).json({ ok:false, error:'projectId required' });

    const p = await getProject(projectId);
    if (!p) return res.status(404).json({ ok:false, error:'project not found' });
    if (!p.input_image_url) return res.status(400).json({ ok:false, error:'input_image_url missing' });

    const submit = await submitPreviewJob({
      imageUrl: p.input_image_url,
      prompt:   p.goal || '',
      roomType: p.room_type || null,
      scalePxPerIn: p.scale_px_per_in ?? null,
      dimensionsJson: p.dimensions_json ?? null,
    });

    await savePreviewQueued(projectId, submit.jobId, { submit_raw: submit.raw || null });

    console.log('[preview submit] queued', { projectId, jobId: submit.jobId, mode: submit.mode });
    return res.json({ ok:true, projectId, jobId: submit.jobId, mode: submit.mode });
  } catch (e) {
    console.error('[preview submit] error', e);
    return res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

router.get('/status/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const p = await getProject(projectId);
    if (!p) return res.status(404).json({ ok:false, error:'project not found' });

    // If already ready, short-circuit
    if (p.preview_status === 'ready' && p.preview_url) {
      return res.json({ ok:true, status:'ready', preview_url: p.preview_url, cached:true });
    }

    // Must have a jobId in meta to poll
    const jobId = p.preview_meta?.jobId || p.preview_meta?.job_id || null;
    if (!jobId) return res.json({ ok:true, status: p.preview_status || 'idle', preview_url: p.preview_url || null });

    const status = await fetchPreviewStatus(jobId);

    console.log('[preview poll]', { projectId, jobId, status: status.status });
    if (status.status === 'ready' && status.preview_url) {
      await savePreviewReady(projectId, status.preview_url, { thumb_url: status.thumb_url, status_raw: status.raw || null });
      return res.json({ ok:true, status:'ready', preview_url: status.preview_url });
    }

    return res.json({ ok:true, status: status.status, preview_url: null });
  } catch (e) {
    console.error('[preview poll] error', e);
    return res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

// Diagnostics for quick checks
router.get('/selftest/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const p = await getProject(projectId);
    if (!p) return res.status(404).json({ ok:false, error:'project not found' });
    const jobId = p.preview_meta?.jobId || null;
    res.json({
      ok: true,
      project: {
        id: p.id,
        status: p.status,
        preview_status: p.preview_status,
        has_preview_url: !!p.preview_url,
        has_image: !!p.input_image_url,
        has_scale: p.scale_px_per_in != null,
        has_dimensions: !!p.dimensions_json,
      },
      jobId
    });
  } catch (e) {
    console.error('[preview selftest] error', e);
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

export default router;
