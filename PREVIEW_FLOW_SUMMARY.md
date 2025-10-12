# End-to-End Preview Flow Summary

## Overview
Added modular preview flow with service abstraction, flexible AR context forwarding, and comprehensive logging. The system supports both stub (development) and live (Decor8) modes based on environment configuration.

## New Files Created

### 1. `services/decor8Client.js` - Decor8 API Service
Centralized service for Decor8 API interactions with stub fallback.

**Key Features:**
- **Stub Mode**: Automatic fallback when `DECOR8_BASE_URL` is missing or starts with "stub"
- **Flexible AR Context**: Forwards `scale_px_per_in` and `dimensions_json` to backend
- **Error Handling**: Clear error messages with HTTP status codes

**Functions:**
- `isStub()` - Check if running in stub mode
- `submitPreviewJob({ imageUrl, prompt, roomType, scalePxPerIn, dimensionsJson })` - Submit preview generation job
- `fetchPreviewStatus(jobId)` - Poll job status and retrieve results

### 2. `routes/preview.js` - Preview Router
Express router with preview endpoints using Supabase.

**Endpoints:**

#### `POST /preview/decor8`
Submit a preview generation job.

**Request Body:**
```json
{
  "projectId": "uuid"
}
```

**Response:**
```json
{
  "ok": true,
  "projectId": "uuid",
  "jobId": "job_123",
  "mode": "stub|live"
}
```

**Logs:** `[preview submit] queued { projectId, jobId, mode }`

#### `GET /preview/status/:projectId`
Poll preview job status.

**Response (queued/processing):**
```json
{
  "ok": true,
  "status": "queued|processing",
  "preview_url": null
}
```

**Response (ready):**
```json
{
  "ok": true,
  "status": "ready",
  "preview_url": "https://...",
  "cached": false
}
```

**Logs:** `[preview poll] { projectId, jobId, status }`

#### `GET /selftest/preview/:projectId`
Diagnostic endpoint for quick checks.

**Response:**
```json
{
  "ok": true,
  "project": {
    "id": "uuid",
    "status": "active",
    "preview_status": "ready",
    "has_preview_url": true,
    "has_image": true,
    "has_scale": false,
    "has_dimensions": false
  },
  "jobId": "job_123"
}
```

### 3. Router Integration
Mounted preview router in `index.js` at root level (line 1979-1980).

## Database Flow

### Submit Flow
1. Validate project exists and has `input_image_url`
2. Submit job to Decor8 (or stub)
3. Update project:
   - `preview_status = 'queued'`
   - `preview_meta = { jobId, mode, submit_raw }`
   - `updated_at = now()`

### Poll Flow
1. Check if already ready (cached response)
2. Extract `jobId` from `preview_meta`
3. Fetch status from Decor8
4. If ready:
   - `preview_url = <result_url>`
   - `preview_status = 'ready'`
   - `status = 'active'`
   - `preview_meta = { thumb_url, status_raw }`

## AR Context Support

The service automatically forwards AR measurement data if available:

```javascript
{
  ar_context: {
    scale_px_per_in: project.scale_px_per_in || null,
    dimensions: project.dimensions_json || null
  }
}
```

This allows the Decor8 backend to use real-world measurements for more accurate previews.

## Mode Detection

**Stub Mode (Development):**
- Triggers when `DECOR8_BASE_URL` is empty or starts with "stub"
- Instant "ready" response with Picsum placeholder images
- No external API calls

**Live Mode (Production):**
- Uses actual Decor8 API at `DECOR8_BASE_URL`
- Requires `DECOR8_API_KEY` for authentication
- Async job processing with polling

## Environment Variables

```bash
# Required for live mode
DECOR8_BASE_URL=https://api.decor8.ai  # or "stub" for dev
DECOR8_API_KEY=your_api_key_here

# Already configured
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

## Usage Example

### From Client App

```javascript
// 1. Submit preview job
const submit = await fetch('/preview/decor8', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: 'abc-123' })
});
const { jobId, mode } = await submit.json();

// 2. Poll for status
const poll = setInterval(async () => {
  const res = await fetch(`/preview/status/${projectId}`);
  const data = await res.json();
  
  if (data.status === 'ready') {
    clearInterval(poll);
    // Show preview: data.preview_url
  }
}, 2000);
```

## Expected Logs

**Submit:**
```
[preview submit] queued { projectId: 'abc-123', jobId: 'job_456', mode: 'stub' }
```

**Poll (processing):**
```
[preview poll] { projectId: 'abc-123', jobId: 'job_456', status: 'processing' }
```

**Poll (ready):**
```
[preview poll] { projectId: 'abc-123', jobId: 'job_456', status: 'ready' }
```

## Acceptance Checklist

✅ Service abstraction separates API logic from routes  
✅ Stub mode for development without API keys  
✅ Live mode for production Decor8 integration  
✅ AR context (scale, dimensions) forwarded when available  
✅ Solid logging at each step  
✅ No manual token swaps (uses env vars)  
✅ Additive only (existing routes unchanged)  
✅ Database properly updated on submit and ready states  
✅ Diagnostic endpoint for troubleshooting  

## Integration with App

The ProjectDetails component can now:
1. Call `POST /preview/decor8` with `projectId`
2. Poll `GET /preview/status/:projectId` until ready
3. Display `preview_url` in hero image
4. Fall back to scan/upload image until preview ready
