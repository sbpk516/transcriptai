#!/usr/bin/env bash
# Activate Python environment (virtualenv or conda)
if [ -f "$(dirname "$0")/../.venv/bin/activate" ]; then
    source "$(dirname "$0")/../.venv/bin/activate"
elif command -v conda >/dev/null 2>&1; then
    source "$(conda info --base)/etc/profile.d/conda.sh"
    conda activate transcriptai
fi

# TranscriptAI Port Cleanup Script
# This script clears all ports and processes related to TranscriptAI frontend and backend

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[CLEAR-PORTS]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log "Starting TranscriptAI port cleanup..."

# Function to kill processes by pattern
kill_processes() {
    local pattern="$1"
    local description="$2"
    local force="$3"
    
    log "Stopping $description..."
    
    if [ "$force" = "true" ]; then
        pkill -9 -f "$pattern" >/dev/null 2>&1 || true
    else
        pkill -f "$pattern" >/dev/null 2>&1 || true
    fi
}

# Function to check if processes are still running
check_remaining_processes() {
    local remaining_processes
    remaining_processes=$(ps aux | grep -E "(uvicorn|npm.*dev|vite.*port|node.*dev|python.*app.main)" | grep -v grep | wc -l)
    echo "$remaining_processes"
}

# Function to kill processes on specific ports
kill_port_processes() {
    local port="$1"
    local description="$2"
    
    log "Checking port $port for $description..."
    
    # Get PIDs using the port
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    
    if [ -n "$pids" ]; then
        log "Found processes on port $port: $pids"
        echo "$pids" | xargs kill -9 >/dev/null 2>&1 || true
        success "Killed processes on port $port"
    else
        log "No processes found on port $port"
    fi
}

# Main cleanup process
main() {
    log "Phase 1: Killing processes by pattern..."
    
    # Kill backend processes
    kill_processes "uvicorn app.main:app" "backend uvicorn processes" "false"
    kill_processes "python.*app.main" "Python app processes" "false"
    
    # Kill frontend processes
    kill_processes "npm run dev" "npm dev processes" "false"
    kill_processes "vite.*--port" "Vite dev server processes" "false"
    kill_processes "node.*dev" "Node.js dev processes" "false"
    
    # Wait for graceful shutdown
    log "Waiting for graceful shutdown..."
    sleep 3
    
    # Check for remaining processes
    local remaining
    remaining=$(check_remaining_processes)
    
    if [ "$remaining" -gt 0 ]; then
        warning "$remaining processes still running, forcing cleanup..."
        
        # Force kill remaining processes
        kill_processes "uvicorn app.main:app" "backend uvicorn processes" "true"
        kill_processes "npm run dev" "npm dev processes" "true"
        kill_processes "vite.*--port" "Vite dev server processes" "true"
        kill_processes "node.*dev" "Node.js dev processes" "true"
        kill_processes "python.*app.main" "Python app processes" "true"
        
        sleep 2
    fi
    
    log "Phase 2: Clearing specific ports..."
    
    # Clear common TranscriptAI ports (respect VPN usage on 8000 — do NOT clear 8000)
    kill_port_processes "8010" "legacy backend port"
    kill_port_processes "8001" "backend port"
    kill_port_processes "8002" "secondary backend port"
    kill_port_processes "8003" "secondary backend port"
    kill_port_processes "3001" "frontend port"
    kill_port_processes "3000" "alternative frontend port"
    
    # Clear any other common dev ports that might be used (include Vite default 5173)
    for port in 3002 3003 3100 3101 3102 5173 5174 5175 8011 8012 8013 8014 8015; do
        kill_port_processes "$port" "dev port $port"
    done
    
    log "Phase 3: Final verification..."
    
    # Final check
    remaining=$(check_remaining_processes)
    
    if [ "$remaining" -eq 0 ]; then
        success "All TranscriptAI processes cleared successfully!"
    else
        warning "$remaining processes still running:"
        ps aux | grep -E "(uvicorn|npm.*dev|vite.*port|node.*dev|python.*app.main)" | grep -v grep || true
    fi
    
    # Check specific ports (do NOT check 8000 as it's reserved for VPN)
    log "Checking common ports..."
    for port in 8010 8001 3001 3000 5173; do
        if lsof -i :"$port" >/dev/null 2>&1; then
            warning "Port $port is still in use:"
            lsof -i :"$port" || true
        else
            success "Port $port is free"
        fi
    done
    
    log "Cleanup completed!"
}

# Run main function
main "$@"
