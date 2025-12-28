#!/bin/bash
# Diagnostic script for backend connection issues
# Checks running processes, port availability, logs, and tests health endpoint

set -e

echo "=========================================="
echo "TranscriptAI Backend Connection Diagnostic"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for running backend processes
echo "1. Checking for running backend processes..."
echo "-------------------------------------------"
BACKEND_PROCS=$(ps aux | grep -E "(uvicorn|python.*backend|transcriptai-backend)" | grep -v grep || true)
if [ -z "$BACKEND_PROCS" ]; then
    echo -e "${GREEN}✓ No backend processes found${NC}"
else
    echo -e "${YELLOW}⚠ Found backend processes:${NC}"
    echo "$BACKEND_PROCS"
fi
echo ""

# Check port availability
echo "2. Checking port availability (8001, 8011, 8021)..."
echo "-------------------------------------------"
for port in 8001 8011 8021; do
    if lsof -i :$port >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Port $port is in use:${NC}"
        lsof -i :$port | head -5
    else
        echo -e "${GREEN}✓ Port $port is available${NC}"
    fi
done
echo ""

# Check for processes listening on these ports
echo "3. Checking for processes listening on backend ports..."
echo "-------------------------------------------"
LISTENING=$(lsof -i :8001 -i :8011 -i :8021 2>/dev/null || true)
if [ -z "$LISTENING" ]; then
    echo -e "${GREEN}✓ No processes listening on backend ports${NC}"
else
    echo -e "${YELLOW}⚠ Processes listening on backend ports:${NC}"
    echo "$LISTENING"
fi
echo ""

# Check desktop data directory and logs
echo "4. Checking desktop data directory and logs..."
echo "-------------------------------------------"
DATA_DIR="$HOME/Library/Application Support/TranscriptAI"
if [ -d "$DATA_DIR" ]; then
    echo -e "${GREEN}✓ Data directory exists: $DATA_DIR${NC}"
    
    if [ -d "$DATA_DIR/logs" ]; then
        echo -e "${GREEN}✓ Logs directory exists${NC}"
        echo "Recent log files:"
        ls -lt "$DATA_DIR/logs" | head -10 || echo "  (no log files found)"
        
        # Check for error files
        echo ""
        echo "Error files:"
        find "$DATA_DIR/logs" -name "*error*" -o -name "*backend*" 2>/dev/null | head -5 || echo "  (no error files found)"
    else
        echo -e "${YELLOW}⚠ Logs directory does not exist${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Data directory does not exist: $DATA_DIR${NC}"
fi
echo ""

# Test health endpoints
echo "5. Testing health endpoints..."
echo "-------------------------------------------"
for port in 8001 8011 8021; do
    echo -n "Testing http://127.0.0.1:$port/health ... "
    if curl -s -f -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Responding${NC}"
        curl -s "http://127.0.0.1:$port/health" | head -3
    else
        echo -e "${RED}✗ Not responding${NC}"
    fi
done
echo ""

# Check Electron app logs (if running)
echo "6. Checking for Electron app processes..."
echo "-------------------------------------------"
ELECTRON_PROCS=$(ps aux | grep -i electron | grep -v grep || true)
if [ -z "$ELECTRON_PROCS" ]; then
    echo -e "${YELLOW}⚠ No Electron processes found${NC}"
else
    echo -e "${GREEN}✓ Electron processes found:${NC}"
    echo "$ELECTRON_PROCS"
fi
echo ""

# Check Python environment
echo "7. Checking Python environment..."
echo "-------------------------------------------"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}✓ Python found: $PYTHON_VERSION${NC}"
    
    # Check for critical dependencies
    echo "Checking critical dependencies:"
    for dep in pydantic_settings uvicorn fastapi; do
        if python3 -c "import $dep" 2>/dev/null; then
            echo -e "  ${GREEN}✓ $dep${NC}"
        else
            echo -e "  ${RED}✗ $dep (missing)${NC}"
        fi
    done
else
    echo -e "${RED}✗ Python3 not found${NC}"
fi
echo ""

# Check MLX venv
echo "8. Checking MLX virtual environment..."
echo "-------------------------------------------"
MLX_VENV="../venv_mlx"
if [ -d "$MLX_VENV" ]; then
    echo -e "${GREEN}✓ MLX venv directory exists${NC}"
    if [ -f "$MLX_VENV/bin/python" ]; then
        MLX_PYTHON_VERSION=$("$MLX_VENV/bin/python" --version 2>&1 || echo "unknown")
        echo "  Python version: $MLX_PYTHON_VERSION"
    fi
else
    echo -e "${YELLOW}⚠ MLX venv directory not found: $MLX_VENV${NC}"
fi
echo ""

# Summary and recommendations
echo "=========================================="
echo "Summary and Recommendations"
echo "=========================================="
echo ""

# Check if port 8001 is blocked
if lsof -i :8001 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port 8001 is in use. This may cause Electron to use port 8011.${NC}"
    echo "  Recommendation: Kill the process using port 8001 if it's not needed"
    echo "  Command: lsof -ti :8001 | xargs kill -9"
    echo ""
fi

# Check if backend is running
if ! curl -s -f -m 2 "http://127.0.0.1:8001/health" >/dev/null 2>&1 && \
   ! curl -s -f -m 2 "http://127.0.0.1:8011/health" >/dev/null 2>&1 && \
   ! curl -s -f -m 2 "http://127.0.0.1:8021/health" >/dev/null 2>&1; then
    echo -e "${RED}✗ No backend is responding on any port${NC}"
    echo "  Recommendation: Start the backend manually to see error messages"
    echo "  Command: cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8001"
    echo ""
fi

echo "Diagnostic complete!"





































