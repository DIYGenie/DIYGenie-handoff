#!/bin/bash
# Production smoke test for measurement endpoints
# Tests against https://api.diygenieapp.com

set -e

# Configuration
BASE_URL="https://api.diygenieapp.com"
USER_ID="${USER_ID:-}" # Pass as environment variable
PROJECT_ID="${PROJECT_ID:-}"
SCAN_ID="${SCAN_ID:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Production Measurement Endpoint Smoke Test"
echo "=============================================="
echo ""

# Check required variables
if [ -z "$USER_ID" ] || [ -z "$PROJECT_ID" ] || [ -z "$SCAN_ID" ]; then
  echo -e "${RED}❌ Missing required environment variables${NC}"
  echo ""
  echo "Usage:"
  echo "  USER_ID=<uuid> PROJECT_ID=<uuid> SCAN_ID=<uuid> ./tests/measure.prod.test.sh"
  echo ""
  echo "Required variables:"
  echo "  USER_ID     - Your authenticated user UUID"
  echo "  PROJECT_ID  - Test project UUID (must be owned by USER_ID)"
  echo "  SCAN_ID     - Test scan UUID (must belong to PROJECT_ID)"
  exit 1
fi

echo "Configuration:"
echo "  Base URL:   $BASE_URL"
echo "  User ID:    $USER_ID"
echo "  Project ID: $PROJECT_ID"
echo "  Scan ID:    $SCAN_ID"
echo ""

# Test 1: POST measure with ROI
echo -e "${YELLOW}Test 1: POST /api/projects/:projectId/scans/:scanId/measure${NC}"
echo "Request:"
echo "  curl -X POST \"$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure\" \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"user_id\":\"$USER_ID\",\"roi\":{\"x\":0.25,\"y\":0.70,\"w\":0.34,\"h\":0.23}}'"
echo ""
echo "Response:"
RESPONSE_1=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$USER_ID\",\"roi\":{\"x\":0.25,\"y\":0.70,\"w\":0.34,\"h\":0.23}}")

HTTP_STATUS_1=$(echo "$RESPONSE_1" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY_1=$(echo "$RESPONSE_1" | sed '/HTTP_STATUS:/d')

echo "  HTTP $HTTP_STATUS_1"
echo "  $BODY_1"
echo ""

if [ "$HTTP_STATUS_1" = "200" ]; then
  echo -e "${GREEN}✅ Test 1 PASSED${NC}"
else
  echo -e "${RED}❌ Test 1 FAILED (expected HTTP 200, got $HTTP_STATUS_1)${NC}"
fi
echo ""

# Test 2: GET measure status
echo -e "${YELLOW}Test 2: GET /api/projects/:projectId/scans/:scanId/measure/status${NC}"
echo "Request:"
echo "  curl \"$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure/status?user_id=$USER_ID\""
echo ""
echo "Response:"
RESPONSE_2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure/status?user_id=$USER_ID")

HTTP_STATUS_2=$(echo "$RESPONSE_2" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY_2=$(echo "$RESPONSE_2" | sed '/HTTP_STATUS:/d')

echo "  HTTP $HTTP_STATUS_2"
echo "  $BODY_2"
echo ""

if [ "$HTTP_STATUS_2" = "200" ]; then
  echo -e "${GREEN}✅ Test 2 PASSED${NC}"
else
  echo -e "${RED}❌ Test 2 FAILED (expected HTTP 200, got $HTTP_STATUS_2)${NC}"
fi
echo ""

# Summary
echo "=============================================="
if [ "$HTTP_STATUS_1" = "200" ] && [ "$HTTP_STATUS_2" = "200" ]; then
  echo -e "${GREEN}✅ All tests PASSED!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests FAILED${NC}"
  exit 1
fi
