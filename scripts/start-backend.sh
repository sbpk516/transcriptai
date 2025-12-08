#!/usr/bin/env bash
# Start backend server using centralized configuration

set -euo pipefail

# Get the root directory
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load configuration
if [ -f "$ROOT_DIR/config/ports.env" ]; then
    # shellcheck disable=SC1090
    source "$ROOT_DIR/config/ports.env"
fi

# Set defaults if not provided
BACKEND_PORT="${BACKEND_PORT:-8001}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"

echo "Starting backend server..."
echo "  Host: $BACKEND_HOST"
echo "  Port: $BACKEND_PORT"
echo "  Health URL: http://$BACKEND_HOST:$BACKEND_PORT/health"

# Activate virtual environment and start backend
cd "$ROOT_DIR"
source venv/bin/activate
cd backend

# Set environment variables for web mode features
export TRANSCRIPTAI_ENABLE_TRANSCRIPTION=1
export TRANSCRIPTAI_LIVE_MIC=1
export TRANSCRIPTAI_LIVE_TRANSCRIPTION=1
export TRANSCRIPTAI_LIVE_BATCH_ONLY=1

# Start backend with configured port
uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload
