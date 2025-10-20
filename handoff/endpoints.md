# DIY Genie iOS API Contract

## Base URL
```
Production: https://api.diygenieapp.com
Development: http://localhost:5000
```

## Authentication
- **Preferred method**: Query parameter `user_id` (UUID string)
- **Alternative**: None currently implemented
- All endpoints requiring user identification use `user_id` query parameter

---

## Endpoints

### 1. GET /health

**Description**: Health check endpoint to verify API availability

**Method**: `GET`

**Path**: `/health`

**Headers**: None required

**Query Params**: None

**Request Body**: None

**Success Response**:
- **Status**: `200 OK`
- **Body**:
```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0",
  "uptime_s": 12345
}
```

**Error Responses**: None (always returns 200)

**Example**:
```bash
curl http://localhost:5000/health
```

---

### 2. GET /api/projects

**Description**: List all projects for a user

**Method**: `GET`

**Path**: `/api/projects`

**Headers**: None required

**Query Params**:
- `user_id` (string, required): UUID of the user

**Request Body**: None

**Success Response**:
- **Status**: `200 OK`
- **Body**:
```json
{
  "ok": true,
  "items": [
    {
      "id": "uuid-string",
      "name": "Project Name",
      "status": "draft",
      "input_image_url": "https://...",
      "preview_url": "https://..." 
    }
  ]
}
```

**Error Responses**:
- **Status**: `500 Internal Server Error`
- **Body**:
```json
{
  "ok": false,
  "error": "error_message"
}
```

**Example**:
```bash
curl "http://localhost:5000/api/projects?user_id=99198c4b-8470-49e2-895c-75593c5aa181"
```

---

### 3. POST /api/projects

**Description**: Create a new project

**Method**: `POST`

**Path**: `/api/projects`

**Headers**:
- `Content-Type: application/json`

**Query Params**: None

**Request Body** (JSON):
```json
{
  "user_id": "uuid-string (required)",
  "name": "string (required, min 10 characters)",
  "goal": "string (optional)",
  "client": {
    "budget": "$ | $$ | $$$ (optional, defaults to $$)"
  }
}
```

**Field Requirements**:
- `user_id`: Required. Must be valid UUID string
- `name`: Required. Minimum 10 characters
- `goal`: Optional. Description of project goal
- `client.budget`: Optional. One of "$", "$$", or "$$$". Defaults to "$$"

**Success Response**:
- **Status**: `201 Created`
- **Body**:
```json
{
  "id": "uuid-string",
  "name": "Project Name",
  "goal": "Project goal or null",
  "user_id": "uuid-string",
  "created_at": "2025-10-19T23:13:51.078657+00:00"
}
```

**Error Responses**:
- **Status**: `400 Bad Request`
- **Body**:
```json
{
  "code": "missing_user_id",
  "message": "user_id is required"
}
```
OR
```json
{
  "code": "invalid_name",
  "message": "name must be at least 10 characters"
}
```
OR
```json
{
  "code": "create_project_failed",
  "message": "Failed to create project"
}
```

**Example**:
```bash
curl -X POST http://localhost:5000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "99198c4b-8470-49e2-895c-75593c5aa181",
    "name": "Floating Shelves Installation",
    "goal": "Install modern floating shelves",
    "client": {"budget": "$$"}
  }'
```

---

### 4. POST /api/projects/{id}/photo

**Description**: Attach a photo to a project (multipart file upload or URL)

**Method**: `POST`

**Path**: `/api/projects/{id}/photo`

**Headers**:
- Option A (File Upload): `Content-Type: multipart/form-data`
- Option B (URL): `Content-Type: application/json`

**Query Params**: None

**Path Params**:
- `id` (string, required): Project UUID

**Request Body**:

**Option A - File Upload**:
- Field name: Any (e.g., `file`, `image`, `photo`)
- Constraints: Must be image/* mimetype (JPEG, PNG, etc.)
- Max size: Not explicitly limited at endpoint level

**Option B - JSON URL**:
```json
{
  "url": "https://example.com/image.jpg"
}
```
- URL must start with `http://` or `https://`

**Success Response**:
- **Status**: `200 OK`
- **Body**:
```json
{
  "ok": true,
  "photo_url": "https://storage.example.com/uploads/projects/uuid/1234567890.jpg"
}
```

**Error Responses**:
- **Status**: `400 Bad Request`
- **Body**:
```json
{
  "code": "invalid_url",
  "message": "url must be http/https",
  "hint": "Provide a valid image URL"
}
```
OR
```json
{
  "code": "invalid_file_type",
  "message": "File must be an image"
}
```
OR
```json
{
  "code": "missing_file_or_url",
  "message": "Provide either file upload or url"
}
```

**Example - File Upload**:
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/photo \
  -F "file=@room_photo.jpg"
```

**Example - URL**:
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/photo \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://images.unsplash.com/photo-123"}'
```

---

### 5. POST /api/projects/{id}/preview

**Description**: Queue AI preview generation for a project

**Method**: `POST`

**Path**: `/api/projects/{id}/preview`

**Headers**:
- `Content-Type: application/json`

**Query Params**: None

**Path Params**:
- `id` (string, required): Project UUID

**Request Body** (JSON):
```json
{
  "force": false
}
```
- `force` (boolean, optional): Force regeneration even if preview exists

**Success Response**:
- **Status**: `202 Accepted`
- **Body**:
```json
{
  "status": "queued",
  "preview_id": null
}
```

**Status Values**:
- `"queued"`: Preview generation has been queued
- Future values may include: `"processing"`, `"ready"`, `"failed"`

**Error Responses**:
- **Status**: `400 Bad Request`
- **Body**:
```json
{
  "code": "project_not_found",
  "message": "Project not found"
}
```
OR
```json
{
  "code": "missing_photo",
  "message": "Project must have a photo before generating preview"
}
```

**Example**:
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/preview \
  -H 'Content-Type: application/json' \
  -d '{"force": false}'
```

---

### 6. GET /api/projects/{id}/plan

**Description**: Get the detailed project plan with steps, materials, tools, and cost estimate

**Method**: `GET`

**Path**: `/api/projects/{id}/plan`

**Headers**: None required

**Query Params**: None

**Path Params**:
- `id` (string, required): Project UUID

**Request Body**: None

**Success Response**:
- **Status**: `200 OK`
- **Body**:
```json
{
  "steps": [
    {
      "number": 1,
      "title": "Measure and mark wall",
      "description": "Use level and tape measure",
      "duration": "15 min"
    }
  ],
  "tools": [
    {
      "name": "Level",
      "required": true
    }
  ],
  "materials": [
    {
      "item": "Wood board",
      "quantity": "2",
      "cost": "$25"
    }
  ],
  "cost_estimate": {
    "total": 75,
    "currency": "USD"
  },
  "updated_at": "2025-10-19T23:13:51.964Z"
}
```

**Field Descriptions**:
- `steps`: Array of step objects with number, title, description, duration
- `tools`: Array of required tools
- `materials`: Array of materials needed with quantities and costs
- `cost_estimate`: Total cost estimate object
- `updated_at`: ISO 8601 timestamp of last plan update

**Empty Plan Response** (when no plan generated yet):
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

**Error Responses**:
- **Status**: `400 Bad Request`
- **Body**:
```json
{
  "code": "project_not_found",
  "message": "Project not found"
}
```

**Example**:
```bash
curl http://localhost:5000/api/projects/PROJECT_ID/plan
```

---

## Error Format

All error responses follow a standardized format:

```json
{
  "code": "error_code_snake_case",
  "message": "Human-readable error message",
  "hint": "Optional hint for resolution"
}
```

Common error codes:
- `missing_user_id`: user_id parameter is required
- `invalid_name`: Name validation failed
- `project_not_found`: Project with given ID not found
- `invalid_url`: URL format is invalid
- `invalid_file_type`: File type not supported
- `missing_file_or_url`: Neither file nor URL provided
- `missing_photo`: Photo must be attached first
- `create_project_failed`: Project creation failed
- `attach_photo_failed`: Photo attachment failed
- `queue_preview_failed`: Preview queueing failed
- `get_plan_failed`: Plan retrieval failed

---

## HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `202 Accepted`: Request accepted for async processing
- `400 Bad Request`: Validation error or missing required fields
- `404 Not Found`: Resource not found
- `422 Unprocessable Entity`: Invalid data format
- `500 Internal Server Error`: Server error

---

## Notes

1. **UUID Format**: All IDs use UUID v4 format (e.g., `99198c4b-8470-49e2-895c-75593c5aa181`)
2. **Timestamps**: All timestamps use ISO 8601 format with timezone
3. **File Uploads**: Accept any image/* mimetype (JPEG, PNG, HEIC, etc.)
4. **Budget Values**: Only "$", "$$", or "$$$" are valid budget values
5. **Async Operations**: Preview generation returns 202 immediately; check status separately
6. **Response Consistency**: All responses include an `ok` field or error structure
