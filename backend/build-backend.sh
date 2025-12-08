#!/usr/bin/env bash
set -euo pipefail

# Build a standalone backend binary for the current OS/arch.
# Requires: pyinstaller (pip install pyinstaller)

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
OUT="$HERE/bin"

echo "Building backend binary into: $OUT"
mkdir -p "$OUT"

# Use start.py as entry or a small launcher that imports uvicorn app
cd "$ROOT/backend"

# Default: always bundle PyTorch/Whisper so PyTorch transcription is available.
export TRANSCRIPTAI_BUNDLE_TORCH="${TRANSCRIPTAI_BUNDLE_TORCH:-1}"
echo "TRANSCRIPTAI_BUNDLE_TORCH=${TRANSCRIPTAI_BUNDLE_TORCH} (set to 0 to skip bundling if you explicitly want MLX-only)"

# PyInstaller one-dir build using desktop entrypoint (bundle deps)
# Using --onedir instead of --onefile to enable extraction caching
# This eliminates the 40-second extraction delay on subsequent launches
# Using spec file for better control over PyTorch/Whisper bundling
# Note: When using a .spec file, don't pass conflicting command-line options
# The spec file contains all the configuration (collect-all, hidden-imports, etc.)
pyinstaller -y --clean transcriptai-backend.spec

# Move artifact (--onedir creates a directory)
if [[ -d dist/transcriptai-backend ]]; then
  # Remove old directory OR file if exists
  [[ -d "$OUT/transcriptai-backend" ]] && rm -rf "$OUT/transcriptai-backend"
  [[ -f "$OUT/transcriptai-backend" ]] && rm -f "$OUT/transcriptai-backend"
  mv dist/transcriptai-backend "$OUT/"
  echo "✅ Backend directory built: $OUT/transcriptai-backend"
  echo "   Executable: $OUT/transcriptai-backend/transcriptai-backend"
elif [[ -f dist/transcriptai-backend ]]; then
  # Fallback: single file (--onefile mode)
  [[ -f "$OUT/transcriptai-backend" ]] && rm -f "$OUT/transcriptai-backend"
  mv dist/transcriptai-backend "$OUT/"
  echo "✅ Backend binary built: $OUT/transcriptai-backend"
elif [[ -f dist/transcriptai-backend.exe ]]; then
  [[ -f "$OUT/transcriptai-backend.exe" ]] && rm -f "$OUT/transcriptai-backend.exe"
  mv dist/transcriptai-backend.exe "$OUT/"
  echo "✅ Backend binary built: $OUT/transcriptai-backend.exe"
fi

echo "Done. Place the backend (directory or binary) under backend/bin before packaging the desktop app."
