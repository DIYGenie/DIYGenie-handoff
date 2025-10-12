# Health Endpoints & Structured Logging

## Overview
Comprehensive health check system with structured JSON logging and secret redaction. Supports Kubernetes-style liveness/readiness probes and full diagnostic information with mode flags.

## Files Added

### 1. `utils/logger.js` - Structured Logger
Utility for structured JSON logging with automatic secret redaction.

**Functions:**
- `log(event, payload)` - Logs single-line JSON with timestamp
- `maskEnv(env)` - Redacts sensitive environment variables
- `redact(val)` - Redacts secret values (shows only first/last chars or host)

**Sensitive Keys Redacted:**
- `DECOR8_API_KEY`
- `OPENAI_API_KEY`
- `DATABASE_URL` (shows `***@hostname`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_KEY`
- `STRIPE_SECRET_KEY`

**Log Format:**
```json
{"ts":"2025-10-12T07:20:12.809Z","event":"health.full","ok":true,"modes":{"decor8":"live","openai":"live"},"duration_ms":148}
```

### 2. `routes/health.js` - Health Router
Express router with four health check endpoints.

## Endpoints

### `GET /health` - Basic Health
Simple health check for basic monitoring.

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0",
  "uptime_s": 12
}
```

### `GET /health/live` - Liveness Probe
Kubernetes liveness probe (always returns 200).

**Response:**
```json
{
  "ok": true,
  "status": "live"
}
```

### `GET /health/ready` - Readiness Check
Validates database connectivity and environment configuration.

**Response (200 when ready):**
```json
{
  "ok": true,
  "checks": [
    {"name": "db", "ok": true},
    {"name": "env.SUPABASE_URL", "ok": true},
    {"name": "env.SUPABASE_SERVICE_KEY", "ok": true},
    {"name": "env.DECOR8_BASE_URL", "ok": true}
  ]
}
```

**Response (503 when not ready):**
```json
{
  "ok": false,
  "checks": [
    {"name": "db", "ok": false, "err": "connection timeout"},
    {"name": "env.SUPABASE_URL", "ok": true},
    {"name": "env.SUPABASE_SERVICE_KEY", "ok": true},
    {"name": "env.DECOR8_BASE_URL", "ok": false}
  ]
}
```

### `GET /health/full` - Full Diagnostics
Comprehensive system diagnostics with mode flags, version info, and environment summary.

**Response:**
```json
{
  "ok": true,
  "checks": [
    {"name": "db.query", "ok": true}
  ],
  "modes": {
    "decor8": "live",
    "openai": "live"
  },
  "version": {
    "service": "nodejs",
    "version": "1.0.0",
    "node": "v22.17.0"
  },
  "uptime_s": 13,
  "started_at": "2025-10-12T07:19:59.236Z",
  "duration_ms": 148,
  "env_summary": {
    "DECOR8_BASE_URL": "https://api.decor8.ai",
    "SUPABASE_URL": "set",
    "OPENAI_API_KEY": "set",
    "STRIPE_SECRET_KEY": "set"
  }
}
```

## Mode Detection

The `/health/full` endpoint shows which providers are in stub vs live mode:

**Stub Mode (Development):**
- `decor8: "stub"` - When `DECOR8_BASE_URL` is unset or starts with "stub"
- `openai: "stub"` - When `OPENAI_API_KEY` is unset

**Live Mode (Production):**
- `decor8: "live"` - When `DECOR8_BASE_URL` is set to a real URL
- `openai: "live"` - When `OPENAI_API_KEY` is set

## Structured Logging

All `/health/full` requests generate structured JSON logs:

```json
{"ts":"2025-10-12T07:20:12.809Z","event":"health.full","ok":true,"modes":{"decor8":"live","openai":"live"},"duration_ms":148}
```

Failed readiness checks also log:
```json
{"ts":"2025-10-12T07:20:15.123Z","event":"health.ready.fail","checks":[{"name":"db","ok":false,"err":"timeout"}]}
```

## Integration

The health router is mounted in `index.js`:

```javascript
import healthRouter from './routes/health.js';
app.use('/', healthRouter);
```

## Kubernetes/Docker Integration

Use these endpoints for container orchestration:

**Liveness Probe:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 5000
  initialDelaySeconds: 10
  periodSeconds: 30
```

**Readiness Probe:**
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 5000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Testing

All endpoints tested and verified:
- ✅ `/health` returns basic status
- ✅ `/health/live` returns 200 OK
- ✅ `/health/ready` validates DB and env (200 when ready, 503 when not)
- ✅ `/health/full` returns comprehensive diagnostics with modes
- ✅ Structured JSON logging works correctly
- ✅ Secret redaction prevents exposure
- ✅ Mode flags show `decor8: live` and `openai: live`

## Current System Status

**Modes from `/health/full`:**
- `decor8: "live"` ✅
- `openai: "live"` ✅

**Readiness Check (`/health/ready`):**
- Status: `200 OK` ✅
- All checks passing ✅

**Database:** Connected ✅  
**Environment:** All required vars set ✅  
**Services:** Running in live mode ✅
