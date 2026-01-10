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
HEALTH_CHECK_RETRIES=30
FRONTEND_HEALTH_CHECK_TIMEOUT=15
FRONTEND_HEALTH_CHECK_RETRIES=20

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

# Helper function to get milliseconds since epoch (works on macOS and Linux)
get_ms() {
    # Use Python for cross-platform millisecond precision
    python3 -c "import time; print(int(time.time() * 1000))" 2>/dev/null || echo $(($(date +%s) * 1000))
}

# Function to start backend with timeout
start_backend() {
    local backend_start_time=$(get_ms)
    log "Starting backend server..."
    echo "[WEB_STARTUP] phase=backend_start_script timestamp=$(date -u +%Y-%m-%dT%H:%M:%S)"
    
    # Check if backend port is already in use
    if check_port 8001; then
        warning "Port 8001 is already in use, clearing it first..."
        pkill -f "uvicorn.*8001" || true
        sleep 2
    fi
    
    # Start backend in background
    local spawn_start_time=$(get_ms)
    cd backend
    source ../venv/bin/activate
    
    # Create data directory if it doesn't exist
    mkdir -p "$HOME/Library/Application Support/TranscriptAI"
    
    # Set environment variables for web mode (use SQLite)
    export DATABASE_URL="sqlite:///$HOME/Library/Application Support/TranscriptAI/transcriptai.db"
    export TRANSCRIPTAI_ENABLE_TRANSCRIPTION=1
    export TRANSCRIPTAI_LIVE_TRANSCRIPTION=1
    export TRANSCRIPTAI_LIVE_MIC=1
    export TRANSCRIPTAI_LIVE_BATCH_ONLY=1
    
    
    # --- PHASE 3: Spawn C++ Servers ---
    # We must start them here so the Python backend knows where to find them
    # and because Electron isn't here to start them.
    
    # 1. Whisper Server (with model that exists)
    log "Starting C++ Whisper Server..."

    # Build whisper-server arguments
    WHISPER_ARGS=("-m" "../backend-cpp/models/ggml-base.en.bin" "--port" "8091")

    # Add VAD flags if enabled (default) and model exists
    VAD_MODEL_PATH="../backend-cpp/models/silero-vad.bin"
    VAD_ENABLED="${TRANSCRIPTAI_VAD_ENABLED:-1}"  # Enabled by default
    if [[ "$VAD_ENABLED" != "0" ]] && [[ -f "$VAD_MODEL_PATH" ]]; then
      WHISPER_ARGS+=("--vad" "--vad-model" "$VAD_MODEL_PATH")
      WHISPER_ARGS+=("--vad-threshold" "${TRANSCRIPTAI_VAD_THRESHOLD:-0.5}")
      log "VAD enabled (model: $VAD_MODEL_PATH)"
    elif [[ "$VAD_ENABLED" != "0" ]]; then
      log "VAD enabled but model not found at $VAD_MODEL_PATH"
    fi

    ../backend-cpp/whisper-server "${WHISPER_ARGS[@]}" > /tmp/whisper_server.log 2>&1 &
    WHISPER_PID=$!
    echo $WHISPER_PID > /tmp/transcriptai_whisper.pid
    export WHISPER_CPP_PORT=8091
    

    
    python start.py &
    local backend_pid=$!
    cd ..
    local spawn_elapsed=$(($(get_ms) - spawn_start_time))
    echo "[WEB_STARTUP] phase=backend_process_spawned elapsed=${spawn_elapsed}ms pid=$backend_pid"
    
    # Store PID for cleanup
    echo $backend_pid > /tmp/transcriptai_backend.pid
    
    # Wait for backend to be ready
    local health_check_start_time=$(get_ms)
    if wait_for_service "http://127.0.0.1:8001/health" "Backend" $HEALTH_CHECK_TIMEOUT $HEALTH_CHECK_RETRIES; then
        local health_check_end_time=$(get_ms)
        local backend_end_time=$(get_ms)
        local health_check_elapsed=$((health_check_end_time - health_check_start_time))
        local total_backend_elapsed=$((backend_end_time - backend_start_time))
        echo "[WEB_STARTUP] phase=backend_health_check_complete elapsed=${health_check_elapsed}ms"
        echo "[WEB_STARTUP] phase=backend_ready total_elapsed=${total_backend_elapsed}ms"
        success "Backend started successfully on port 8001"
        return 0
    else
        local backend_end_time=$(get_ms)
        local total_backend_elapsed=$((backend_end_time - backend_start_time))
        echo "[WEB_STARTUP] phase=backend_start_failed total_elapsed=${total_backend_elapsed}ms"
        error "Backend failed to start"
        kill $backend_pid 2>/dev/null || true
        return 1
    fi
    
    # Export ports for the backend to likely pick up if we modify config? 
    # Actually backend uses env vars for ports usually or hardcoded?
    # backend/app/whisper_processor.py uses os.getenv("WHISPER_CPP_PORT")
    # desktop/src/main.js passes them. 
    # For web mode, we need to export them here so `start.py` (which runs uvicorn) picks them up?
    # NO, start.py runs uvicorn in a subprocess or directly?
    # start_backend function runs `python start.py`.
    # So we need to export BEFORE running start.py in this function.
    # Moving this block UP before `python start.py`

}

# Function to start frontend with timeout
start_frontend() {
    local frontend_start_time=$(get_ms)
    log "Starting frontend server..."
    echo "[WEB_STARTUP] phase=frontend_start_script timestamp=$(date -u +%Y-%m-%dT%H:%M:%S)"
    
    # Check if frontend port is already in use
    if check_port 3000; then
        warning "Port 3000 is already in use, clearing it first..."
        pkill -f "vite.*3000" || true
        pkill -f "npm.*dev" || true
        sleep 2
    fi
    
    # Start frontend in background
    local spawn_start_time=$(get_ms)
    cd frontend
    # Start npm in background and redirect output to avoid blocking
    npm run dev > /tmp/vite.log 2>&1 &
    local frontend_pid=$!
    cd ..
    local spawn_elapsed=$(($(get_ms) - spawn_start_time))
    echo "[WEB_STARTUP] phase=frontend_process_spawned elapsed=${spawn_elapsed}ms pid=$frontend_pid"
    
    # Store PID for cleanup (store both npm and vite PIDs)
    echo $frontend_pid > /tmp/transcriptai_frontend.pid
    # Give vite a moment to start
    sleep 1
    
    # Wait for frontend to be ready (frontend takes longer to start)
    local health_check_start_time=$(get_ms)
    if wait_for_service "http://localhost:3000" "Frontend" $FRONTEND_HEALTH_CHECK_TIMEOUT $FRONTEND_HEALTH_CHECK_RETRIES; then
        local health_check_end_time=$(get_ms)
        local frontend_end_time=$(get_ms)
        local health_check_elapsed=$((health_check_end_time - health_check_start_time))
        local total_frontend_elapsed=$((frontend_end_time - frontend_start_time))
        echo "[WEB_STARTUP] phase=frontend_health_check_complete elapsed=${health_check_elapsed}ms"
        echo "[WEB_STARTUP] phase=frontend_ready total_elapsed=${total_frontend_elapsed}ms"
        success "Frontend started successfully on port 3000"
        return 0
    else
        local frontend_end_time=$(get_ms)
        local total_frontend_elapsed=$((frontend_end_time - frontend_start_time))
        echo "[WEB_STARTUP] phase=frontend_start_failed total_elapsed=${total_frontend_elapsed}ms"
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
    pkill -f "npm.*dev" || true
    
    if [ -f /tmp/transcriptai_whisper.pid ]; then
        kill $(cat /tmp/transcriptai_whisper.pid) 2>/dev/null || true
        rm /tmp/transcriptai_whisper.pid
    fi
     if [ -f /tmp/transcriptai_llama.pid ]; then
        kill $(cat /tmp/transcriptai_llama.pid) 2>/dev/null || true
        rm /tmp/transcriptai_llama.pid
    fi
}

# Set up signal handlers for cleanup
trap cleanup EXIT INT TERM

# Main execution
main() {
    local script_start_time=$(get_ms)
    local script_start_timestamp=$(date -u +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)
    echo "[WEB_STARTUP] phase=script_start timestamp=$script_start_timestamp"
    
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
    local script_end_time=$(get_ms)
    # Safety check: ensure both values are integers
    if [[ "$script_start_time" =~ ^[0-9]+$ ]] && [[ "$script_end_time" =~ ^[0-9]+$ ]]; then
        local script_total_elapsed=$((script_end_time - script_start_time))
        echo "[WEB_STARTUP] phase=script_complete total_elapsed=${script_total_elapsed}ms"
    else
        echo "[WEB_STARTUP] phase=script_complete total_elapsed=unknown"
    fi
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
