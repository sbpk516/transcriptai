#!/usr/bin/env bash
set -euo pipefail

echo "[prepack] Running sanity checks..."

# Resolve repo root (script is expected to be called from desktop/ via npm)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "[prepack][ERROR] $1" >&2; exit 1; }
warn() { echo "[prepack][WARN]  $1"; }
ok() { echo "[prepack][OK]    $1"; }

# 0) Backend Python syntax check (fast fail)
bash "$ROOT_DIR/scripts/check-backend.sh"

# 1) Frontend build exists and uses relative asset paths
if [[ ! -f "$ROOT_DIR/frontend/dist/index.html" ]]; then
  fail "frontend/dist/index.html not found. Run: cd frontend && npm run build:electron"
fi

if rg -n "src=\"/assets|href=\"/assets|href=\"/vite.svg\"" "$ROOT_DIR/frontend/dist/index.html" >/dev/null; then
  fail "frontend/dist/index.html references absolute /assets or /vite.svg. Rebuild with: cd frontend && npm run build:electron"
else
  ok "Frontend assets use relative paths (./assets, ./vite.svg)"
fi

# 2) Backend binary exists
if [[ ! -x "$ROOT_DIR/backend/bin/transcriptai-backend" ]]; then
  fail "backend/bin/transcriptai-backend not found or not executable. Build with: bash backend/build-backend.sh"
else
  ok "Backend binary present"
fi

# 2b) Whisper.cpp artifacts (replaces MLX/PyTorch for lean builds)
BACKEND_CPP="$ROOT_DIR/backend-cpp"

if [[ ! -x "$BACKEND_CPP/whisper-server" ]]; then
  fail "whisper-server not found at $BACKEND_CPP/whisper-server. Build with: cd backend-cpp && make whisper-server"
fi
ok "whisper-server binary present"

# Check for required dylibs
DYLIB_COUNT=$(ls "$BACKEND_CPP"/*.dylib 2>/dev/null | wc -l | tr -d ' ')
if [[ "$DYLIB_COUNT" -eq 0 ]]; then
  fail "No .dylib files found in $BACKEND_CPP. Build whisper.cpp first."
fi
ok "Dynamic libraries present ($DYLIB_COUNT .dylib files)"

# 3) GGML model present for offline transcription
if ! ls "$BACKEND_CPP/models"/*.bin >/dev/null 2>&1; then
  fail "No GGML model found in $BACKEND_CPP/models/. Download with: cd backend-cpp && bash scripts/download-model.sh base.en"
fi
MODEL_FILE=$(ls "$BACKEND_CPP/models"/*.bin | head -1)
MODEL_SIZE_MB=$(du -sm "$MODEL_FILE" | cut -f1)
ok "GGML model present: $(basename "$MODEL_FILE") (${MODEL_SIZE_MB}M)"

# 4) electron-builder config includes resources
if ! rg -n "frontend_dist" "$ROOT_DIR/desktop/electron-builder.yml" >/dev/null; then
  fail "electron-builder.yml missing frontend_dist in extraResources"
fi
if ! rg -n "whisper-server" "$ROOT_DIR/desktop/electron-builder.yml" >/dev/null; then
  fail "electron-builder.yml missing whisper-server in extraResources"
fi
ok "electron-builder extraResources configured"

echo "[prepack] All checks passed."
