# DIY Genie Webhooks Backend

Express.js + Supabase backend for DIY Genie project management API.

## Feature Flags & Providers

The backend supports toggling between real API integrations and stub implementations using environment variables.

### Preview Generation

**Environment Variables:**
- `PREVIEW_PROVIDER` - Set to `decor8` or `stub` (default: `stub`)
- `DECOR8_BASE_URL` - Decor8 API base URL (default: `https://api.decor8.ai`)
- `DECOR8_API_KEY` - Your Decor8 API key

**Behavior:**
- **stub mode** (default): Returns immediately, updates status to `preview_ready` after 5 seconds using the input image as preview
- **decor8 mode**: Calls Decor8 API `/generate_designs_for_room` endpoint with room_type and design_style
  - On success: Extracts preview URL from response
  - On error: Falls back to stub behavior (5s delay with input image)

**Usage:**
```bash
# Use stub (default)
npm start

# Use Decor8
PREVIEW_PROVIDER=decor8 DECOR8_API_KEY=your_key npm start
```

### Plan Generation

**Environment Variables:**
- `PLAN_PROVIDER` - Set to `openai` or `stub` (default: `stub`)
- `OPENAI_API_KEY` - Your OpenAI API key

**Behavior:**
- **stub mode** (default): Returns immediately, updates status to `plan_ready` after 1.5 seconds
- **openai mode**: Calls OpenAI GPT-4 to generate structured plan JSON
  - On success: Stores plan data in `plan_json` field
  - On error: Falls back to stub behavior (1.5s delay, no plan data)

**Usage:**
```bash
# Use stub (default)
npm start

# Use OpenAI
PLAN_PROVIDER=openai OPENAI_API_KEY=your_key npm start
```

## How Stub Timers Work

Both preview and plan endpoints use **non-blocking async timers** to simulate real API latency:

1. **Immediate Response**: Endpoint returns `{ok: true}` immediately
2. **Background Processing**: Async function runs in background
3. **Status Updates**: 
   - Preview: `draft` → `preview_requested` → `preview_ready` (5s)
   - Plan: `draft` → `plan_requested` → `plan_ready` (1.5s)
4. **Error Handling**: On any error, status updates to `preview_error` or `plan_error`

This prevents UI spinners from blocking indefinitely while maintaining realistic async behavior.

## Database Migrations

### Required Migrations

Run these SQL migrations in your Supabase SQL Editor to enable all features:

1. **Progress Tracking** (`migrations/add_progress_tracking.sql`)
   - Adds `completed_steps` and `current_step_index` to projects table
   
2. **Measurements** (`migrations/add_measurement_columns.sql`)
   - Adds `measure_status` and `measure_result` to room_scans table
   - Required for AR scan measurement endpoints

## Admin Endpoints

### Purge Test Data

Remove all data (projects, scans, storage files) for specific users.

**Authentication:**
Set `ADMIN_TOKEN` environment variable to a secure random string.

**Usage Examples:**

Dry run (preview what will be deleted):
```bash
curl -X DELETE "https://api.diygenieapp.com/api/admin/purge-test-data?user=U1,U2&dryRun=true" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

Execute deletion:
```bash
curl -X DELETE "https://api.diygenieapp.com/api/admin/purge-test-data?user=U1,U2" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

**Response (dry run):**
```json
{
  "ok": true,
  "dryRun": true,
  "users": [
    {
      "user_id": "U1",
      "projects": 5,
      "scans": 3,
      "files": 3
    }
  ]
}
```

**Response (execution):**
```json
{
  "ok": true,
  "deleted": {
    "projects": 5,
    "scans": 3,
    "files": 3
  },
  "users": [...]
}
```

## Testing

Run automated app test (no manual IDs required):

```bash
node tests/app.test.mjs
```

The test auto-discovers the dev user and validates:
- Project creation
- Image upload via direct_url
- Preview generation (if tier allows)
- Plan building
- Entitlements quota enforcement
- Status transitions

## Preview Endpoint (Stub Mode)

A lightweight stub endpoint for testing preview generation without external API calls.

### POST /preview

**Request:**
```bash
curl -X POST http://localhost:5000/preview \
  -H 'Content-Type: application/json' \
  -d '{
    "photo_url": "https://example.com/user-upload/123.jpg",
    "prompt": "modern farmhouse floating shelves, matte black brackets",
    "measurements": {"width_in": 72, "height_in": 18, "depth_in": 10, "unit": "in"}
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "source": "stub|decor8",
  "preview_url": "https://picsum.photos/seed/https%3A%2F%2Fexample.com%2Fuser-upload%2F123.jpg%7Cmodern%20farmhouse%20floatin/1024/768",
  "echo": {
    "photo_url": "https://example.com/user-upload/123.jpg",
    "prompt": "modern farmhouse floating shelves, matte black brackets",
    "measurements": {
      "width_in": 72,
      "height_in": 18,
      "depth_in": 10,
      "unit": "in"
    }
  }
}
```

**Validation Error (400 Bad Request):**
```bash
curl -X POST http://localhost:5000/preview \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Response:
```json
{
  "ok": false,
  "error": "invalid_payload",
  "fields_missing": ["photo_url", "prompt"]
}
```

**Fields:**
- `photo_url` (required, string) - URL of the uploaded photo
- `prompt` (required, string) - User's design prompt/description
- `measurements` (optional, object) - Room measurements from AR scan

**Features:**
- ✅ No external API calls - safe for offline/dev use
- ✅ Deterministic preview URLs (seeded by photo_url + prompt)
- ✅ Structured JSON logging
- ✅ Input validation with clear error messages

## Plan Endpoint (Stub Mode)

A lightweight stub endpoint for testing plan generation without external API calls.

### POST /plan

**Request:**
```bash
curl -X POST http://localhost:5000/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "photo_url": "https://example.com/room.jpg",
    "prompt": "coastal blue floating shelves with white trim",
    "measurements": {"width_in": 96, "depth_in": 12}
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "source": "stub|openai",
  "plan": {
    "overview": "modern floating shelves plan generated from prompt.",
    "assumptions": [
      "Wall is plumb with accessible studs or solid anchors.",
      "Target width ~96\" and depth ~12\".",
      "Basic DIY tools available; renting optional tools as needed."
    ],
    "materials": [
      {
        "name": "birch plywood 3/4\" (4x8)",
        "qty": 1,
        "unit": "sheet",
        "unit_price": 68.0,
        "subtotal": 68.0,
        "notes": "Cut to shelf pieces"
      }
    ],
    "tools": [
      {
        "name": "Drill/driver",
        "have": true,
        "rent_price": 0,
        "buy_price": 89
      }
    ],
    "cut_list": [
      {
        "item": "Shelf",
        "dimensions": "96\" x 12\" x 3/4\"",
        "qty": 2,
        "notes": "birch"
      }
    ],
    "steps": [
      {
        "n": 1,
        "title": "Plan & mark studs",
        "details": "Locate studs, mark shelf height and bracket positions.",
        "duration_min": 15,
        "depends_on": []
      }
    ],
    "safety": [
      "Wear eye and hearing protection.",
      "Use anchors appropriate for your wall type.",
      "Confirm no electrical/plumbing behind drill points."
    ],
    "estimation": {
      "materials_total": 122.3,
      "tools_total": 14,
      "contingency_pct": 0.12,
      "grand_total": 152.66
    }
  }
}
```

**Validation Error (400 Bad Request):**
```bash
curl -X POST http://localhost:5000/plan \
  -H 'Content-Type: application/json' \
  -d '{"photo_url":"test"}'
```

Response:
```json
{
  "ok": false,
  "error": "invalid_payload",
  "fields_missing": ["prompt"]
}
```

**Fields:**
- `photo_url` (required, string) - URL of the uploaded photo
- `prompt` (required, string) - User's design prompt/description
- `measurements` (optional, object) - Room measurements from AR scan

**Estimation Logic:**
- `materials_total` - Sum of all material subtotals
- `tools_total` - Sum of minimum cost (rent vs buy) for tools user doesn't have
- `contingency_pct` - Fixed at 0.12 (12%)
- `grand_total` - `(materials_total + tools_total) * (1 + contingency_pct)`

**Features:**
- ✅ No external API calls - safe for offline/dev use
- ✅ Deterministic content (seeded by prompt length)
- ✅ Structured JSON logging
- ✅ Complete plan schema with materials, tools, steps, and cost estimation

## Entitlements Endpoints

Credit-based usage tracking with automatic monthly rollover.

### POST /entitlements/check

Check user's current entitlements and remaining credits.

**Request:**
```bash
curl -X POST http://localhost:5000/entitlements/check \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"e4cb3591-7272-46dd-b1f6-d7cc4e2f3d24"}'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "tier": "pro",
  "quota": 25,
  "used": 1,
  "remaining": 24,
  "credits_month_key": "202510"
}
```

**Error (400 Bad Request):**
```bash
curl -X POST http://localhost:5000/entitlements/check \
  -H 'Content-Type: application/json' -d '{}'
```
Response: `{"ok":false,"error":"missing_user_id"}`

### POST /entitlements/consume

Consume one credit from user's monthly quota.

**Request:**
```bash
curl -X POST http://localhost:5000/entitlements/consume \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"e4cb3591-7272-46dd-b1f6-d7cc4e2f3d24"}'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "used": 2,
  "remaining": 23
}
```

**Error (402 Payment Required - Quota Exhausted):**
```json
{
  "ok": false,
  "error": "quota_exhausted",
  "quota": 25,
  "used": 25,
  "remaining": 0
}
```

**Monthly Rollover:**
- Automatically resets `used` to 0 when month changes
- Uses `credits_month_key` (format: YYYYMM) to track current month
- Rollover happens on first request in new month

**Optimistic Concurrency:**
- Uses PostgREST filters to prevent race conditions
- Retries once on conflict
- Returns 409 if concurrent updates conflict
