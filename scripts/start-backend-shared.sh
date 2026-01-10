#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Default to desktop-style data dir + sqlite unless caller overrides.
export TRANSCRIPTAI_MODE="${TRANSCRIPTAI_MODE:-desktop}"
export TRANSCRIPTAI_DATA_DIR="${TRANSCRIPTAI_DATA_DIR:-$HOME/Library/Application Support/transcriptai-desktop}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///$ROOT_DIR/transcriptai-dev.db}"
export TRANSCRIPTAI_LIVE_MIC="${TRANSCRIPTAI_LIVE_MIC:-1}"
export TRANSCRIPTAI_LIVE_TRANSCRIPTION="${TRANSCRIPTAI_LIVE_TRANSCRIPTION:-1}"
export TRANSCRIPTAI_LIVE_BATCH_ONLY="${TRANSCRIPTAI_LIVE_BATCH_ONLY:-0}"

# Resolve whisper-server + model for web/dev runs.
WHISPER_SERVER_PATH="${WHISPER_SERVER_PATH:-$ROOT_DIR/backend-cpp/whisper-server}"
WHISPER_CPP_MODEL="${WHISPER_CPP_MODEL:-$ROOT_DIR/backend-cpp/models/ggml-base.en.bin}"

# Dynamic port allocation with file-based communication for production desktop app
# This ensures port availability even when port 8002+ is already in use
if [[ -z "${WHISPER_CPP_PORT:-}" ]]; then
  # Try ports 8002-8020, find first available
  for port in {8002..8020}; do
    if ! lsof -i :$port >/dev/null 2>&1; then
      WHISPER_CPP_PORT=$port
      break
    fi
  done
  
  # Fallback to truly random port if all in range are taken
  if [[ -z "${WHISPER_CPP_PORT:-}" ]]; then
    WHISPER_CPP_PORT="$(python3 - <<'PY'
import socket
s=socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
  fi
fi

# Write port to file so backend can discover it
# Create data dir if it doesn't exist
if [[ -n "${TRANSCRIPTAI_DATA_DIR:-}" ]]; then
  mkdir -p "$TRANSCRIPTAI_DATA_DIR"
  PORT_FILE="$TRANSCRIPTAI_DATA_DIR/transcriptai_whisper_port"
else
  PORT_FILE="/tmp/transcriptai_whisper_port"
fi

echo "$WHISPER_CPP_PORT" > "$PORT_FILE"
chmod 644 "$PORT_FILE" 2>/dev/null || true  # Readable by all users (ignore errors)

echo "Port file created: $PORT_FILE with port $WHISPER_CPP_PORT"

export WHISPER_CPP_PORT
export WHISPER_CPP_MODEL

if [[ ! -x "$WHISPER_SERVER_PATH" ]]; then
  echo "Missing whisper-server: $WHISPER_SERVER_PATH" >&2
  exit 1
fi
if [[ ! -f "$WHISPER_CPP_MODEL" ]]; then
  echo "Missing whisper.cpp model: $WHISPER_CPP_MODEL" >&2
  exit 1
fi

echo "Starting whisper-server..."
echo "  Model: $WHISPER_CPP_MODEL"
echo "  Port: $WHISPER_CPP_PORT"

# Build whisper-server arguments
WHISPER_ARGS=("-m" "$WHISPER_CPP_MODEL" "--port" "$WHISPER_CPP_PORT")

# Add VAD flags if enabled (default) and model exists
VAD_MODEL_PATH="${VAD_MODEL_PATH:-$ROOT_DIR/backend-cpp/models/silero-vad.bin}"
VAD_ENABLED="${TRANSCRIPTAI_VAD_ENABLED:-1}"  # Enabled by default
if [[ "$VAD_ENABLED" != "0" ]] && [[ -f "$VAD_MODEL_PATH" ]]; then
  WHISPER_ARGS+=("--vad" "--vad-model" "$VAD_MODEL_PATH")
  WHISPER_ARGS+=("--vad-threshold" "${TRANSCRIPTAI_VAD_THRESHOLD:-0.5}")
  echo "  VAD: enabled (model: $VAD_MODEL_PATH)"
elif [[ "$VAD_ENABLED" != "0" ]]; then
  echo "  VAD: enabled but model not found at $VAD_MODEL_PATH"
else
  echo "  VAD: disabled"
fi

"$WHISPER_SERVER_PATH" "${WHISPER_ARGS[@]}" &
WHISPER_PID=$!

cleanup() {
  if kill -0 "$WHISPER_PID" >/dev/null 2>&1; then
    kill "$WHISPER_PID" || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR/backend"
uvicorn app.main:app --host "${BACKEND_HOST:-127.0.0.1}" --port "${BACKEND_PORT:-8001}" --reload
