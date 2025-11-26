#!/bin/bash

# TranscriptAI - Complete Startup Script
# This script clears ports, starts backend, and starts frontend in one command
# Author: TranscriptAI Team
# Version: 1.0

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BACKEND_STARTUP_TIMEOUT=30
FRONTEND_STARTUP_TIMEOUT=30
HEALTH_CHECK_TIMEOUT=10
HEALTH_CHECK_RETRIES=3

# Logging function
log() {
    echo -e "${BLUE}[START-ALL]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -i :$port >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local timeout=$3
    local retries=$4
    
    log "Waiting for $service_name to be ready at $url..."
    
    for i in $(seq 1 $retries); do
        if curl -s --max-time $timeout "$url" >/dev/null 2>&1; then
            success "$service_name is ready!"
            return 0
        fi
        
        if [ $i -lt $retries ]; then
            log "Attempt $i/$retries failed, retrying in 2 seconds..."
            sleep 2
        fi
    done
    
    error "$service_name failed to start within timeout"
    return 1
}

# Function to start backend with timeout
start_backend() {
    log "Starting backend server..."
    
    # Check if backend port is already in use
    if check_port 8001; then
        warning "Port 8001 is already in use, clearing it first..."
        pkill -f "uvicorn.*8001" || true
        sleep 2
    fi
    
    # Start backend in background
    cd backend
    source ../venv/bin/activate
    TRANSCRIPTAI_ENABLE_TRANSCRIPTION=1 \
    TRANSCRIPTAI_LIVE_TRANSCRIPTION=1 \
    TRANSCRIPTAI_LIVE_MIC=1 \
    TRANSCRIPTAI_LIVE_BATCH_ONLY=1 \
    python start.py &
    local backend_pid=$!
    cd ..
    
    # Store PID for cleanup
    echo $backend_pid > /tmp/transcriptai_backend.pid
    
    # Wait for backend to be ready
    if wait_for_service "http://127.0.0.1:8001/health" "Backend" $HEALTH_CHECK_TIMEOUT $HEALTH_CHECK_RETRIES; then
        success "Backend started successfully on port 8001"
        return 0
    else
        error "Backend failed to start"
        kill $backend_pid 2>/dev/null || true
        return 1
    fi
}

# Function to start frontend with timeout
start_frontend() {
    log "Starting frontend server..."
    
    # Check if frontend port is already in use
    if check_port 3000; then
        warning "Port 3000 is already in use, clearing it first..."
        pkill -f "vite.*3000" || true
        pkill -f "npm.*dev" || true
        sleep 2
    fi
    
    # Start frontend in background
    cd frontend
    npm run dev &
    local frontend_pid=$!
    cd ..
    
    # Store PID for cleanup
    echo $frontend_pid > /tmp/transcriptai_frontend.pid
    
    # Wait for frontend to be ready
    if wait_for_service "http://localhost:3000" "Frontend" $HEALTH_CHECK_TIMEOUT $HEALTH_CHECK_RETRIES; then
        success "Frontend started successfully on port 3000"
        return 0
    else
        error "Frontend failed to start"
        kill $frontend_pid 2>/dev/null || true
        return 1
    fi
}

# Function to cleanup on exit
cleanup() {
    log "Cleaning up processes..."
    
    # Kill backend if PID file exists
    if [ -f /tmp/transcriptai_backend.pid ]; then
        local backend_pid=$(cat /tmp/transcriptai_backend.pid)
        kill $backend_pid 2>/dev/null || true
        rm -f /tmp/transcriptai_backend.pid
    fi
    
    # Kill frontend if PID file exists
    if [ -f /tmp/transcriptai_frontend.pid ]; then
        local frontend_pid=$(cat /tmp/transcriptai_frontend.pid)
        kill $frontend_pid 2>/dev/null || true
        rm -f /tmp/transcriptai_frontend.pid
    fi
    
    # Kill any remaining processes
    pkill -f "uvicorn.*8001" || true
    pkill -f "vite.*3000" || true
    pkill -f "npm.*dev" || true
}

# Set up signal handlers for cleanup
trap cleanup EXIT INT TERM

# Main execution
main() {
    echo -e "${PURPLE}========================================${NC}"
    echo -e "${PURPLE}    TranscriptAI Complete Startup Script   ${NC}"
    echo -e "${PURPLE}========================================${NC}"
    echo
    
    # Phase 1: Clear all ports
    log "Phase 1: Clearing all ports..."
    if [ -f "scripts/clear-ports.sh" ]; then
        bash scripts/clear-ports.sh
    else
        warning "clear-ports.sh not found, manually clearing ports..."
        pkill -f "uvicorn" || true
        pkill -f "vite" || true
        pkill -f "npm.*dev" || true
        sleep 2
    fi
    success "Ports cleared successfully"
    echo
    
    # Phase 2: Start backend
    log "Phase 2: Starting backend server..."
    if ! start_backend; then
        error "Failed to start backend. Exiting."
        exit 1
    fi
    echo
    
    # Phase 3: Start frontend
    log "Phase 3: Starting frontend server..."
    if ! start_frontend; then
        error "Failed to start frontend. Exiting."
        exit 1
    fi
    echo
    
    # Phase 4: Final status
    log "Phase 4: Final status check..."
    echo
    success "🎉 TranscriptAI is now running!"
    echo
    info "📊 Backend:  http://127.0.0.1:8001"
    info "📊 Frontend: http://localhost:3000"
    info "📊 Health:   http://127.0.0.1:8001/health"
    echo
    info "💡 To stop all services, press Ctrl+C"
    info "💡 To view logs, check the terminal output above"
    echo
    
    # Keep script running to maintain processes
    log "Services are running. Press Ctrl+C to stop all services..."
    
    # Wait for user interrupt
    while true; do
        sleep 1
        
        # Check if processes are still running
        if [ -f /tmp/transcriptai_backend.pid ]; then
            local backend_pid=$(cat /tmp/transcriptai_backend.pid)
            if ! kill -0 $backend_pid 2>/dev/null; then
                error "Backend process died unexpectedly"
                break
            fi
        fi
        
        if [ -f /tmp/transcriptai_frontend.pid ]; then
            local frontend_pid=$(cat /tmp/transcriptai_frontend.pid)
            if ! kill -0 $frontend_pid 2>/dev/null; then
                error "Frontend process died unexpectedly"
                break
            fi
        fi
    done
}

# Check if we're in the right directory
if [ ! -f "config.js" ]; then
    error "config.js not found. Please run this script from the TranscriptAI root directory."
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    error "Virtual environment not found. Please run setup first."
    exit 1
fi

# Check if frontend dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    error "Frontend dependencies not installed. Please run 'cd frontend && npm install' first."
    exit 1
fi

# Run main function
main "$@"
