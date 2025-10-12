# Plan Normalization & Persistence Summary

## Overview
Added plan normalization logic to ensure consistent structure and persistence for DIY project plans. The system now guarantees normalized arrays and proper status updates for app rendering.

## Changes Made

### 1. Helper Functions

**`arr(x)`** - Array coercion helper
- Converts single items to arrays
- Returns empty array for falsy values

**`num(n, default=0)`** - Safe number parsing
- Converts to number, returns default if invalid

**`mapPlanToNormalized(input)`** - Plan structure normalizer
- **Input**: Raw plan data from AI/stub/user
- **Output**: Normalized structure with guaranteed fields:

```javascript
{
  overview: {
    title: string | null,
    est_time: string | null,
    est_cost: string | null,
    skill: string | null,
    notes: string | null
  },
  materials: [{ name: string, qty: any, notes: string | null }],
  tools: [{ name: string, notes: string | null }],
  cuts: [{ item: string, size: any, qty: number | null, notes: string | null }],
  steps: [{ order: number, text: string, notes: string | null }]
}
```

- Filters out empty entries (no name/text)
- Auto-sorts steps by order
- Logs: `[plan map] counts { materials, tools, cuts, steps }`

**`savePlan(projectId, plan)`** - DB persistence helper
- Normalizes plan via `mapPlanToNormalized()`
- Updates project: `plan_json`, `status='active'`, `updated_at=now()`
- Returns: `{ ok: true, counts: { materials, tools, cuts, steps } }`
- Logs: `[plan save] upsert ok { projectId, counts }`

### 2. New Endpoints

**`GET /selftest/plan/:projectId`** - Diagnostic endpoint
- Returns: `{ ok: true, counts: {...}, keys: [...] }`
- No PII, just counts and top-level keys
- Logs: `[plan selftest] { projectId, counts }`

**`PATCH /projects/:projectId/plan`** - Plan ingest endpoint
- Accepts raw plan JSON in body
- Normalizes and saves via `savePlan()`
- Returns: `{ ok: true, counts: {...} }`
- Logs: `[plan ingest] error` on failure

### 3. Status Update
- Plans now automatically set project status to `'active'` when saved
- Ensures app can render sections properly

## Usage Examples

### Test Plan Structure
```bash
# Check existing plan structure
curl https://api.diygenieapp.com/selftest/plan/{projectId}

# Response
{
  "ok": true,
  "counts": {
    "materials": 5,
    "tools": 3,
    "cuts": 2,
    "steps": 8
  },
  "keys": ["overview", "materials", "tools", "cuts", "steps"]
}
```

### Ingest Raw Plan
```bash
# Send raw plan data for normalization
curl -X PATCH https://api.diygenieapp.com/projects/{projectId}/plan \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build Floating Shelves",
    "materials": [
      {"name": "Pine board", "qty": "2x 1x8x6"},
      {"name": "Wood screws", "qty": "20"}
    ],
    "steps": [
      {"order": 1, "text": "Cut boards to length"},
      {"order": 2, "text": "Sand all surfaces"}
    ]
  }'

# Response
{
  "ok": true,
  "counts": {
    "materials": 2,
    "tools": 0,
    "cuts": 0,
    "steps": 2
  }
}
```

## Expected Logs

When a plan is processed, you'll see:
```
[plan map] counts { materials: 5, tools: 3, cuts: 2, steps: 8 }
[plan save] upsert ok { projectId: 'abc-123', counts: { materials: 5, tools: 3, cuts: 2, steps: 8 } }
```

## Acceptance Criteria ✅

1. ✅ Plan structure normalized with guaranteed fields
2. ✅ Empty arrays for missing sections
3. ✅ Steps auto-sorted by order
4. ✅ Status updates to 'active' on save
5. ✅ Diagnostic endpoint available
6. ✅ Ingest endpoint for raw plans
7. ✅ Verbose logging for debugging

## Integration with App

The app can now:
1. Send raw plan data to `PATCH /projects/:projectId/plan`
2. System normalizes and saves with proper structure
3. Status updates to 'active' for rendering
4. App fetches normalized plan via existing `GET /api/projects/:id/plan`
5. All sections render with guaranteed array structures
