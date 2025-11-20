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
if [[ ! -x "$ROOT_DIR/backend/bin/signalhub-backend" ]]; then
  fail "backend/bin/signalhub-backend not found or not executable. Build with: bash backend/build-backend.sh"
else
  ok "Backend binary present"
fi

# 2b) MLX virtual environment present and healthy
MLX_VENV="$ROOT_DIR/venv_mlx"
if [[ ! -d "$MLX_VENV" ]]; then
  fail "venv_mlx directory not found. Run: bash scripts/build-mlx-venv.sh (Apple Silicon only)"
fi
if [[ ! -x "$MLX_VENV/bin/python" ]]; then
  fail "venv_mlx/bin/python missing. Recreate MLX venv: bash scripts/build-mlx-venv.sh"
fi

# Cleanup venv_mlx to reduce size before packaging
echo "[prepack] Cleaning up venv_mlx to reduce package size..."
if [[ -f "$ROOT_DIR/scripts/cleanup-mlx-venv.sh" ]]; then
  bash "$ROOT_DIR/scripts/cleanup-mlx-venv.sh" || warn "venv_mlx cleanup had warnings (continuing)"
else
  warn "cleanup-mlx-venv.sh not found, skipping cleanup"
fi

# Check venv_mlx size (should be under 300M after cleanup)
VENV_SIZE_MB=$(du -sm "$MLX_VENV" | cut -f1)
if [[ $VENV_SIZE_MB -gt 300 ]]; then
  warn "venv_mlx size is ${VENV_SIZE_MB}M (target: <300M). Consider running cleanup-mlx-venv.sh"
else
  ok "venv_mlx size: ${VENV_SIZE_MB}M (under 300M threshold)"
fi

if ! "$MLX_VENV/bin/python" -c "import mlx, mlx_whisper" >/dev/null 2>&1; then
  fail "venv_mlx is missing mlx packages. Recreate with: bash scripts/build-mlx-venv.sh"
else
  ok "MLX virtual environment ready (imports mlx, mlx_whisper)"
fi

# 3) Whisper model present for offline transcription (only tiny.pt required)
if [[ ! -f "$ROOT_DIR/backend/whisper_cache/whisper/tiny.pt" ]]; then
  fail "tiny.pt model not found at backend/whisper_cache/whisper/tiny.pt. This is required for offline transcription."
else
  TINY_SIZE_MB=$(du -sm "$ROOT_DIR/backend/whisper_cache/whisper/tiny.pt" | cut -f1)
  ok "Whisper tiny.pt model present (${TINY_SIZE_MB}M)"
  # Warn if base.pt is present (will be excluded from package)
  if [[ -f "$ROOT_DIR/backend/whisper_cache/whisper/base.pt" ]]; then
    warn "base.pt found but will be excluded from package (only tiny.pt is bundled)"
  fi
fi

# 4) electron-builder config includes resources
if ! rg -n "frontend_dist" "$ROOT_DIR/desktop/electron-builder.yml" >/dev/null; then
  fail "electron-builder.yml missing frontend_dist in extraResources"
fi
if ! rg -n "whisper_cache" "$ROOT_DIR/desktop/electron-builder.yml" >/dev/null; then
  fail "electron-builder.yml missing whisper_cache in extraResources"
fi
ok "electron-builder extraResources configured"

echo "[prepack] All checks passed."
