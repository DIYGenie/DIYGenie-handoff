// routes/preview.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { submitPreviewJob, fetchPreviewStatus, isStub } from '../services/decor8Client.js';

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

router.post('/preview/decor8', async (req, res) => {
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

router.get('/preview/status/:projectId', async (req, res) => {
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
router.get('/selftest/preview/:projectId', async (req, res) => {
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
