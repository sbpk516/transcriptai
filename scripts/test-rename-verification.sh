#!/bin/bash

# Verification script to test signalhub -> transcriptai rename
# This script checks that all references have been updated correctly

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Rename Verification${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

PASSED=0
FAILED=0

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1"
        ((FAILED++))
    fi
}

# 1. Check for any remaining signalhub references in ACTIVE code (exclude docs, legacy files, test dist)
echo -e "${YELLOW}[1] Checking for remaining 'signalhub' references in active code...${NC}"
ACTIVE_CODE_MATCHES=$(grep -r -i "signalhub" \
    --include="*.py" --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.sh" \
    --exclude-dir=node_modules --exclude-dir=venv --exclude-dir=venv_mlx --exclude-dir=__pycache__ --exclude-dir=.git \
    --exclude-dir=dist --exclude-dir=build --exclude-dir=dist-test --exclude-dir=docs \
    --exclude="*.md" --exclude="*test*.py" --exclude="*_test.py" --exclude="test-rename-verification.sh" \
    . 2>/dev/null | grep -v "signalhub-backend.spec\|signalhub_data\|SIGNALHUB_" | wc -l | tr -d ' ')

if [ "$ACTIVE_CODE_MATCHES" -gt 0 ]; then
    echo -e "${RED}✗${NC} Found $ACTIVE_CODE_MATCHES remaining 'signalhub' references in active code"
    grep -r -i "signalhub" \
        --include="*.py" --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.sh" \
        --exclude-dir=node_modules --exclude-dir=venv --exclude-dir=venv_mlx --exclude-dir=__pycache__ --exclude-dir=.git \
        --exclude-dir=dist --exclude-dir=build --exclude-dir=dist-test --exclude-dir=docs \
        --exclude="*.md" --exclude="*test*.py" --exclude="*_test.py" --exclude="test-rename-verification.sh" \
        . 2>/dev/null | grep -v "signalhub-backend.spec\|signalhub_data\|SIGNALHUB_" | head -10 || true
    ((FAILED++))
else
    echo -e "${GREEN}✓${NC} No 'signalhub' references found in active code files"
    ((PASSED++))
fi

echo -e "${YELLOW}   Note: Documentation files (.md) and test files may still contain 'signalhub' references for historical context${NC}"

# 2. Verify package.json files
echo ""
echo -e "${YELLOW}[2] Verifying package.json files...${NC}"
if grep -q "transcriptai-backend" backend/package.json 2>/dev/null; then
    check "backend/package.json uses 'transcriptai-backend'"
else
    echo -e "${RED}✗${NC} backend/package.json does not use 'transcriptai-backend'"
    ((FAILED++))
fi

if grep -q "transcriptai-desktop" desktop/package-lock.json 2>/dev/null; then
    check "desktop/package-lock.json uses 'transcriptai-desktop'"
else
    echo -e "${RED}✗${NC} desktop/package-lock.json does not use 'transcriptai-desktop'"
    ((FAILED++))
fi

# 3. Verify docker-compose.yml
echo ""
echo -e "${YELLOW}[3] Verifying docker-compose.yml...${NC}"
if grep -q "POSTGRES_DB: transcriptai" docker-compose.yml 2>/dev/null; then
    check "docker-compose.yml uses 'transcriptai' database"
else
    echo -e "${RED}✗${NC} docker-compose.yml database name not updated"
    ((FAILED++))
fi

# 4. Verify configuration files
echo ""
echo -e "${YELLOW}[4] Verifying configuration files...${NC}"
if grep -q "TranscriptAI Port Configuration" config/ports.env 2>/dev/null; then
    check "config/ports.env header updated"
else
    echo -e "${RED}✗${NC} config/ports.env header not updated"
    ((FAILED++))
fi

# 5. Verify documentation
echo ""
echo -e "${YELLOW}[5] Verifying documentation...${NC}"
if grep -q "transcriptai.local" docs/spec.md 2>/dev/null; then
    check "docs/spec.md schema URLs updated"
else
    echo -e "${RED}✗${NC} docs/spec.md schema URLs not updated"
    ((FAILED++))
fi

if grep -q "transcriptai.<area>" docs/project-rules.md 2>/dev/null; then
    check "docs/project-rules.md logger reference updated"
else
    echo -e "${RED}✗${NC} docs/project-rules.md logger reference not updated"
    ((FAILED++))
fi

# 6. Verify test files
echo ""
echo -e "${YELLOW}[6] Verifying test files...${NC}"
if grep -q "TranscriptAI" tests/js/push-to-talk/test-phase1-keys.js 2>/dev/null; then
    check "Test files reference 'TranscriptAI'"
else
    echo -e "${RED}✗${NC} Test files not updated"
    ((FAILED++))
fi

# 7. Test Python imports (syntax check)
echo ""
echo -e "${YELLOW}[7] Testing Python syntax...${NC}"
if python3 -m py_compile setup.py 2>/dev/null; then
    check "setup.py syntax valid"
else
    echo -e "${RED}✗${NC} setup.py has syntax errors"
    ((FAILED++))
fi

if python3 -m py_compile tests/python/benchmark_pipeline.py 2>/dev/null; then
    check "benchmark_pipeline.py syntax valid"
else
    echo -e "${RED}✗${NC} benchmark_pipeline.py has syntax errors"
    ((FAILED++))
fi

# 8. Test JSON files are valid
echo ""
echo -e "${YELLOW}[8] Testing JSON validity...${NC}"
if python3 -m json.tool backend/package.json > /dev/null 2>&1; then
    check "backend/package.json is valid JSON"
else
    echo -e "${RED}✗${NC} backend/package.json is invalid JSON"
    ((FAILED++))
fi

if python3 -m json.tool docs/releases/latest.json > /dev/null 2>&1; then
    check "docs/releases/latest.json is valid JSON"
else
    echo -e "${RED}✗${NC} docs/releases/latest.json is invalid JSON"
    ((FAILED++))
fi

# 9. Test YAML files are valid
echo ""
echo -e "${YELLOW}[9] Testing YAML validity...${NC}"
if command -v python3 &> /dev/null && python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" 2>/dev/null; then
    check "docker-compose.yml is valid YAML"
else
    if command -v yamllint &> /dev/null; then
        if yamllint docker-compose.yml > /dev/null 2>&1; then
            check "docker-compose.yml is valid YAML"
        else
            echo -e "${RED}✗${NC} docker-compose.yml is invalid YAML"
            ((FAILED++))
        fi
    else
        echo -e "${YELLOW}⚠${NC} Skipping YAML validation (yamllint not installed)"
    fi
fi

# Summary
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    echo ""
    echo -e "${YELLOW}Next steps for runtime testing:${NC}"
    echo "1. Test backend startup: cd backend && npm run dev"
    echo "2. Test frontend: cd frontend && npm run dev"
    echo "3. Test desktop app: cd desktop && npm run dev"
    echo "4. Check log files use 'transcriptai.log' instead of 'signalhub.log'"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review the errors above.${NC}"
    exit 1
fi

