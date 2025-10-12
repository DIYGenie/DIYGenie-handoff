// services/decor8Client.js
import fetch from 'node-fetch';

const DECOR8_BASE_URL = process.env.DECOR8_BASE_URL || 'stub|decor8';
const DECOR8_API_KEY   = process.env.DECOR8_API_KEY || '';

export function isStub() {
  return !DECOR8_BASE_URL || DECOR8_BASE_URL.startsWith('stub');
}

export async function submitPreviewJob({ imageUrl, prompt, roomType, scalePxPerIn, dimensionsJson }) {
  if (isStub()) {
    const stubId = `stub_${Date.now()}`;
    return { ok: true, jobId: stubId, mode: 'stub' };
  }
  const url = `${DECOR8_BASE_URL.replace(/\/$/,'')}/preview/jobs`;
  const payload = {
    image_url: imageUrl,
    prompt: prompt || '',
    room_type: roomType || null,
    // Forward AR context if available; backend may ignore, we persist anyway.
    ar_context: {
      scale_px_per_in: scalePxPerIn ?? null,
      dimensions: dimensionsJson ?? null,
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DECOR8_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[decor8 submit] ${res.status} ${text}`);
  }
  const data = await res.json();
  // Expect { id, status } or similar; keep flexible
  return { ok: true, jobId: data.id || data.job_id || null, raw: data, mode: 'live' };
}

export async function fetchPreviewStatus(jobId) {
  if (isStub()) {
    // Pretend it finishes quickly
    return {
      ok: true,
      status: 'ready',
      preview_url: `https://picsum.photos/seed/${jobId}/1600/1200`,
      thumb_url:  `https://picsum.photos/seed/${jobId}/600/400`,
      raw: { stub: true }
    };
  }
  const url = `${DECOR8_BASE_URL.replace(/\/$/,'')}/preview/jobs/${encodeURIComponent(jobId)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${process.env.DECOR8_API_KEY}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[decor8 status] ${res.status} ${text}`);
  }
  const data = await res.json();
  // Normalize plausible fields
  const status = data.status || data.state || 'processing';
  const previewUrl = data.preview_url || data.output_url || data.result?.url || null;
  const thumbUrl   = data.thumb_url   || data.result?.thumb || null;
  return { ok: true, status, preview_url: previewUrl, thumb_url: thumbUrl, raw: data };
}
