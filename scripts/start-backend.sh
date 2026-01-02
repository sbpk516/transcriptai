#!/usr/bin/env bash
# Deprecated: use scripts/start-backend-shared.sh instead.
# Set RUN_DEPRECATED_START_BACKEND=1 to run this script anyway.
if [[ "${RUN_DEPRECATED_START_BACKEND:-0}" != "1" ]]; then
  echo "Deprecated: use scripts/start-backend-shared.sh"
  exit 1
fi

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
export BACKEND_PORT
export BACKEND_HOST

echo "Starting backend server..."
echo "  Host: $BACKEND_HOST"
echo "  Port: $BACKEND_PORT"
echo "  Health URL: http://$BACKEND_HOST:$BACKEND_PORT/health"

# Activate virtual environment and start backend
cd "$ROOT_DIR"
source venv/bin/activate

# Default to desktop-style data dir for parity.
export TRANSCRIPTAI_MODE="${TRANSCRIPTAI_MODE:-desktop}"
export TRANSCRIPTAI_DATA_DIR="${TRANSCRIPTAI_DATA_DIR:-$HOME/Library/Application Support/transcriptai-desktop}"

# Use whisper.cpp model in repo for web/dev.
export WHISPER_CPP_MODEL="${WHISPER_CPP_MODEL:-$ROOT_DIR/backend-cpp/models/ggml-base.en.bin}"

# Set environment variables for web mode features
export TRANSCRIPTAI_ENABLE_TRANSCRIPTION=1
export TRANSCRIPTAI_LIVE_MIC=1
export TRANSCRIPTAI_LIVE_TRANSCRIPTION=1
export TRANSCRIPTAI_LIVE_BATCH_ONLY=1

# Start whisper-server + backend using shared launcher
"$ROOT_DIR/scripts/start-backend-shared.sh"
