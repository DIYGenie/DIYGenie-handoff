#!/bin/bash
# Test script for measurement endpoints
# Requires: room_scans table with measure_status and measure_result columns

# Replace these with your actual project and scan IDs
PROJECT_ID="${1:-b99f06cc-ca54-4d7f-985b-a4028076dacc}"
SCAN_ID="${2:-11111111-1111-1111-1111-111111111111}"
BASE_URL="${3:-http://localhost:5000}"

echo "=== Measurement Endpoint Test ==="
echo "Project ID: $PROJECT_ID"
echo "Scan ID: $SCAN_ID"
echo ""

echo "1️⃣  Check status before measurement (should return 409 not_ready):"
curl -sS "$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure/status"
echo -e "\n"

echo "2️⃣  Trigger measurement with ROI:"
curl -sS -X POST "$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure" \
  -H "Content-Type: application/json" \
  -d '{"roi": {"x": 100, "y": 200, "width": 300, "height": 400}}'
echo -e "\n"

echo "3️⃣  Check status after measurement (should return 200 with result):"
curl -sS "$BASE_URL/api/projects/$PROJECT_ID/scans/$SCAN_ID/measure/status"
echo -e "\n"

echo "✅ Test complete!"
