# Demo Project Endpoint - Bug Fix Summary

## Issue
The `/api/demo-project` endpoint was failing with `insert_failed` error due to database check constraint violations.

## Root Causes Identified

### 1. Invalid Budget Value
- **Problem:** Used `budget: 'under-100'` which violated the `projects_budget_check` constraint
- **Valid values:** `$`, `$$`, or `$$$`
- **Fix:** Changed to `budget: '$$'` (medium budget)

### 2. Invalid skill_level Field
- **Problem:** Included `skill_level: 'intermediate'` which violated the `projects_skill_level_check` constraint
- **Discovery:** The regular project creation does NOT insert `skill_level` into the database
- **Fix:** Removed `skill_level` field from the insert statement

### 3. Insufficient Error Logging
- **Problem:** Generic error messages made debugging difficult
- **Fix:** Enhanced error logging to show full error details (message, details, hint, code)

## Changes Made

### Updated `/api/demo-project` endpoint (index.js:901)

**Before:**
```javascript
const demoProject = {
  user_id,
  name: 'Modern Floating Shelves (Demo)',
  budget: 'under-100',           // ❌ Invalid value
  skill_level: 'intermediate',   // ❌ Not allowed
  status: 'plan_ready',
  is_demo: true,
  // ... other fields
};
```

**After:**
```javascript
const demoProject = {
  user_id,
  name: 'Modern Floating Shelves (Demo)',
  budget: '$$',                  // ✅ Valid: $, $$, or $$$
  status: 'plan_ready',          // ✅ Removed skill_level
  is_demo: true,
  input_image_url: '...',
  preview_url: '...',
  plan_json: demoPlanJson
};
```

**Enhanced Error Logging:**
```javascript
if (insertErr) {
  console.error('[demo-project] Insert error:', {
    message: insertErr.message,
    details: insertErr.details,
    hint: insertErr.hint,
    code: insertErr.code
  });
  return res.status(500).json({ 
    ok: false, 
    error: 'insert_failed', 
    details: insertErr.message 
  });
}
```

## Test Results

### ✅ Test 1: Create Demo Project
```bash
curl -X POST http://localhost:5000/api/demo-project \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"550e8400-e29b-41d4-a716-446655440099"}'
```

**Response:**
```json
{
  "ok": true,
  "item": {
    "id": "bfeebb85-4b85-45bb-95bc-1f8c85ec36a4",
    "name": "Modern Floating Shelves (Demo)",
    "status": "plan_ready",
    "input_image_url": "https://images.unsplash.com/...",
    "preview_url": "https://images.unsplash.com/..."
  },
  "existed": false
}
```

### ✅ Test 2: Idempotent Behavior
Same curl command, second call:

**Response:**
```json
{
  "ok": true,
  "item": { ... },
  "existed": true  // ✓ Returns existing demo
}
```

### ✅ Test 3: Plan Data Integration
```bash
curl http://localhost:5000/api/projects/bfeebb85-4b85-45bb-95bc-1f8c85ec36a4/plan
```

**Verified:**
- ✓ projectId: bfeebb85-4b85-45bb-95bc-1f8c85ec36a4
- ✓ summary.title: Modern Floating Shelves
- ✓ materials count: 3
- ✓ steps count: 5
- ✓ quota.tier: free

## Database Schema Notes

### Projects Table Constraints
Based on the debugging process, the following constraints exist on the production database:

1. **budget**: Check constraint allows only: `$`, `$$`, `$$$`
2. **skill_level**: Has a check constraint (field is optional, should be NULL or omitted)
3. **user_id**: Must be valid UUID format

### Required Fields (NOT NULL)
- `id` (UUID, auto-generated)
- `user_id` (UUID)
- `name` (text)
- `is_demo` (boolean, default: false)

### Optional Fields
- `budget` (text, with check constraint)
- `skill_level` (text, with check constraint - better to omit)
- `status` (text)
- `input_image_url` (text)
- `preview_url` (text)
- `plan_json` (jsonb)
- All other fields

## Error Messages Improved

### Before
```
"insert_failed"
```

### After
```json
{
  "ok": false,
  "error": "insert_failed",
  "details": "new row for relation \"projects\" violates check constraint \"projects_budget_check\""
}
```

This provides actionable debugging information for future issues.

## Status

✅ **FIXED** - The endpoint now works correctly:
- Creates demo project on first call
- Returns existing demo on subsequent calls (idempotent)
- Full plan data available via GET /api/projects/:id/plan
- Proper error logging for debugging

## Deployment

The fix is already live in the current server. No additional deployment needed.

## Related Files
- `index.js` (lines 899-1040) - Demo project endpoint
- `migrations/20251016_add_is_demo.sql` - Database migration
- `API_MAP.md` - API documentation
- `DEMO_PROJECT_IMPLEMENTATION.md` - Implementation guide
