# Webhooks API

**FRAMEWORK:** Express.js 5.x  
**BASE_URL:** _[To be filled with deployed URL]_

---

## Endpoints

### GET /debug/decor8
- **Handler file:** `index.js:323`
- **Auth:** none (temporary diagnostic endpoint)
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, hasKey: boolean, base: string|null, endpointExists: boolean, env: string[] }`
- **Response (errors):** -
- **Side effects:** Logs `[debug] decor8 check`
- **Logs/phrases:** `[debug] decor8 check`
- **Note:** Temporary endpoint to verify Decor8 integration readiness. Will be removed after verification.

**Sample:**
```bash
curl https://api.diygenieapp.com/debug/decor8
```

**Expected Response:**
```json
{
  "ok": true,
  "hasKey": true,
  "base": "https://api.decor8.ai",
  "endpointExists": true,
  "env": ["DECOR8_BASE_URL", "DECOR8_API_KEY", ...]
}
```

---

### GET /health
- **Handler file:** `index.js:306`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, status: "healthy", suggestions: "stub|openai", preview: "stub|decor8", plan: "stub|openai" }`
- **Response (errors):** -
- **Side effects:** none
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/health
```

---

### GET /
- **Handler file:** `index.js:313`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { message: "Server is running", status: "ready", base: "v1" }`
- **Response (errors):** -
- **Side effects:** none
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/
```

---

### GET /api/ios/health
- **Handler file:** `routes/ios.js:5`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, ts: "ISO timestamp", version: "0.1.0" }`
- **Response (errors):** See [Standardized Error Format](#standardized-error-format)
- **Side effects:** none
- **Logs/phrases:** -
- **Note:** iOS-specific health check endpoint with timestamp and version info

**Sample:**
```bash
curl https://your-api.com/api/ios/health
```

**Response:**
```json
{
  "ok": true,
  "ts": "2025-10-19T23:06:08.053Z",
  "version": "0.1.0"
}
```

---

## Standardized Error Format

All errors (including 404s) are returned in a standardized JSON envelope:

```json
{
  "code": "error_code",
  "message": "Human-readable error message",
  "hint": "Optional hint for resolution"
}
```

**Example 404:**
```json
{
  "code": "not_found",
  "message": "Route not found"
}
```

**Example Validation Error:**
```json
{
  "code": "missing_user_id",
  "message": "user_id is required",
  "hint": "Provide user_id in request body"
}
```

**Helper Function:**
Routes can use `req.fail(code, message, hint)` to trigger standardized errors:
```javascript
if (!user_id) {
  return req.fail("missing_user_id", "user_id is required", "Provide user_id in request body");
}
```

---

## iOS-Normalized Project Endpoints

The following endpoints use standardized request/response shapes optimized for iOS clients. All responses follow fixed schemas with no extra fields. All errors use the [Standardized Error Format](#standardized-error-format).

### POST /api/projects
- **Handler file:** `routes/projects.js:16`
- **Auth:** none (requires user_id in body)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "name": "string (min 10 chars, required)",
  "goal": "string (optional)",
  "user_id": "uuid (required)",
  "client": { "budget": "$ | $$ | $$$" }
}
```
- **Response (success):** `201 { id, name, goal, user_id, created_at }`
- **Response (errors):**
  - `400 { code: "missing_user_id", message: "..." }`
  - `400 { code: "invalid_name", message: "..." }`
  - `400 { code: "create_project_failed", message: "..." }`
- **Side effects:** Creates project in database, upserts user profile
- **Logs/phrases:** `[POST /api/projects] user_id=..., project_id=...`

**Sample:**
```bash
curl -X POST http://localhost:5000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"99198c4b-8470-49e2-895c-75593c5aa181","name":"Floating Shelves Project","goal":"Install shelves"}'
```

**Response:**
```json
{
  "id": "f45d8e9b-9bed-46f9-88b0-4c156c43fe53",
  "name": "Floating Shelves Project",
  "goal": "Install shelves",
  "user_id": "99198c4b-8470-49e2-895c-75593c5aa181",
  "created_at": "2025-10-19T23:13:51.078657+00:00"
}
```

---

### POST /api/projects/:id/photo
- **Handler file:** `routes/projects.js:69`
- **Auth:** none
- **Request headers:** `Content-Type: multipart/form-data` OR `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:**
  - Multipart: File upload with field name (any)
  - JSON: `{ "url": "https://..." }`
- **Response (success):** `200 { ok: true, photo_url: "https://..." }`
- **Response (errors):**
  - `400 { code: "invalid_url", message: "...", hint: "..." }`
  - `400 { code: "invalid_file_type", message: "..." }`
  - `400 { code: "missing_file_or_url", message: "..." }`
  - `400 { code: "attach_photo_failed", message: "..." }`
- **Side effects:** Uploads file to Supabase Storage, updates project.input_image_url
- **Logs/phrases:** -

**Sample (URL):**
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/photo \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://images.unsplash.com/photo-123"}'
```

**Sample (File):**
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/photo \
  -F "file=@room_photo.jpg"
```

**Response:**
```json
{
  "ok": true,
  "photo_url": "https://storage.example.com/projects/PROJECT_ID/1234567890.jpg"
}
```

---

### POST /api/projects/:id/preview
- **Handler file:** `routes/projects.js:128`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body (JSON):** `{ "force": boolean }`
- **Response (success):** `202 { status: "queued", preview_id: null }`
- **Response (errors):**
  - `400 { code: "project_not_found", message: "..." }`
  - `400 { code: "missing_photo", message: "..." }`
  - `400 { code: "queue_preview_failed", message: "..." }`
- **Side effects:** Updates project status to 'preview_requested'
- **Logs/phrases:** `[POST /api/projects/:id/preview] project_id=..., force=...`

**Sample:**
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/preview \
  -H 'Content-Type: application/json' \
  -d '{"force":false}'
```

**Response:**
```json
{
  "status": "queued",
  "preview_id": null
}
```

---

### GET /api/projects/:id/plan
- **Handler file:** `routes/projects.js:166`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** -
- **Response (success):** `200 { steps: [...], tools: [...], materials: [...], cost_estimate: { total, currency }, updated_at }`
- **Response (errors):**
  - `400 { code: "project_not_found", message: "..." }`
  - `400 { code: "get_plan_failed", message: "..." }`
- **Side effects:** none (read-only)
- **Logs/phrases:** -

**Sample:**
```bash
curl http://localhost:5000/api/projects/PROJECT_ID/plan
```

**Response:**
```json
{
  "steps": [],
  "tools": [],
  "materials": [],
  "cost_estimate": {
    "total": 0,
    "currency": "USD"
  },
  "updated_at": "2025-10-19T23:13:51.964Z"
}
```

---

### POST /api/projects/:id/scan
- **Handler file:** `routes/projects.js:217`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "roomplan": {
    "width": 10.5,
    "height": 8.2,
    "depth": 12.3,
    "objects": []
  }
}
```
- **Response (success):** `200 { ok: true }`
- **Response (errors):**
  - `400 { code: "missing_roomplan", message: "..." }`
  - `400 { code: "project_not_found", message: "..." }`
  - `400 { code: "attach_scan_failed", message: "..." }`
- **Side effects:** Inserts scan data into room_scans table
- **Logs/phrases:** `[POST /api/projects/:id/scan] project_id=..., scan saved`

**Sample:**
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/scan \
  -H 'Content-Type: application/json' \
  -d '{"roomplan":{"width":10,"height":8,"depth":12,"objects":[]}}'
```

**Response:**
```json
{
  "ok": true
}
```

---

### GET /me/entitlements/:userId
- **Handler file:** `index.js:321`
- **Auth:** none (service-level)
- **Request headers:** -
- **Query params:** -
- **Path params:** `userId` (UUID string)
- **Request body:** -
- **Response (success):** `200 { ok: true, tier: "Free|Casual|Pro", quota: number, remaining: number, previewAllowed: boolean }`
- **Response (errors):** Always returns 200 with safe defaults
- **Side effects:** Reads from `profiles` table
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/me/entitlements/550e8400-e29b-41d4-a716-446655440001
```

---

### GET /api/me/entitlements/:userId
- **Handler file:** `index.js:347`
- **Auth:** none (service-level)
- **Request headers:** -
- **Query params:** -
- **Path params:** `userId` (UUID string)
- **Request body:** -
- **Response (success):** `200 { ok: true, tier: "Free|Casual|Pro", quota: number, remaining: number, previewAllowed: boolean }`
- **Response (errors):** Always returns 200 with safe defaults
- **Side effects:** Reads from `profiles` table
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/api/me/entitlements/550e8400-e29b-41d4-a716-446655440001
```

---

### GET /me/entitlements
- **Handler file:** `index.js:374`
- **Auth:** none (service-level)
- **Request headers:** -
- **Query params:** `user_id` (UUID string, required)
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, tier: "Free|Casual|Pro", quota: number, remaining: number, previewAllowed: boolean }`
- **Response (errors):** Always returns 200 with safe defaults
- **Side effects:** Reads from `profiles` table
- **Logs/phrases:** -

**Sample:**
```bash
curl 'https://your-api.com/me/entitlements?user_id=550e8400-e29b-41d4-a716-446655440001'
```

---

### POST /api/billing/checkout
- **Handler file:** `index.js:402`
- **Auth:** none (uses Stripe)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "tier": "casual|pro",
  "user_id": "uuid-string"
}
```
- **Response (success):** `200 { ok: true, url: "stripe-checkout-session-url" }`
- **Response (errors):** 
  - `404 { ok: false, error: "unknown_tier" }` - Invalid tier
  - `500 { ok: false, error: "missing_price_id" }` - Price ID not configured
  - `500 { ok: false, error: "error_message" }` - Stripe error
- **Side effects:** Creates Stripe checkout session
- **Logs/phrases:** `[billing] checkout created`

**Sample:**
```bash
curl -X POST https://your-api.com/api/billing/checkout \
  -H 'Content-Type: application/json' \
  -d '{"tier":"casual","user_id":"550e8400-e29b-41d4-a716-446655440001"}'
```

---

### POST /api/billing/portal
- **Handler file:** `index.js:440`
- **Auth:** none (uses Stripe)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "user_id": "uuid-string",
  "customer_id": "stripe-customer-id-optional"
}
```
- **Response (success):** `200 { ok: true, url: "stripe-portal-url" }`
- **Response (errors):**
  - `501 { ok: false, error: "no_customer" }` - No customer ID found
  - `501 { ok: false, error: "portal_not_configured" }` - Stripe portal disabled
  - `501 { ok: false, error: "invalid_customer" }` - Customer doesn't exist
  - `501 { ok: false, error: "portal_unavailable" }` - Other Stripe error
  - `500 { ok: false, error: "server_error" }` - Server error
- **Side effects:** Reads from `profiles` table, creates Stripe billing portal session
- **Logs/phrases:** `[billing] portal session created`, `[billing] portal: no customer id`

**Sample:**
```bash
curl -X POST https://your-api.com/api/billing/portal \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"550e8400-e29b-41d4-a716-446655440001"}'
```

---

### POST /api/billing/upgrade
- **Handler file:** `index.js:494`
- **Auth:** none (dev stub)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "tier": "free|casual|pro",
  "user_id": "uuid-string"
}
```
- **Response (success):** `200 { ok: true, tier: "free|casual|pro" }`
- **Response (errors):**
  - `400 { ok: false, error: "missing_user_id" }` - No user_id
  - `404 { ok: false, error: "unknown_tier" }` - Invalid tier
  - `500 { ok: false, error: "error_message" }` - Database error
- **Side effects:** Upserts `profiles` table (updates plan_tier)
- **Logs/phrases:** `[billing] upgrade`, `[ERROR] Upgrade failed`

**Sample:**
```bash
curl -X POST https://your-api.com/api/billing/upgrade \
  -H 'Content-Type: application/json' \
  -d '{"tier":"pro","user_id":"550e8400-e29b-41d4-a716-446655440001"}'
```

---

### GET /api/projects
- **Handler file:** `index.js:695`
- **Auth:** none (user_id via query)
- **Request headers:** -
- **Query params:** `user_id` (UUID, defaults to DEV_USER)
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, items: [...projects] }`
  - Project shape: `{ id, name, status, input_image_url, preview_url }`
- **Response (errors):** `500 { ok: false, error: "error_message" }`
- **Side effects:** Reads from `projects` table
- **Logs/phrases:** -

**Sample:**
```bash
curl 'https://your-api.com/api/projects?user_id=550e8400-e29b-41d4-a716-446655440001'
```

---

### GET /api/projects/cards
- **Handler file:** `index.js:765`
- **Auth:** none (user_id via query)
- **Request headers:** -
- **Query params:** 
  - `user_id` (UUID, defaults to DEV_USER)
  - `limit` (integer, optional, default: 10, max: 50)
  - `offset` (integer, optional, default: 0)
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true, items: [...cards] }`
  - Card shape: `{ id, name, status, preview_url, preview_thumb_url, updated_at }`
  - `preview_thumb_url` - Optimized thumbnail URL with Supabase CDN transformations (640px, quality 70)
- **Response (errors):** `500 { ok: false, error: "error_message" }`
- **Side effects:** Reads from `projects` table
- **Logs/phrases:** -
- **Performance:** Lightweight endpoint with smaller payloads (6 fields vs 15+), leverages `idx_projects_user_updated` index
- **Note:** Designed for project cards/lists. Uses pagination. Auto-transforms Supabase Storage URLs to thumbnails.

**Sample:**
```bash
# Basic usage
curl 'https://your-api.com/api/projects/cards?user_id=550e8400-e29b-41d4-a716-446655440001'

# With pagination
curl 'https://your-api.com/api/projects/cards?user_id=550e8400-e29b-41d4-a716-446655440001&limit=20&offset=0'
```

**Response Example:**
```json
{
  "ok": true,
  "items": [
    {
      "id": "38401d86-d790-48fa-978a-ba2ae8b095ed",
      "name": "Build 3 shelves",
      "status": "planned",
      "preview_url": "https://example.supabase.co/storage/v1/object/public/uploads/image.jpg",
      "preview_thumb_url": "https://example.supabase.co/storage/v1/object/public/uploads/image.jpg?width=640&quality=70&resize=contain",
      "updated_at": "2025-10-17T03:07:24.641069+00:00"
    }
  ]
}
```

---

### GET /api/projects/:id
- **Handler file:** `index.js:711`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** `id` (UUID)
- **Request body:** -
- **Response (success):** `200 { ok: true, project: {...} }` (full project object)
- **Response (errors):**
  - `404 { ok: false, error: "not_found" }` - Project not found
  - `500 { ok: false, error: "error_message" }` - Database error
- **Side effects:** Reads from `projects` table
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001
```

---

### POST /api/projects
- **Handler file:** `index.js:729`
- **Auth:** none (requires user_id in body)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "user_id": "uuid-string-required",
  "name": "Project name (min 10 chars)",
  "budget": "$|$$|$$$",
  "skill_level": "beginner|intermediate|advanced"
}
```
- **Response (success):** `200 { ok: true, item: { id: "uuid", status: "draft" } }`
- **Response (errors):**
  - `400 { ok: false, error: "user_id required" }` - Missing user_id
  - `422 { ok: false, error: "invalid_name" }` - Name too short
  - `422 { ok: false, error: "invalid_budget" }` - Missing budget
  - `422 { ok: false, error: "invalid_skill_level" }` - Missing skill
  - `422 { ok: false, error: "insert_failed" }` - Database insert failed
- **Side effects:** Upserts `profiles` table, inserts into `projects` table
- **Logs/phrases:** `[POST /api/projects] user_id=..., project_id=...`

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id":"550e8400-e29b-41d4-a716-446655440001",
    "name":"Build floating shelf",
    "budget":"$$",
    "skill_level":"intermediate"
  }'
```

---

### POST /api/demo-project
- **Handler file:** `index.js:901`
- **Auth:** none (requires user_id in body)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "user_id": "uuid-string-required"
}
```
- **Response (success):** `200 { ok: true, item: {...}, existed: boolean }`
  - `item`: Project object with `id`, `name`, `status`, `input_image_url`, `preview_url`
  - `existed`: `true` if demo already existed, `false` if newly created
- **Response (errors):**
  - `400 { ok: false, error: "missing_user_id" }` - Missing or empty user_id
  - `500 { ok: false, error: "insert_failed", details: "..." }` - Failed to create demo (includes error details)
  - `500 { ok: false, error: "exception", details: "..." }` - Unexpected error (includes error message)
- **Side effects:** 
  - Checks for existing demo project (`is_demo=true`)
  - If none exists: upserts `profiles`, inserts demo project with full `plan_json`
  - Sets `is_demo=true`, `status=plan_ready`
  - Uses stable Unsplash images for before/after
- **Logs/phrases:** 
  - `[POST /api/demo-project] user_id=...`
  - `[demo-project] Returning existing demo: <id>`
  - `[demo-project] Created new demo: <id>`
- **Special notes:**
  - Demo project does NOT count against user quotas
  - Only ONE demo per user (idempotent - returns existing if called again)
  - Includes pre-populated plan data: Modern Floating Shelves project
  - Demo can be deleted and recreated by calling endpoint again
  - **IMPORTANT:** Requires `is_demo` column in database (see migration: `migrations/20251016_add_is_demo.sql`)

**Sample (create or fetch):**
```bash
curl -X POST http://localhost:5000/api/demo-project \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"550e8400-e29b-41d4-a716-446655440001"}'
```

**Sample Response (newly created):**
```json
{
  "ok": true,
  "item": {
    "id": "abc123-...",
    "name": "Modern Floating Shelves (Demo)",
    "status": "plan_ready",
    "input_image_url": "https://images.unsplash.com/photo-1582582429416-456273091821?q=80&w=1200...",
    "preview_url": "https://images.unsplash.com/photo-1549187774-b4e9b0445b41?q=80&w=1200..."
  },
  "existed": false
}
```

**Sample Response (already exists):**
```json
{
  "ok": true,
  "item": {
    "id": "abc123-...",
    "name": "Modern Floating Shelves (Demo)",
    "status": "plan_ready",
    "input_image_url": "https://images.unsplash.com/...",
    "preview_url": "https://images.unsplash.com/..."
  },
  "existed": true
}
```

---

### POST /api/events
- **Handler file:** `index.js:1072`
- **Auth:** none (requires user_id in body)
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** -
- **Request body (JSON):**
```json
{
  "user_id": "uuid-string-required",
  "event_type": "non-empty-string-required",
  "project_id": "uuid-or-null-optional",
  "props": { "key": "value" }
}
```
- **Response (success):** `200 { ok: true }`
- **Response (errors):**
  - `400 { ok: false, error: "missing_user_id" }` - user_id is missing or empty
  - `400 { ok: false, error: "missing_event_type" }` - event_type is missing or empty
  - `413 PayloadTooLargeError` - Request body exceeds 10KB limit
  - `500 { ok: false, error: "insert_failed" }` - Database insert failed
  - `500 { ok: false, error: "server_error" }` - Unexpected error
- **Side effects:** Inserts telemetry event into `public.events` table
- **Logs/phrases:**
  - `[events] insert ok <user_id> <event_type>` - Success
  - `[events] insert fail <error_message>` - Failure
- **Note:** Request body limited to 10KB. Requires `public.events` table in database.

**Sample:**
```bash
curl -X POST http://localhost:5000/api/events \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"99198c4b-8470-49e2-895c-75593c5aa181","event_type":"open_plan","project_id":null,"props":{"source":"test"}}'
```

**Response:**
```json
{
  "ok": true
}
```

---

### POST /api/projects/:id/image
- **Handler file:** `index.js:780`
- **Auth:** none
- **Request headers:** `Content-Type: multipart/form-data` OR `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** 
  - Multipart: File field (name: `file` or `image`)
  - JSON: `{ "direct_url": "https://..." }`
- **Response (success):** `200 { ok: true }`
- **Response (errors):**
  - `400 { ok: false, error: "invalid_direct_url_must_be_http_or_https" }` - Bad URL
  - `400 { ok: false, error: "invalid_file_type_must_be_image" }` - Non-image file
  - `400 { ok: false, error: "missing_file_or_direct_url" }` - No file/URL provided
  - `500 { ok: false, error: "error_message" }` - Upload/database error
- **Side effects:** Uploads to Supabase Storage, updates `projects.input_image_url`
- **Logs/phrases:** `[WARN] Supabase upload failed, using stub URL`, `[ERROR] Image upload exception`

**Sample (multipart):**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/image \
  -F 'file=@room.jpg'
```

**Sample (direct URL):**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/image \
  -H 'Content-Type: application/json' \
  -d '{"direct_url":"https://example.com/room.jpg"}'
```

---

### POST /api/projects/:id/preview
- **Handler file:** `index.js:874`
- **Auth:** Middleware `requirePreviewOrBuildQuota` (checks entitlements)
- **Request headers:** `Content-Type: application/json`
- **Query params:** `user_id` (optional, for quota check)
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "room_type": "livingroom|bedroom|kitchen|etc",
  "design_style": "modern|minimalist|rustic|etc"
}
```
- **Response (success):** `200 { ok: true }` (async processing starts)
- **Response (errors):**
  - `403 { ok: false, error: "no_user" }` - No user_id found
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `422 { ok: false, error: "missing_input_image_url" }` - No image uploaded
  - `409 { ok: false, error: "preview_already_used" }` - Already has preview
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** 
  - Updates `projects.status` to `preview_requested` → `preview_ready` (or `preview_error`)
  - Calls Decor8 API if PREVIEW_PROVIDER=decor8, else stub (5s delay)
  - Updates `projects.preview_url`
- **Logs/phrases:** `[Preview] Calling Decor8 for project`, `[Preview] Decor8 success`, `[Preview] Completed for`

**Sample:**
```bash
curl -X POST 'https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/preview?user_id=550e8400-e29b-41d4-a716-446655440001' \
  -H 'Content-Type: application/json' \
  -d '{"room_type":"livingroom","design_style":"modern"}'
```

---

### POST /api/projects/:id/build-without-preview
- **Handler file:** `index.js:966`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`, `x-user-id` (optional)
- **Query params:** `user_id` (optional)
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "project_id": "uuid-optional",
  "id": "uuid-optional",
  "user_id": "uuid-optional"
}
```
- **Response (success):** `202 { ok: true, project_id: "uuid", accepted: true, user_id: "uuid|null" }`
- **Response (errors):**
  - `400 { ok: false, error: "missing_project_id" }` - No project ID
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Updates `projects.status` to `ready`, clears `preview_url`
- **Logs/phrases:** -

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/build-without-preview \
  -H 'Content-Type: application/json' \
  -d '{}'
```

---

### POST /api/projects/:id/suggestions
- **Handler file:** `index.js:1013`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "desc": "project description (optional)",
  "description": "project description (optional)",
  "budget": "$|$$|$$$ (optional)",
  "skill_level": "beginner|intermediate|advanced (optional)"
}
```
- **Response (success):** `200 { ok: true, suggestions: ["tip1", "tip2"...], tags: ["skill", "budget"], desc: "...", budget: "...", skill: "..." }`
- **Response (errors):** Always returns 200 with fallback suggestions
- **Side effects:** Reads from `projects` table
- **Logs/phrases:** `[SUGGESTIONS]`

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/suggestions \
  -H 'Content-Type: application/json' \
  -d '{"desc":"Build floating shelf","budget":"$$","skill_level":"intermediate"}'
```

---

### POST /api/projects/:id/suggestions-smart
- **Handler file:** `index.js:1050`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** - (reads from project data)
- **Response (success):** `200 { ok: true, suggestions: [{ text: "...", tag: "clarity|context|materials|..." }] }` (max 6)
- **Response (errors):**
  - `400 { ok: false, error: "missing_project_id" }` - No project ID
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Reads from `projects` table (goal, name, budget, skill_level, input_image_url)
- **Logs/phrases:** -

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/suggestions-smart \
  -H 'Content-Type: application/json'
```

---

### GET /api/projects/:id/plan
- **Handler file:** `index.js:1242`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** -
- **Response (success):** `200` - Returns comprehensive plan data with the following frozen schema:
```json
{
  "projectId": "string",
  "summary": {
    "title": "string",
    "heroImageUrl": "string|null",
    "estTimeHours": 0,
    "estCostUsd": 0
  },
  "preview": {
    "beforeUrl": "string|null",
    "afterUrl": "string|null"
  },
  "materials": [
    {
      "name": "string",
      "qty": 0,
      "unit": "string",
      "subtotalUsd": 0
    }
  ],
  "tools": {
    "required": ["string"],
    "optional": ["string"]
  },
  "cutList": {
    "items": [
      {
        "board": "string",
        "dims": "string",
        "qty": 0
      }
    ],
    "layoutSvgUrl": "string|null"
  },
  "steps": [
    {
      "n": 1,
      "title": "string",
      "text": "string",
      "diagramUrl": "string|null"
    }
  ],
  "safety": {
    "notes": ["string"]
  },
  "permits": {
    "needed": false,
    "note": "string"
  },
  "quota": {
    "tier": "free|casual|pro",
    "plansUsed": 0,
    "plansLimit": 0
  }
}
```
- **Response (errors):**
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Reads from `projects` and `profiles` tables, assembles plan data with defaults for missing fields
- **Logs/phrases:** `[ERROR] GET plan database error`, `[ERROR] GET plan exception`, `[WARN] Could not fetch quota`
- **Performance:** Response kept under 1.5 MB, no inline USDZ/large blobs (uses URLs)
- **Data sources:** 
  - Plan data from `projects.plan_json` (JSONB field)
  - User quota from `profiles` table (subscription_tier, plan_tier)
  - Image URLs from `projects.input_image_url` and `projects.preview_url`

**Sample (existing project):**
```bash
curl http://localhost:5000/api/projects/b904c604-c12b-4c5d-a6dd-548908913f9f/plan
```

**Sample (404 - project not found):**
```bash
curl http://localhost:5000/api/projects/00000000-0000-0000-0000-000000000999/plan
# Response: {"ok":false,"error":"project_not_found"}
```

---

### POST /api/projects/:id/plan
- **Handler file:** `index.js:1190`
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "plan_json": {
    "summary": { "title": "...", "difficulty": "beginner|intermediate|advanced", "est_cost": "...", "est_time": "..." },
    "steps": [{ "step": 1, "title": "...", "detail": "...", "duration_minutes": 30 }],
    "materials": [{ "name": "...", "qty": "...", "unit": "...", "cost": "..." }],
    "tools": ["tool1", "tool2"],
    "safety": ["tip1", "tip2"],
    "tips": ["tip1", "tip2"]
  },
  "status": "plan_ready"
}
```
- **Response (success):** `200 { ok: true, project: {...} }` (full project object)
- **Response (errors):**
  - `400 { ok: false, error: "plan_json required" }` - Missing plan_json
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Updates `projects` table (plan_json, status, updated_at)
- **Logs/phrases:** `[plan UPDATE] Project ... plan updated, status: ...`

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "plan_json": {
      "summary": {"title":"Build Shelf","difficulty":"beginner","est_cost":"$50","est_time":"2 hours"},
      "steps": [{"step":1,"title":"Cut wood","detail":"Cut to size","duration_minutes":30}],
      "tools": ["saw","drill"],
      "materials": [{"name":"Wood","qty":"1","unit":"board"}],
      "safety": ["Wear safety glasses"],
      "tips": ["Sand smooth"]
    },
    "status": "plan_ready"
  }'
```

---

### GET /api/projects/:id/progress
- **Handler file:** `index.js` (progress tracking)
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** -
- **Response (success):** `200 { completed_steps: number[], current_step_index: number }`
- **Response (errors):** `500 { error: "Failed to fetch progress" }`
- **Side effects:** Reads from `projects` table (completed_steps, current_step_index)
- **Logs/phrases:** `[progress GET error]`

**Sample:**
```bash
curl https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/progress
```

---

### POST /api/projects/:id/progress
- **Handler file:** `index.js` (progress tracking)
- **Auth:** none
- **Request headers:** `Content-Type: application/json`
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body (JSON):**
```json
{
  "completed_steps": [1, 2, 3],
  "current_step_index": 3
}
```
- **Response (success):** `200` (updated project object)
- **Response (errors):** `500 { error: "Failed to update progress" }`
- **Side effects:** Updates `projects` table (completed_steps, current_step_index)
- **Logs/phrases:** `[progress POST error]`

**Sample:**
```bash
curl -X POST https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/progress \
  -H 'Content-Type: application/json' \
  -d '{"completed_steps":[1,2,3],"current_step_index":3}'
```

---

### POST /api/projects/:projectId/scans/:scanId/measure
- **Handler file:** `index.js:1287`
- **Auth:** Requires authenticated user via `user_id` in request body/query. Uses two explicit queries to verify scan→project and project→user ownership
- **Request headers:** `Content-Type: application/json`
- **Query params:** `user_id` (UUID, optional if in body)
- **Path params:** `projectId` (project UUID), `scanId` (scan UUID)
- **Request body (JSON, optional):**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440001",
  "roi": { "x": 0.25, "y": 0.70, "w": 0.34, "h": 0.23 }
}
```
- **Response (success):** `200 { ok: true, status: "done" }`
- **Response (errors):**
  - `400 { ok: false, error: "user_id required" }` - Missing user_id
  - `400 { ok: false, error: "projectId and scanId required" }` - Missing path params
  - `403 { ok: false, error: "forbidden" }` - Scan owned by different user
  - `404 { ok: false, error: "scan_not_found" }` - Scan doesn't exist or doesn't belong to project
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Updates `room_scans` table (measure_status='done', measure_result with ROI)
- **Logs/phrases:** `[measure web] start`, `[measure web] update complete`
- **Stub behavior:** Immediately sets measure_status='done' with result `{ px_per_in: 15.0, width_in: 48, height_in: 30, roi: {...} }`

**Sample:**
```bash
curl -X POST https://api.diygenieapp.com/api/projects/550e8400-e29b-41d4-a716-446655440001/scans/660e8400-e29b-41d4-a716-446655440002/measure \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"550e8400-e29b-41d4-a716-446655440001","roi":{"x":0.25,"y":0.70,"w":0.34,"h":0.23}}'
```

---

### GET /api/projects/:projectId/scans/:scanId/measure/status
- **Handler file:** `index.js:1355`
- **Auth:** Requires authenticated user via `user_id` in query params. Uses three explicit queries to verify scan→project, project→user ownership, and read measurement
- **Request headers:** -
- **Query params:** `user_id` (UUID, required)
- **Path params:** `projectId` (project UUID), `scanId` (scan UUID)
- **Request body:** -
- **Response (success):** `200 { ok: true, status: "done", result: { px_per_in: 15.0, width_in: 48, height_in: 30, roi: {...} } }`
- **Response (errors):**
  - `400 { ok: false, error: "user_id required" }` - Missing user_id
  - `400 { ok: false, error: "projectId and scanId required" }` - Missing path params
  - `403 { ok: false, error: "forbidden" }` - Scan owned by different user
  - `404 { ok: false, error: "scan_not_found" }` - Scan doesn't exist or doesn't belong to project
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `409 { ok: false, error: "not_ready" }` - Measurement not yet available (status not 'done')
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Reads from `room_scans` table
- **Logs/phrases:** `[measure web] status check`, `[measure web] status error`

**Sample:**
```bash
curl "https://api.diygenieapp.com/api/projects/550e8400-e29b-41d4-a716-446655440001/scans/660e8400-e29b-41d4-a716-446655440002/measure/status?user_id=550e8400-e29b-41d4-a716-446655440001"
```

---

### POST /api/projects/:projectId/preview
- **Handler file:** `index.js:1425`
- **Auth:** Requires authenticated user via `user_id` in request body/query. Uses explicit queries to verify project ownership
- **Request headers:** `Content-Type: application/json`
- **Query params:** `user_id` (UUID, optional if in body)
- **Path params:** `projectId` (project UUID)
- **Request body (JSON, optional):**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440001",
  "roi": { "x": 0.25, "y": 0.70, "w": 0.34, "h": 0.23 }
}
```
- **Response (success):** `200 { ok: true, status: "done", preview_url: "https://..." }`
- **Response (errors):**
  - `400 { ok: false, error: "user_id required" }` - Missing user_id
  - `400 { ok: false, error: "projectId required" }` - Missing path param
  - `403 { ok: false, error: "forbidden" }` - Project owned by different user
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Updates `projects` table (preview_status='done', preview_url, preview_meta)
- **Logs/phrases:** `[preview web] start`, `[preview web] update complete`
- **Stub behavior:** Immediately sets preview_status='done' with placeholder image `https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200` and meta `{ model: "stub", roi?: {...} }`

**Sample:**
```bash
curl -X POST https://api.diygenieapp.com/api/projects/550e8400-e29b-41d4-a716-446655440001/preview \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"550e8400-e29b-41d4-a716-446655440001","roi":{"x":0.25,"y":0.70,"w":0.34,"h":0.23}}'
```

---

### GET /api/projects/:projectId/preview/status
- **Handler file:** `index.js:1488`
- **Auth:** Requires authenticated user via `user_id` in query params. Uses explicit queries to verify project ownership and read preview data
- **Request headers:** -
- **Query params:** `user_id` (UUID, required)
- **Path params:** `projectId` (project UUID)
- **Request body:** -
- **Response (success):** `200 { ok: true, status: "done", preview_url: "https://...", preview_meta: { model: "stub", ... } }`
- **Response (errors):**
  - `400 { ok: false, error: "user_id required" }` - Missing user_id
  - `400 { ok: false, error: "projectId required" }` - Missing path param
  - `403 { ok: false, error: "forbidden" }` - Project owned by different user
  - `404 { ok: false, error: "project_not_found" }` - Project doesn't exist
  - `409 { ok: false, error: "not_ready" }` - Preview not yet available (status not 'done')
  - `500 { ok: false, error: "error_message" }` - Server error
- **Side effects:** Reads from `projects` table
- **Logs/phrases:** `[preview web] status check`, `[preview web] status error`

**Sample:**
```bash
curl "https://api.diygenieapp.com/api/projects/550e8400-e29b-41d4-a716-446655440001/preview/status?user_id=550e8400-e29b-41d4-a716-446655440001"
```

---

### DELETE /api/projects/:id
- **Handler file:** `index.js:2055`
- **Auth:** none
- **Request headers:** -
- **Query params:** `dry` (optional, set to "1" for dry-run mode)
- **Path params:** `id` (project UUID)
- **Request body:** -
- **Response (success - normal delete):** `200 { ok: true }`
- **Response (success - dry-run):** `200 { ok: true, dry: true, wouldRemove: { uploads: [...], roomScans: [...], rows: { previews: N, room_scans: M, projects: 1 } } }`
- **Response (errors):** `500 { ok: false, error: "error_message" }`
- **Side effects:** 
  - **Storage cleanup:** Lists and deletes files from two buckets:
    - `uploads`: All files under `projects/:id/` prefix
    - `room-scans`: Only files linked to `room_scans` rows for this project (extracts paths from `image_url` field)
  - **Database cleanup:** Deletes rows in order:
    1. `previews` table (by `project_id`)
    2. `room_scans` table (by `project_id`)
    3. `projects` table (by `id`)
  - **Idempotent:** Missing data treated as success (no errors if already deleted)
  - **Chunked deletion:** Storage files deleted in chunks of ≤100
- **Logs/phrases:** 
  - `[delete] <project_id> filesRemoved=<n> rows={previews:<n>,room_scans:<n>,projects:<n>}` - Success summary
  - `[delete] error` - Unexpected error
- **Special notes:**
  - Dry-run mode (`?dry=1`) returns what would be deleted without actually deleting
  - Uses Supabase Storage API with pagination support (handles >1000 files)
  - Pagination: Lists files in batches of 100 until all are discovered
  - Uses Supabase Admin client (service role key) to bypass RLS
  - Never deletes room-scans files not linked to this project
  - Safe for production use (idempotent, comprehensive cleanup)
  - No RPC calls - pure Storage API implementation

**Sample (dry-run):**
```bash
curl -X DELETE "https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001?dry=1"
```

**Sample Response (dry-run):**
```json
{
  "ok": true,
  "dry": true,
  "wouldRemove": {
    "uploads": ["projects/550e8400-.../image1.jpg", "projects/550e8400-.../image2.jpg"],
    "roomScans": ["user123/scan1.jpg"],
    "rows": {
      "previews": 2,
      "room_scans": 1,
      "projects": 1
    }
  }
}
```

**Sample (real delete):**
```bash
curl -X DELETE https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001
```

**Sample Response (real delete):**
```json
{
  "ok": true
}
```

---

### GET /api/projects/force-ready-all
- **Handler file:** `index.js:1208`
- **Auth:** none (dev utility)
- **Request headers:** -
- **Query params:** `user_id` (UUID, optional)
- **Path params:** -
- **Request body:** -
- **Response (success):** `200 { ok: true }`
- **Response (errors):** `500 { ok: false, error: "error_message" }`
- **Side effects:** Updates all `preview_requested` projects to `preview_ready` with stub image
- **Logs/phrases:** -

**Sample:**
```bash
curl 'https://your-api.com/api/projects/force-ready-all?user_id=550e8400-e29b-41d4-a716-446655440001'
```

---

### GET /api/projects/:id/force-ready
- **Handler file:** `index.js:1224`
- **Auth:** none (dev utility)
- **Request headers:** -
- **Query params:** -
- **Path params:** `id` (project UUID)
- **Request body:** -
- **Response (success):** `200 { ok: true, id: "uuid" }`
- **Response (errors):** `500 { ok: false, error: "error_message" }`
- **Side effects:** Updates project to `preview_ready` with stub image
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/api/projects/550e8400-e29b-41d4-a716-446655440001/force-ready
```

---

### GET /billing/success
- **Handler file:** `index.js:1239`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200` HTML page with success message
- **Response (errors):** -
- **Side effects:** none
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/billing/success
```

---

### GET /billing/cancel
- **Handler file:** `index.js:1247`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200` HTML page with cancel message
- **Response (errors):** -
- **Side effects:** none
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/billing/cancel
```

---

### GET /billing/portal-return
- **Handler file:** `index.js:1255`
- **Auth:** none
- **Request headers:** -
- **Query params:** -
- **Path params:** -
- **Request body:** -
- **Response (success):** `200` HTML page with portal return message
- **Response (errors):** -
- **Side effects:** none
- **Logs/phrases:** -

**Sample:**
```bash
curl https://your-api.com/billing/portal-return
```

---

## Environment Variables

| Variable | Purpose | First Used | Default/Required |
|----------|---------|------------|------------------|
| `SUPABASE_URL` | Supabase project URL | `index.js:20` | **Required** (exits in prod) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (admin access) | `index.js:21` | **Required** (exits in prod) |
| `SUPABASE_SERVICE_ROLE_KEY` | Alias for SUPABASE_SERVICE_KEY | `index.js:21` | Fallback |
| `EXPO_PUBLIC_UPLOADS_BUCKET` | Supabase storage bucket name | `index.js:36` | Default: `"uploads"` |
| `TEST_USER_ID` | Dev/test user UUID | `index.js:37` | Optional |
| `TEST_USER_EMAIL` | Dev/test user email | `index.js:38` | Default: `dev+test@diygenieapp.com` |
| `STRIPE_SECRET_KEY` | Stripe API secret key | `index.js:42` | Optional (billing disabled if missing) |
| `DEV_NO_QUOTA` | Bypass quota limits in dev (set to "1") | `index.js:94` | Optional |
| `NODE_ENV` | Environment mode | `index.js:27` | Default: `development` |
| `PREVIEW_PROVIDER` | Preview generation provider | `index.js:208` | Default: `"stub"` (`"decor8"` for real) |
| `PLAN_PROVIDER` | Plan generation provider | `index.js:209` | Default: `"stub"` (`"openai"` for real) |
| `SUGGESTIONS_PROVIDER` | Suggestions provider | `index.js:210` | Default: `"stub"` (`"openai"` for real) |
| `SUGGESTIONS_OPENAI_MODEL` | OpenAI model for suggestions | `index.js:211` | Default: `"gpt-4o-mini"` |
| `SUGGESTIONS_OPENAI_BASE` | OpenAI API base URL | `index.js:212` | Default: `"https://api.openai.com/v1"` |
| `DECOR8_BASE_URL` | Decor8 API base URL | `index.js:215` | Default: `"https://api.decor8.ai"` |
| `DECOR8_API_KEY` | Decor8 API key | `index.js:216` | Required if PREVIEW_PROVIDER=decor8 |
| `OPENAI_API_KEY` | OpenAI API key | `index.js:251` | Required if PLAN_PROVIDER=openai |
| `PRO_PRICE_ID` | Stripe price ID for Pro tier | `index.js:410` | Required for Pro checkout |
| `CASUAL_PRICE_ID` | Stripe price ID for Casual tier | `index.js:410` | Required for Casual checkout |
| `SUCCESS_URL` | Stripe checkout success redirect | `index.js:417` | Default: `{base}/billing/success` |
| `CANCEL_URL` | Stripe checkout cancel redirect | `index.js:418` | Default: `{base}/billing/cancel` |
| `PORTAL_RETURN_URL` | Stripe portal return URL | `index.js:462` | Default: `{base}/billing/portal-return` |
| `PORT` | Server port | `index.js:1264` | Default: `5000` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature secret | - | Required for webhooks (not in this file) |

---

## External Calls

### Supabase (@supabase/supabase-js SDK)
- **Where:** Throughout `index.js`
- **Operations:**
  - Database queries: `supabase.from('profiles|projects').select(...)` 
  - Auth admin: `supabase.auth.admin.getUserById(...)`, `supabase.auth.admin.createUser(...)`
  - Storage uploads: `supabase.storage.from(bucket).upload(path, buffer)`
  - Storage public URLs: `supabase.storage.from(bucket).getPublicUrl(path)`
- **Tables accessed:** `profiles`, `projects`
- **Auth:** Service role key (bypasses RLS)

### Stripe (stripe SDK)
- **Where:** `index.js:420, 465`
- **Operations:**
  - Create checkout session: `stripe.checkout.sessions.create({ mode: 'subscription', line_items: [...], ... })`
  - Create billing portal session: `stripe.billingPortal.sessions.create({ customer, return_url })`
- **Request shape:**
  - Checkout: `{ mode, line_items, success_url, cancel_url, metadata, subscription_data }`
  - Portal: `{ customer, return_url }`
- **Auth:** `STRIPE_SECRET_KEY`

### Decor8 AI (fetch)
- **Where:** `index.js:227`
- **Endpoint:** `POST {DECOR8_BASE_URL}/generate_designs_for_room`
- **Request:**
  ```json
  {
    "input_image_url": "https://...",
    "room_type": "livingroom",
    "design_style": "minimalist",
    "num_images": 1
  }
  ```
- **Headers:** `Authorization: Bearer {DECOR8_API_KEY}`, `Content-Type: application/json`
- **Response:** `{ error: "", message: "...", info: { images: ["url1", ...] } }`
- **Auth:** Bearer token (`DECOR8_API_KEY`)

### OpenAI (fetch)
- **Where:** `index.js:272` (plan generation), `index.js:636` (suggestions)
- **Endpoint:** `POST https://api.openai.com/v1/chat/completions`
- **Request (Plan):**
  ```json
  {
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "system", "content": "You are a DIY project planning assistant..." },
      { "role": "user", "content": "Generate plan for..." }
    ],
    "temperature": 0.7,
    "response_format": { "type": "json_object" }
  }
  ```
- **Request (Suggestions):**
  ```json
  {
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "system", "content": "You are an interior design assistant..." },
      { "role": "user", "content": "Project: ...\nBudget: ...\nSkill: ..." }
    ],
    "temperature": 0.2,
    "max_tokens": 350,
    "response_format": { "type": "json_object" }
  }
  ```
- **Headers:** `Authorization: Bearer {OPENAI_API_KEY}`, `Content-Type: application/json`
- **Response:** `{ choices: [{ message: { content: "{json}" } }] }`
- **Auth:** Bearer token (`OPENAI_API_KEY`)

---

## Middleware

### CORS
- **File:** `index.js:8`
- **Config:** Allows all origins, methods: GET, POST, PATCH, OPTIONS

### Request Logging
- **File:** `index.js:12-15`
- **Logs:** `[REQ] METHOD /path` for every request

### JSON Body Parser
- **File:** `index.js:9`
- **Config:** Express built-in JSON parser

### Multer (File Upload)
- **File:** `index.js:17`
- **Config:** Memory storage (buffers in RAM)
- **Used on:** `POST /api/projects/:id/image`

### requirePreviewOrBuildQuota
- **File:** `index.js:186-205`
- **Applied to:** `POST /api/projects/:id/preview`
- **Function:** Checks user entitlements, verifies quota/tier
- **Sets:** `req.user_id`, `req.entitlements`

---

## Summary

**Total Endpoints:** 28

**By Method:**
- GET: 15
- POST: 12
- DELETE: 1

**By Category:**
- Health/Status: 2
- Entitlements: 3
- Billing: 3
- Projects (CRUD): 4
- Project Actions: 9
- Measurements: 2
- Utilities: 2
- Redirects: 3
