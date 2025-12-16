#!/bin/bash

# ============================================================================
# TranscriptAI Smoke Test Script
# ============================================================================
# Quick validation of core functionality (runs in < 30 seconds).
# Run this BEFORE building DMG to catch issues early.
#
# Usage:
#   ./scripts/smoke-test.sh                    # Test against default ports
#   ./scripts/smoke-test.sh --backend-port 8000  # Custom backend port
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default ports
BACKEND_PORT=8765
FRONTEND_PORT=5173

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --backend-port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"

PASSED=0
FAILED=0

log_test() { echo -e "${BLUE}[TEST]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAILED++)); }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Smoke Test${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo ""
echo "Backend:  $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo ""

# ============================================================================
# Test 1: Backend Health Check
# ============================================================================
log_test "Backend health endpoint..."

HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health" 2>/dev/null || echo "000")

if [[ "$HEALTH_RESPONSE" == "200" ]]; then
    log_pass "Backend health check (HTTP 200)"
else
    log_fail "Backend health check (HTTP $HEALTH_RESPONSE)"
fi

# ============================================================================
# Test 2: Backend API Status
# ============================================================================
log_test "Backend API status..."

STATUS_RESPONSE=$(curl -s "$BACKEND_URL/api/v1/status" 2>/dev/null || echo "")

if [[ "$STATUS_RESPONSE" == *"api_version"* ]]; then
    log_pass "Backend API status returns valid JSON"
else
    log_fail "Backend API status invalid"
fi

# ============================================================================
# Test 3: Backend Model Status
# ============================================================================
log_test "Backend model status..."

MODEL_STATUS=$(curl -s "$BACKEND_URL/health" 2>/dev/null | grep -o '"whisper":{[^}]*}' || echo "")

if [[ -n "$MODEL_STATUS" ]]; then
    log_pass "Backend reports model status"
else
    log_skip "Backend model status not available"
fi

# ============================================================================
# Test 4: Upload Endpoint Exists
# ============================================================================
log_test "Upload endpoint responds..."

# Send OPTIONS request to check endpoint exists
UPLOAD_CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$BACKEND_URL/api/v1/upload" 2>/dev/null || echo "000")

# 405 Method Not Allowed is expected for OPTIONS on POST endpoint, that's fine
if [[ "$UPLOAD_CHECK" == "200" ]] || [[ "$UPLOAD_CHECK" == "405" ]] || [[ "$UPLOAD_CHECK" == "422" ]]; then
    log_pass "Upload endpoint exists"
else
    log_fail "Upload endpoint not responding (HTTP $UPLOAD_CHECK)"
fi

# ============================================================================
# Test 5: Live Mic Endpoint Exists
# ============================================================================
log_test "Live mic endpoint responds..."

LIVE_CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/v1/live/start" 2>/dev/null || echo "000")

# 200 = success, 404 = feature disabled (acceptable)
if [[ "$LIVE_CHECK" == "200" ]] || [[ "$LIVE_CHECK" == "404" ]]; then
    log_pass "Live mic endpoint exists (HTTP $LIVE_CHECK)"
else
    log_fail "Live mic endpoint error (HTTP $LIVE_CHECK)"
fi

# ============================================================================
# Test 6: Results Endpoint
# ============================================================================
log_test "Results endpoint responds..."

RESULTS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/v1/pipeline/results" 2>/dev/null || echo "000")

if [[ "$RESULTS_CHECK" == "200" ]]; then
    log_pass "Results endpoint returns data"
else
    log_fail "Results endpoint error (HTTP $RESULTS_CHECK)"
fi

# ============================================================================
# Test 7: Frontend Loads
# ============================================================================
log_test "Frontend loads..."

FRONTEND_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")

if [[ "$FRONTEND_CHECK" == "200" ]]; then
    log_pass "Frontend loads (HTTP 200)"
else
    log_fail "Frontend not loading (HTTP $FRONTEND_CHECK)"
fi

# ============================================================================
# Test 8: Frontend Assets
# ============================================================================
log_test "Frontend serves assets..."

# Check if main.tsx or compiled JS is served
ASSET_CHECK=$(curl -s "$FRONTEND_URL" 2>/dev/null | grep -c "script" || echo "0")

if [[ "$ASSET_CHECK" -gt 0 ]]; then
    log_pass "Frontend includes scripts"
else
    log_fail "Frontend missing scripts"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Results${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Passed: ${GREEN}$PASSED${NC}"
echo -e "  Failed: ${RED}$FAILED${NC}"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All smoke tests passed!${NC}"
    echo "Safe to proceed with DMG build."
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    echo "Fix issues before building DMG."
    exit 1
fi


