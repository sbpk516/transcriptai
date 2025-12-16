#!/bin/bash

# ============================================================================
# TranscriptAI Development Mode Test Script
# ============================================================================
# Starts the app in development mode for fast testing WITHOUT building DMG.
# Use this to validate changes quickly (< 1 minute vs 30 minutes for DMG).
#
# Usage:
#   ./scripts/dev-test.sh          # Start backend + frontend
#   ./scripts/dev-test.sh --stop   # Stop all dev servers
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT=8765
FRONTEND_PORT=5173

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Handle --stop flag
if [[ "${1:-}" == "--stop" ]]; then
    log_info "Stopping development servers..."
    
    # Kill backend
    pkill -f "uvicorn.*$BACKEND_PORT" 2>/dev/null && log_success "Backend stopped" || log_warning "Backend not running"
    
    # Kill frontend
    pkill -f "vite.*$FRONTEND_PORT" 2>/dev/null && log_success "Frontend stopped" || log_warning "Frontend not running"
    
    exit 0
fi

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Development Mode${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo ""

# ============================================================================
# Check for existing processes
# ============================================================================
log_info "Checking for existing processes..."

if lsof -i :$BACKEND_PORT >/dev/null 2>&1; then
    log_warning "Port $BACKEND_PORT in use. Stopping existing backend..."
    pkill -f "uvicorn.*$BACKEND_PORT" 2>/dev/null || true
    sleep 1
fi

if lsof -i :$FRONTEND_PORT >/dev/null 2>&1; then
    log_warning "Port $FRONTEND_PORT in use. Stopping existing frontend..."
    pkill -f "vite.*$FRONTEND_PORT" 2>/dev/null || true
    sleep 1
fi

# ============================================================================
# Start Backend
# ============================================================================
log_info "Starting backend on port $BACKEND_PORT..."

cd "$ROOT_DIR"
if [[ -d "venv" ]]; then
    source venv/bin/activate
fi

# Start backend in background
python3 -m uvicorn backend.app.main:app --reload --port $BACKEND_PORT --host 127.0.0.1 > /tmp/transcriptai_backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to be ready
log_info "Waiting for backend to start..."
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
        log_success "Backend started (PID: $BACKEND_PID)"
        break
    fi
    if [[ $i -eq 30 ]]; then
        log_error "Backend failed to start. Check /tmp/transcriptai_backend.log"
        exit 1
    fi
    sleep 1
done

# ============================================================================
# Start Frontend
# ============================================================================
log_info "Starting frontend on port $FRONTEND_PORT..."

cd "$ROOT_DIR/frontend"

# Start frontend in background
npm run dev -- --port $FRONTEND_PORT > /tmp/transcriptai_frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
log_info "Waiting for frontend to start..."
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$FRONTEND_PORT" >/dev/null 2>&1; then
        log_success "Frontend started (PID: $FRONTEND_PID)"
        break
    fi
    if [[ $i -eq 30 ]]; then
        log_error "Frontend failed to start. Check /tmp/transcriptai_frontend.log"
        exit 1
    fi
    sleep 1
done

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Development Mode Running${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Backend:  http://127.0.0.1:$BACKEND_PORT"
echo "  Frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "  API Docs: http://127.0.0.1:$BACKEND_PORT/docs"
echo ""
echo "  Backend logs:  /tmp/transcriptai_backend.log"
echo "  Frontend logs: /tmp/transcriptai_frontend.log"
echo ""
echo "To stop: ./scripts/dev-test.sh --stop"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop watching (servers will keep running)${NC}"
echo ""

# Open browser
if command -v open &> /dev/null; then
    log_info "Opening browser..."
    open "http://127.0.0.1:$FRONTEND_PORT"
fi

# Tail logs
tail -f /tmp/transcriptai_backend.log /tmp/transcriptai_frontend.log


