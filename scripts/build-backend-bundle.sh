#!/usr/bin/env bash
set -euo pipefail

# Build a standalone backend binary for the current OS/arch.
# Uses PyInstaller specific spec file to ensure MLX and other deps are bundled correctly.

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
OUT="$ROOT/backend/dist"

echo "Using python: $(which python3)"
echo "Building backend bundle..."

cd "$ROOT/backend"

# Clean previous builds
rm -rf build/ dist/

# Run PyInstaller with the custom spec file
# -y: overwrite output directory
# --clean: clean cache from invalid builds
python3 -m PyInstaller -y --clean transcriptai-backend.spec

# Verify output
if [ -f "$OUT/transcriptai-backend/transcriptai-backend" ]; then
    echo "✅ Build successful!"
    echo "Bundle located at: $OUT/transcriptai-backend/transcriptai-backend"
    
    # Calculate size
    du -sh "$OUT/transcriptai-backend"
else
    echo "❌ Build failed. Artifact not found."
    exit 1
fi
