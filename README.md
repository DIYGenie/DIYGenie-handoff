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
