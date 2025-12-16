#!/bin/bash

# ============================================================================
# TranscriptAI Performance Benchmark Script
# ============================================================================
# Measures key performance metrics to detect regressions.
# Run this BEFORE and AFTER any feature changes.
#
# Usage:
#   ./scripts/benchmark-performance.sh
#   ./scripts/benchmark-performance.sh > baseline.txt  # Save results
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Performance Benchmark${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo ""
echo "Timestamp: $(date -Iseconds)"
echo "Machine: $(uname -m)"
echo ""

# ============================================================================
# 1. Backend Import Time
# ============================================================================
echo -e "${YELLOW}[1/5] Backend Import Time${NC}"

cd "$ROOT_DIR"
if [[ -d "venv" ]]; then
    source venv/bin/activate
fi

IMPORT_START=$(python3 -c "import time; print(time.time())")
python3 -c "from backend.app.main import app" 2>/dev/null
IMPORT_END=$(python3 -c "import time; print(time.time())")
IMPORT_TIME=$(python3 -c "print(f'{$IMPORT_END - $IMPORT_START:.2f}')")

echo "Backend import time: ${IMPORT_TIME}s"
echo ""

# ============================================================================
# 2. Frontend Build Check (type-check only, not full build)
# ============================================================================
echo -e "${YELLOW}[2/5] Frontend Type Check Time${NC}"

cd "$ROOT_DIR/frontend"
if [[ -f "package.json" ]]; then
    TYPE_START=$(date +%s.%N)
    npm run type-check --silent 2>/dev/null || true
    TYPE_END=$(date +%s.%N)
    TYPE_TIME=$(python3 -c "print(f'{$TYPE_END - $TYPE_START:.2f}')")
    echo "Frontend type-check time: ${TYPE_TIME}s"
else
    echo "Frontend type-check: SKIPPED (no package.json)"
fi
echo ""

# ============================================================================
# 3. Test Suite Execution Time
# ============================================================================
echo -e "${YELLOW}[3/5] Core Test Execution Time${NC}"

cd "$ROOT_DIR"
TEST_START=$(date +%s.%N)
python3 -m pytest tests/python/test_db.py -q --tb=no 2>/dev/null || true
TEST_END=$(date +%s.%N)
TEST_TIME=$(python3 -c "print(f'{$TEST_END - $TEST_START:.2f}')")

echo "Core test execution time: ${TEST_TIME}s"
echo ""

# ============================================================================
# 4. Memory Usage Estimate
# ============================================================================
echo -e "${YELLOW}[4/5] Python Memory Usage (import only)${NC}"

MEMORY_KB=$(python3 -c "
import resource
from backend.app.main import app
usage = resource.getrusage(resource.RUSAGE_SELF)
print(int(usage.ru_maxrss / 1024))  # Convert to MB on macOS
" 2>/dev/null || echo "0")

echo "Peak memory (import): ${MEMORY_KB} MB"
echo ""

# ============================================================================
# 5. File Counts
# ============================================================================
echo -e "${YELLOW}[5/5] Codebase Metrics${NC}"

cd "$ROOT_DIR"
PY_FILES=$(find backend -name "*.py" | grep -v __pycache__ | grep -v venv | wc -l | tr -d ' ')
TS_FILES=$(find frontend/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | wc -l | tr -d ' ')
TOTAL_DEPS=$(wc -l < requirements.txt | tr -d ' ')

echo "Python files (backend): $PY_FILES"
echo "TypeScript files (frontend): $TS_FILES"
echo "Python dependencies: $TOTAL_DEPS"
echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Summary${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo "Backend Import:    ${IMPORT_TIME}s"
echo "Frontend Type-check: ${TYPE_TIME}s"
echo "Core Tests:        ${TEST_TIME}s"
echo "Memory (import):   ${MEMORY_KB} MB"
echo "Python Files:      $PY_FILES"
echo "TypeScript Files:  $TS_FILES"
echo "Dependencies:      $TOTAL_DEPS"
echo ""
echo "Run this again after changes to compare."


