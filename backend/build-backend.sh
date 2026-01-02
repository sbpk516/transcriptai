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

# --- CONFIGURATION: Default to 0 (Optimized Mac Build) ---
export TRANSCRIPTAI_BUNDLE_TORCH="${TRANSCRIPTAI_BUNDLE_TORCH:-0}"
echo "TRANSCRIPTAI_BUNDLE_TORCH=${TRANSCRIPTAI_BUNDLE_TORCH} (0 = optimized Mac build, 1 = full/Windows build)"
# ---------------------------------------------------------

# --- SAFETY CHECK: Verify Python Environment ---
echo "🔍 Checking Python environment..."
PYTHON_EXEC="python3"

if ! $PYTHON_EXEC -c "import uvicorn" &> /dev/null; then
  echo "❌ ERROR: 'uvicorn' not found in current python environment ($PYTHON_EXEC)!"
  echo "   You are likely running with System Python ($(which $PYTHON_EXEC) - $($PYTHON_EXEC --version))"
  echo "   Please activate your conda environment where dependencies are installed."
  echo "   Example: conda activate base (or your specific env)"
  exit 1
fi
echo "✅ Environment looks good: $($PYTHON_EXEC --version) (uvicorn found)"
# -----------------------------------------------

# PyInstaller one-dir build using desktop entrypoint (bundle deps)
# Using --onedir instead of --onefile to enable extraction caching
# This eliminates the 40-second extraction delay on subsequent launches
# Using spec file for better control over PyTorch/Whisper bundling
# Note: When using a .spec file, don't pass conflicting command-line options
# The spec file contains all the configuration (collect-all, hidden-imports, etc.)
# Using python3 -m PyInstaller ensures we use the active python environment (where deps are installed)
# instead of a potentially mismatched pyinstaller binary on the PATH.
python3 -m PyInstaller -y --clean transcriptai-backend.spec
