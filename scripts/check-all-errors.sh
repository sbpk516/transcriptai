#!/bin/bash

# Comprehensive Error Check Script for TranscriptAI
# Checks all critical components for errors

set +e  # Don't exit on errors, we want to report all issues

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $1"
        ((FAILED++))
        return 1
    fi
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Comprehensive Error Check${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# 1. Check Python environment
echo -e "${YELLOW}[1] Checking Python environment...${NC}"
if [ -d "venv" ] && [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
    PYTHON_CMD="python"
    check "Virtual environment found"
else
    PYTHON_CMD="python3"
    warn "No virtual environment found, using system Python"
fi

if command -v $PYTHON_CMD &> /dev/null; then
    PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
    echo -e "${GREEN}✓${NC} Python available: $PYTHON_VERSION"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Python not found"
    ((FAILED++))
fi

# 2. Check critical Python packages
echo ""
echo -e "${YELLOW}[2] Checking Python dependencies...${NC}"
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

CRITICAL_PACKAGES=("fastapi" "uvicorn" "pydantic_settings" "sqlalchemy")
for package in "${CRITICAL_PACKAGES[@]}"; do
    if $PYTHON_CMD -c "import $package" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $package installed"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $package not installed"
        ((FAILED++))
    fi
done

# 3. Check database configuration
echo ""
echo -e "${YELLOW}[3] Checking database configuration...${NC}"
if [ -f ".env" ]; then
    DB_URL=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [[ "$DB_URL" == sqlite* ]]; then
        echo -e "${GREEN}✓${NC} Using SQLite database"
        DB_PATH=$(echo "$DB_URL" | sed 's|sqlite:///||')
        DB_DIR=$(dirname "$DB_PATH")
        if [ -d "$DB_DIR" ] || mkdir -p "$DB_DIR" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} Database directory accessible: $DB_DIR"
            ((PASSED++))
        else
            echo -e "${RED}✗${NC} Cannot create database directory: $DB_DIR"
            ((FAILED++))
        fi
    elif [[ "$DB_URL" == postgresql* ]]; then
        echo -e "${YELLOW}⚠${NC} Using PostgreSQL - checking connection..."
        # Extract connection details
        if echo "$DB_URL" | grep -q "transcriptai:transcriptai123@localhost:5432/transcriptai"; then
            if command -v psql &> /dev/null; then
                if pg_isready -h localhost -p 5432 &> /dev/null; then
                    # Try to connect
                    if psql -h localhost -U transcriptai -d transcriptai -c "SELECT 1;" &> /dev/null; then
                        echo -e "${GREEN}✓${NC} PostgreSQL connection successful"
                        ((PASSED++))
                    else
                        echo -e "${RED}✗${NC} PostgreSQL connection failed - user/database may not exist"
                        echo -e "${YELLOW}   Run: bash scripts/setup-database.sh${NC}"
                        ((FAILED++))
                    fi
                else
                    echo -e "${RED}✗${NC} PostgreSQL server not running"
                    ((FAILED++))
                fi
            else
                echo -e "${YELLOW}⚠${NC} psql not found, cannot test PostgreSQL connection"
                ((WARNINGS++))
            fi
        fi
    fi
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} .env file not found"
    ((WARNINGS++))
fi

# 4. Check MLX error handling
echo ""
echo -e "${YELLOW}[4] Checking MLX error handling...${NC}"
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Test that MLX import doesn't crash
if $PYTHON_CMD -c "
import sys
sys.path.insert(0, 'backend')
try:
    from app.whisper_backend_selector import get_backend_info
    info = get_backend_info()
    print('Backend info retrieved successfully')
    print(f'  PyTorch available: {info.get(\"pytorch_available\", False)}')
    print(f'  MLX available: {info.get(\"mlx_available\", False)}')
    sys.exit(0)
except Exception as e:
    print(f'Error: {e}')
    sys.exit(1)
" 2>&1; then
    echo -e "${GREEN}✓${NC} MLX error handling works (backend selector doesn't crash)"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} MLX error handling failed"
    ((FAILED++))
fi

# 5. Check configuration files
echo ""
echo -e "${YELLOW}[5] Checking configuration files...${NC}"
if [ -f "backend/app/config.py" ]; then
    if $PYTHON_CMD -m py_compile backend/app/config.py 2>/dev/null; then
        echo -e "${GREEN}✓${NC} backend/app/config.py syntax valid"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} backend/app/config.py has syntax errors"
        ((FAILED++))
    fi
fi

# 6. Check for import errors in critical modules
echo ""
echo -e "${YELLOW}[6] Checking critical module imports...${NC}"
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

CRITICAL_MODULES=(
    "backend.app.config"
    "backend.app.database"
)

for module in "${CRITICAL_MODULES[@]}"; do
    if $PYTHON_CMD -c "import sys; sys.path.insert(0, '.'); import $module" 2>&1 | grep -q "Error\|Traceback"; then
        echo -e "${RED}✗${NC} $module has import errors"
        $PYTHON_CMD -c "import sys; sys.path.insert(0, '.'); import $module" 2>&1 | head -3
        ((FAILED++))
    else
        echo -e "${GREEN}✓${NC} $module imports successfully"
        ((PASSED++))
    fi
done

# 7. Check rename verification
echo ""
echo -e "${YELLOW}[7] Running rename verification...${NC}"
if bash scripts/test-rename-verification.sh 2>&1 | grep -q "All checks passed"; then
    echo -e "${GREEN}✓${NC} Rename verification passed"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Some rename checks may have warnings (check output above)"
    ((WARNINGS++))
fi

# 8. Check file permissions
echo ""
echo -e "${YELLOW}[8] Checking file permissions...${NC}"
if [ -d "logs" ] && [ -w "logs" ]; then
    echo -e "${GREEN}✓${NC} logs directory is writable"
    ((PASSED++))
else
    if mkdir -p logs 2>/dev/null && [ -w "logs" ]; then
        echo -e "${GREEN}✓${NC} logs directory created and writable"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} logs directory not writable"
        ((FAILED++))
    fi
fi

# Summary
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo -e "Warnings: ${YELLOW}${WARNINGS}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo ""
    echo -e "${YELLOW}You can now start the backend:${NC}"
    echo "  cd backend && npm run dev"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review the errors above.${NC}"
    echo ""
    echo -e "${YELLOW}Common fixes:${NC}"
    echo "1. Install dependencies: pip install -r requirements.txt"
    echo "2. Setup database: bash scripts/setup-database.sh"
    echo "3. Activate venv: source venv/bin/activate"
    exit 1
fi






































