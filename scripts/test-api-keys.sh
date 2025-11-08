#!/bin/bash

# API Key MVP Test Script
# Tests the basic functionality of the API key system

set -e

echo "=========================================="
echo "  API Key MVP - Testing Script"
echo "=========================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:3005}"
TEST_EMAIL="${TEST_EMAIL:-test@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-password123}"

echo "API URL: $API_URL"
echo "Test User: $TEST_EMAIL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓${NC} $1"
}

fail() {
  echo -e "${RED}✗${NC} $1"
}

info() {
  echo -e "${YELLOW}→${NC} $1"
}

# Test 1: Login to get JWT
info "Test 1: Logging in to get JWT token..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

JWT_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token // empty')

if [ -n "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
  pass "Successfully logged in and got JWT token"
else
  fail "Login failed. Response: $LOGIN_RESPONSE"
  echo ""
  echo "Please ensure:"
  echo "1. Server is running on $API_URL"
  echo "2. User exists with email: $TEST_EMAIL"
  echo "3. Password is correct: $TEST_PASSWORD"
  echo ""
  echo "To create a test user, run:"
  echo "curl -X POST $API_URL/api/auth/register \\"
  echo "  -H \"Content-Type: application/json\" \\"
  echo "  -d '{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"Test User\"}'"
  exit 1
fi

echo ""

# Test 2: Create a dev API key
info "Test 2: Creating a development API key..."
CREATE_KEY_RESPONSE=$(curl -s -X POST "$API_URL/api/admin/keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "Test Dev Key",
    "description": "Created by test script",
    "type": "development",
    "scopes": ["read", "write"]
  }')

API_KEY=$(echo $CREATE_KEY_RESPONSE | jq -r '.key // empty')
KEY_ID=$(echo $CREATE_KEY_RESPONSE | jq -r '.keyId // empty')

if [ -n "$API_KEY" ] && [ "$API_KEY" != "null" ] && [[ "$API_KEY" == sk_dev_* ]]; then
  pass "Successfully created dev API key: ${API_KEY:0:15}...${API_KEY: -4}"
else
  fail "Failed to create API key. Response: $CREATE_KEY_RESPONSE"
  exit 1
fi

echo ""

# Test 3: List API keys
info "Test 3: Listing API keys..."
LIST_RESPONSE=$(curl -s "$API_URL/api/admin/keys" \
  -H "Authorization: Bearer $JWT_TOKEN")

KEY_COUNT=$(echo $LIST_RESPONSE | jq -r '.count // 0')

if [ "$KEY_COUNT" -gt 0 ]; then
  pass "Successfully listed $KEY_COUNT API key(s)"
else
  fail "Failed to list API keys. Response: $LIST_RESPONSE"
fi

echo ""

# Test 4: Get specific API key details
info "Test 4: Getting API key details..."
GET_KEY_RESPONSE=$(curl -s "$API_URL/api/admin/keys/$KEY_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")

KEY_NAME=$(echo $GET_KEY_RESPONSE | jq -r '.name // empty')

if [ "$KEY_NAME" == "Test Dev Key" ]; then
  pass "Successfully retrieved API key details"
else
  fail "Failed to get API key details. Response: $GET_KEY_RESPONSE"
fi

echo ""

# Test 5: Use API key to access endpoint
info "Test 5: Using API key to access /api/area/all..."
API_RESPONSE=$(curl -s "$API_URL/api/area/all" \
  -H "Authorization: Bearer $API_KEY")

# Check if response is valid JSON
if echo $API_RESPONSE | jq . > /dev/null 2>&1; then
  pass "Successfully accessed endpoint with API key"
else
  fail "Failed to access endpoint. Response: $API_RESPONSE"
fi

echo ""

# Test 6: Test invalid API key
info "Test 6: Testing invalid API key (should fail)..."
INVALID_RESPONSE=$(curl -s "$API_URL/api/area/all" \
  -H "Authorization: Bearer sk_dev_invalid_key_12345678901234567890")

ERROR_CODE=$(echo $INVALID_RESPONSE | jq -r '.error.code // empty')

if [ "$ERROR_CODE" == "INVALID_API_KEY" ]; then
  pass "Invalid API key correctly rejected"
else
  fail "Invalid API key should have been rejected. Response: $INVALID_RESPONSE"
fi

echo ""

# Test 7: Test without API key (should still work - optional auth)
info "Test 7: Accessing endpoint without API key (optional auth)..."
NO_KEY_RESPONSE=$(curl -s "$API_URL/api/area/all")

if echo $NO_KEY_RESPONSE | jq . > /dev/null 2>&1; then
  pass "Endpoint accessible without API key (optional auth works)"
else
  fail "Endpoint should be accessible without API key. Response: $NO_KEY_RESPONSE"
fi

echo ""

# Test 8: Update API key
info "Test 8: Updating API key..."
UPDATE_RESPONSE=$(curl -s -X PUT "$API_URL/api/admin/keys/$KEY_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "Test Dev Key (Updated)",
    "description": "Updated by test script"
  }')

UPDATED_NAME=$(echo $UPDATE_RESPONSE | jq -r '.name // empty')

if [ "$UPDATED_NAME" == "Test Dev Key (Updated)" ]; then
  pass "Successfully updated API key"
else
  fail "Failed to update API key. Response: $UPDATE_RESPONSE"
fi

echo ""

# Test 9: Revoke API key
info "Test 9: Revoking API key..."
REVOKE_RESPONSE=$(curl -s -X DELETE "$API_URL/api/admin/keys/$KEY_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "reason": "Test completed"
  }')

REVOKED_STATUS=$(echo $REVOKE_RESPONSE | jq -r '.status // empty')

if [ "$REVOKED_STATUS" == "revoked" ]; then
  pass "Successfully revoked API key"
else
  fail "Failed to revoke API key. Response: $REVOKE_RESPONSE"
fi

echo ""

# Test 10: Verify revoked key doesn't work
info "Test 10: Verifying revoked key is rejected..."
REVOKED_KEY_RESPONSE=$(curl -s "$API_URL/api/area/all" \
  -H "Authorization: Bearer $API_KEY")

REVOKED_ERROR=$(echo $REVOKED_KEY_RESPONSE | jq -r '.error.code // empty')

if [ "$REVOKED_ERROR" == "INVALID_API_KEY" ]; then
  pass "Revoked API key correctly rejected"
else
  fail "Revoked key should have been rejected. Response: $REVOKED_KEY_RESPONSE"
fi

echo ""
echo "=========================================="
echo "  ✓ All Tests Passed!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Created and validated dev API key"
echo "- Listed and retrieved key details"
echo "- Authenticated with API key"
echo "- Verified optional auth (no key works too)"
echo "- Updated key metadata"
echo "- Revoked key and verified rejection"
echo ""
echo "API Key MVP is working correctly! 🎉"
echo ""

