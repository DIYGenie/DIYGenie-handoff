#!/bin/bash
# Preview Endpoints Test Script
# Tests the minimal preview endpoints that mirror the measure pattern

# Production values (use these after deployment)
API_BASE="${API_BASE:-https://api.diygenieapp.com}"
PROJECT_ID="${PROJECT_ID:-194e1c7e-f156-457f-adc5-37d642b5049b}"
USER_ID="${USER_ID:-99198c4b-8470-49e2-895c-75593c5aa181}"

echo "=========================================="
echo "Testing Preview Endpoints"
echo "API: $API_BASE"
echo "=========================================="
echo ""

echo "=== Test 1: POST /api/projects/:projectId/preview ==="
echo "Trigger preview generation with ROI..."
curl -X POST "${API_BASE}/api/projects/${PROJECT_ID}/preview" \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_id\":\"${USER_ID}\",
    \"roi\":{\"x\":0.25,\"y\":0.70,\"w\":0.34,\"h\":0.23}
  }" | jq '.'
echo ""
echo ""

echo "=== Test 2: GET /api/projects/:projectId/preview/status ==="
echo "Check preview status..."
curl "${API_BASE}/api/projects/${PROJECT_ID}/preview/status?user_id=${USER_ID}" | jq '.'
echo ""
echo ""

echo "=== Test 3: POST preview without ROI ==="
curl -X POST "${API_BASE}/api/projects/${PROJECT_ID}/preview" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"${USER_ID}\"}" | jq '.'
echo ""
echo ""

echo "=========================================="
echo "Expected Responses:"
echo "Test 1: { ok: true, status: 'done', preview_url: 'https://images.unsplash.com/...' }"
echo "Test 2: { ok: true, status: 'done', preview_url: '...', preview_meta: {...} }"
echo "Test 3: { ok: true, status: 'done', preview_url: '...' }"
echo "=========================================="
