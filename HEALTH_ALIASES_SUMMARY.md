# Health Endpoint Aliases & Enhancements

## Overview
Added comprehensive health endpoint aliases under `/api/*` namespace with HEAD support, CORS headers, and version endpoints. All changes are additive - existing routes remain unchanged.

## New Features

### 1. **Health Endpoint Aliases**
All health endpoints now available under `/api/*` prefix:

| Original Endpoint | Alias Endpoint |
|------------------|----------------|
| `GET /health` | `GET /api/health` |
| `GET /health/live` | `GET /api/health/live` |
| `GET /health/ready` | `GET /api/health/ready` |
| `GET /health/full` | `GET /api/health/full` |

Both endpoints return **identical responses** using shared handler functions.

### 2. **HEAD Support**
All health endpoints support HEAD requests (both original and alias paths):
- `HEAD /health`
- `HEAD /health/live`
- `HEAD /health/ready`
- `HEAD /health/full`
- `HEAD /api/health`
- `HEAD /api/health/live`
- `HEAD /api/health/ready`
- `HEAD /api/health/full`

**Response:** `200 OK` with empty body and CORS headers

### 3. **CORS Headers**
All health and version endpoints include CORS headers:
```
Access-Control-Allow-Origin: *
```

### 4. **Version Endpoints**
New endpoints for service version information:

**`GET /version`** and **`GET /api/version`**
```json
{
  "service": "nodejs",
  "version": "1.0.0",
  "node": "v22.17.0"
}
```

Also supports `HEAD /version` and `HEAD /api/version`

## Implementation Details

### Updated Files

#### 1. **`routes/health.js`** - Refactored for Reusability
- Exported named handler functions: `healthGet`, `liveGet`, `readyGet`, `fullGet`, `healthHead`
- Added CORS headers to all responses
- Added structured logging for alias requests
- Kept existing router-based routes

**Key Changes:**
```javascript
export function healthGet(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  // ... existing logic ...
  log('health.alias', { path: req.path, status: 200 });
  res.json(payload);
}

export function healthHead(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).end();
}
```

#### 2. **`routes/version.js`** - New Version Router
```javascript
export function versionGet(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ 
    service: pkg.name || 'diy-genie-webhooks', 
    version: pkg.version || '0.0.0', 
    node: process.version 
  });
}

export function versionHead(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).end();
}
```

#### 3. **`index.js`** - Mounted Aliases
```javascript
import healthRouter, { healthGet, liveGet, readyGet, fullGet, healthHead } from './routes/health.js';
import versionRouter, { versionGet, versionHead } from './routes/version.js';

// Mount routers
app.use('/', healthRouter);
app.use('/', versionRouter);

// Aliases under /api
app.get('/api/health', healthGet);
app.get('/api/health/live', liveGet);
app.get('/api/health/ready', readyGet);
app.get('/api/health/full', fullGet);
app.get('/api/version', versionGet);

// HEAD handlers for aliases
app.head('/api/health', healthHead);
app.head('/api/health/live', healthHead);
app.head('/api/health/ready', healthHead);
app.head('/api/health/full', healthHead);
app.head('/api/version', versionHead);
```

## Structured Logging

All alias requests generate structured JSON logs:

**Example Logs:**
```json
{"ts":"2025-10-12T13:02:01.007Z","event":"health.full","ok":true,"modes":{"decor8":"live","openai":"live"},"duration_ms":325}
{"ts":"2025-10-12T13:02:01.007Z","event":"health.alias","path":"/api/health/full","status":200}
```

**Log Events:**
- `health.full` - Full health check execution
- `health.alias` - Alias endpoint hit with path and status

## Testing Results

### ✅ All Tests Passed

**1. Sample response from `/api/health/full`:**
```json
{
  "modes": {
    "decor8": "live",
    "openai": "live"
  }
}
```

**2. HTTP status for `HEAD /api/health`:**
```
HTTP/1.1 200 OK
```

**3. `/version` payload:**
```json
{
  "service": "nodejs",
  "version": "1.0.0",
  "node": "v22.17.0"
}
```

### Endpoint Comparison
Both original and alias endpoints return **identical responses**:

**`GET /health`:**
```json
{"ok":true,"status":"healthy","version":"1.0.0","uptime_s":58}
```

**`GET /api/health`:**
```json
{"ok":true,"status":"healthy","version":"1.0.0","uptime_s":58}
```

### CORS Verification
All endpoints include CORS headers:
```
Access-Control-Allow-Origin: *
```

## Usage Examples

### From Frontend/Client

```javascript
// Health check with CORS
const health = await fetch('https://api.example.com/api/health/full');
const data = await health.json();
console.log(data.modes); // { decor8: 'live', openai: 'live' }

// HEAD request for lightweight health check
const alive = await fetch('https://api.example.com/api/health', { method: 'HEAD' });
console.log(alive.ok); // true

// Version check
const version = await fetch('https://api.example.com/version');
const versionData = await version.json();
console.log(versionData); // { service: 'nodejs', version: '1.0.0', node: 'v22.17.0' }
```

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /api/health/live
    port: 5000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 5000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Benefits

1. **Namespace Organization** - `/api/*` prefix groups operational endpoints
2. **Backward Compatible** - Original endpoints still work
3. **HEAD Support** - Lightweight checks without response body
4. **CORS Ready** - Cross-origin requests supported out of the box
5. **Structured Logging** - Easy parsing and monitoring
6. **Version Transparency** - Easy service version discovery
7. **Shared Handlers** - No code duplication, single source of truth

## Files Modified

- ✅ `routes/health.js` - Refactored to export named functions with CORS
- ✅ `routes/version.js` - New file with version endpoints
- ✅ `index.js` - Added aliases and HEAD handlers

## Structured Logs Sample

```
[REQ] GET /api/health/full
{"ts":"2025-10-12T13:02:01.007Z","event":"health.full","ok":true,"modes":{"decor8":"live","openai":"live"},"duration_ms":325}
{"ts":"2025-10-12T13:02:01.007Z","event":"health.alias","path":"/api/health/full","status":200}
[REQ] HEAD /api/health
{"ts":"2025-10-12T13:02:13.258Z","event":"health.alias","path":"/api/health","status":200}
```

## Current System Status

**All Systems Operational** ✅

- **Modes:** `decor8: live`, `openai: live`
- **Database:** Connected
- **Health Endpoints:** 8 GET + 8 HEAD = 16 total endpoints
- **Version Endpoints:** 2 GET + 2 HEAD = 4 total endpoints
- **CORS:** Enabled on all health/version routes
- **Logging:** Structured JSON format
