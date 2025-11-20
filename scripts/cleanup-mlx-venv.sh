#!/usr/bin/env bash
set -euo pipefail

# Cleanup script to remove unnecessary packages from venv_mlx before packaging
# This reduces the DMG size significantly by removing unused dependencies

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/venv_mlx"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "[cleanup] venv_mlx not found at $VENV_DIR" >&2
  exit 1
fi

echo "[cleanup] Cleaning up venv_mlx at $VENV_DIR"
echo "[cleanup] Initial size: $(du -sh "$VENV_DIR" | cut -f1)"

PYTHON_BIN="$VENV_DIR/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "[cleanup] Python binary not found at $PYTHON_BIN" >&2
  exit 1
fi

# Packages to remove (these are not needed for MLX Whisper)
# Note: Most packages are required by mlx-whisper dependencies (torch, scipy, sympy, etc.)
# We can only safely remove development/build tools
PACKAGES_TO_REMOVE=(
  "pip"                 # 12M - Package manager, not needed in production
  "setuptools"          # 6.5M - Build tools, not needed
  "pkg_resources"       # 2.1M - Part of setuptools
)

# Remove packages
for pkg in "${PACKAGES_TO_REMOVE[@]}"; do
  if "$PYTHON_BIN" -m pip show "$pkg" >/dev/null 2>&1; then
    echo "[cleanup] Removing $pkg..."
    "$PYTHON_BIN" -m pip uninstall -y "$pkg" >/dev/null 2>&1 || true
  fi
done

# Remove development files and caches
echo "[cleanup] Removing development files..."
find "$VENV_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.pyo" -delete 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true

# Remove test files and documentation
echo "[cleanup] Removing test files and docs..."
find "$VENV_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type d -name "*.tests" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.md" -delete 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.txt" -path "*/tests/*" -delete 2>/dev/null || true
find "$VENV_DIR" -type f -name "*.rst" -delete 2>/dev/null || true

# Remove .git directories if any
find "$VENV_DIR" -type d -name ".git" -exec rm -rf {} + 2>/dev/null || true

# Verify essential packages still work
echo "[cleanup] Verifying essential MLX packages..."
if ! "$PYTHON_BIN" -c "import mlx, mlx_whisper" 2>/dev/null; then
  echo "[cleanup][WARN] MLX packages verification failed. Some packages may have been removed incorrectly." >&2
  echo "[cleanup][WARN] Recreate venv with: bash scripts/build-mlx-venv.sh" >&2
  exit 1
fi

echo "[cleanup] Final size: $(du -sh "$VENV_DIR" | cut -f1)"
echo "[cleanup] Cleanup complete!"

