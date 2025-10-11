# Decor8 Integration Summary

## Overview
Successfully migrated preview generation from stub implementation to real Decor8 AI integration with async job-based workflow.

## Changes Made

### 1. Database Migration
**File**: `migrations/add_preview_job_id.sql`
- Added `preview_job_id` column to `projects` table
- Stores Decor8 job ID for tracking async generation

### 2. Helper Functions

**callDecor8Status(jobId)**
- Location: `index.js` (line 253)
- Purpose: Polls Decor8 API for job status
- Returns: `{ status: 'queued'|'running'|'done'|'failed', url?: string }`

**getProjectForUser(projectId, userId)**
- Location: `index.js` (line 83)
- Purpose: Fetches project with ownership verification
- Returns: Project data or null if not found/unauthorized

**updatePreviewState(projectId, patch)**
- Location: `index.js` (line 95)
- Purpose: Updates preview-related fields in projects table
- Returns: Updated record

### 3. API Endpoints

**POST /api/projects/:projectId/preview/start**
- Triggers Decor8 preview generation
- Returns: `202 Accepted` with `{ ok: true, status: 'queued', jobId: '...' }`
- Updates DB: Sets `preview_status: 'queued'`, `preview_job_id: jobId`
- Re-use guard: Returns existing preview if already done

**GET /api/projects/:projectId/preview/status**
- Polls Decor8 job status
- Auto-updates DB when job completes
- Status mapping: `running` → `processing`, `queued` → `queued`, `done` → `done`, `failed` → `error`
- Returns final URL when done

### 4. Status Flow
```
Client → POST /preview/start → Server
                                   ↓
                              Call Decor8 API
                                   ↓
                           Save job_id to DB
                                   ↓
Client ← 202 Accepted ← { status: 'queued', jobId }

[Background Polling]
Client → GET /preview/status → Server
                                   ↓
                          Call Decor8 /job_status/{jobId}
                                   ↓
                          Update DB with status/URL
                                   ↓
Client ← Response ← { status: 'processing'|'done'|'error', url? }
```

### 5. Cleanup
- Removed `/debug/decor8` endpoint (was temporary for verification)

## Testing
Server successfully restarted with no errors. All preview endpoints ready for production use.

## Configuration Required
- `DECOR8_BASE_URL`: Base URL for Decor8 API
- `DECOR8_API_KEY`: Bearer token for authentication

## Next Steps for Client
1. Call `POST /api/projects/:projectId/preview/start` with:
   - `user_id` (required)
   - `room_type` (optional, default: 'livingroom')
   - `design_style` (optional, default: 'modern')
   - `image_url` (optional, falls back to project's input_image_url)

2. Poll `GET /api/projects/:projectId/preview/status?user_id=...` until:
   - Response returns `{ status: 'done', url: '...' }`
   - Or `{ status: 'error' }` if failed

3. Display preview image from returned URL
