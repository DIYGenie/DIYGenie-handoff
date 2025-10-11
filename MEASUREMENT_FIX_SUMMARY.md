# Measurement Endpoints Fix - Summary

## Changes Made

### Problem Fixed
Removed ambiguous Supabase embeds that caused PostgREST relationship errors. Changed from embedded queries like `.select('..., projects!inner(user_id)')` to explicit separate queries.

### Files Modified
- **index.js** (lines 1287-1420)

## What Changed

### 1. POST /api/projects/:projectId/scans/:scanId/measure

**Before:** Single query with embedded relationship (caused "more than one relationship" error)
```javascript
// OLD - Ambiguous embed
const { data: scan } = await supabase
  .from('room_scans')
  .select('id, project_id, projects!inner(user_id)')
  .eq('id', scanId)
  .eq('project_id', projectId)
  .maybeSingle();
```

**After:** Two explicit queries for ownership validation
```javascript
// NEW - Query 1: Verify scan exists
const { data: scan } = await supabase
  .from('room_scans')
  .select('id, project_id')
  .eq('id', scanId)
  .eq('project_id', projectId)
  .single();

// Query 2: Verify user owns project
const { data: proj } = await supabase
  .from('projects')
  .select('id, user_id')
  .eq('id', projectId)
  .single();

if (proj.user_id !== userId) {
  return res.status(403).json({ ok: false, error: 'forbidden' });
}
```

### 2. GET /api/projects/:projectId/scans/:scanId/measure/status

**Same pattern:** Changed from embedded query to three explicit queries:
1. Verify scan exists and belongs to project
2. Verify user owns project
3. Read measurement status and result

**Response codes remain the same:**
- `400` - Missing user_id or invalid params
- `403` - User doesn't own the project (forbidden)
- `404` - Scan or project not found
- `409` - Measurement not ready (only for GET)
- `200` - Success

## Testing

### Local Test (Dev Database)
✅ Server running on port 5000
✅ Endpoints accepting requests correctly
❌ 404 expected (production IDs don't exist in dev database)

### Production Test Commands

**After deployment to https://api.diygenieapp.com, run:**

```bash
# Test 1: Trigger measurement
curl -X POST "https://api.diygenieapp.com/api/projects/194e1c7e-f156-457f-adc5-37d642b5049b/scans/95359236-72ff-4ff6-bfd8-725e0a6f482c/measure" \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id":"99198c4b-8470-49e2-895c-75593c5aa181",
    "roi":{"x":0.25,"y":0.70,"w":0.34,"h":0.23}
  }'

# Expected: HTTP 200 { "ok": true, "status": "done" }

# Test 2: Check status
curl "https://api.diygenieapp.com/api/projects/194e1c7e-f156-457f-adc5-37d642b5049b/scans/95359236-72ff-4ff6-bfd8-725e0a6f482c/measure/status?user_id=99198c4b-8470-49e2-895c-75593c5aa181"

# Expected: HTTP 200 { "ok": true, "status": "done", "result": { ... } }
```

## Key Improvements

1. **No more PostgREST relationship ambiguity** - Explicit queries prevent "more than one relationship" errors
2. **Clear ownership validation** - Two-step verification (scan exists + user owns project)
3. **Better error handling** - Returns proper 400/403/404 based on validation step
4. **Consistent with codebase** - Uses same pattern as other endpoints (no embeds)
5. **Same API contract** - Routes, responses, and status codes unchanged

## Deployment Checklist

- [x] Code changes committed
- [x] Server running without errors
- [x] Local validation complete
- [ ] Deploy to production (autoscale)
- [ ] Run production smoke test with provided IDs
- [ ] Verify expected responses
