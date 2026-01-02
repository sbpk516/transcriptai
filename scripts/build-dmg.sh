#!/bin/bash

# Build DMG file for TranscriptAI desktop app
# This script ensures all prerequisites are met and builds the DMG
#
# Usage:
#   bash scripts/build-dmg.sh          # Normal build
#   bash scripts/build-dmg.sh --clean  # Clean build (removes old DMG files)

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"

# Flags
CLEAN_BUILD=false
REBUILD_BACKEND=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --clean|-c)
      CLEAN_BUILD=true
      ;;
    --rebuild-backend)
      REBUILD_BACKEND=true
      ;;
    *)
      ;;
  esac
done

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI DMG Builder${NC}"
if [[ "$CLEAN_BUILD" == "true" ]]; then
    echo -e "${BLUE}  (Clean Build Mode)${NC}"
fi
if [[ "$REBUILD_BACKEND" == "true" ]]; then
    echo -e "${BLUE}  (Force Backend Rebuild)${NC}"
fi
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}[1] Checking prerequisites...${NC}"

# Check if we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}✗${NC} This script must be run on macOS to build DMG files"
    exit 1
fi
echo -e "${GREEN}✓${NC} Running on macOS"

# Check if electron-builder is installed
if ! command -v electron-builder &> /dev/null; then
    if [ -d "$DESKTOP_DIR/node_modules/.bin" ] && [ -f "$DESKTOP_DIR/node_modules/.bin/electron-builder" ]; then
        ELECTRON_BUILDER="$DESKTOP_DIR/node_modules/.bin/electron-builder"
        echo -e "${GREEN}✓${NC} electron-builder found in node_modules"
    else
        echo -e "${RED}✗${NC} electron-builder not found. Installing..."
        cd "$DESKTOP_DIR"
        npm install
        ELECTRON_BUILDER="$DESKTOP_DIR/node_modules/.bin/electron-builder"
    fi
else
    ELECTRON_BUILDER="electron-builder"
    echo -e "${GREEN}✓${NC} electron-builder found in PATH"
fi

# Clean backend artifacts if requested
if [[ "$CLEAN_BUILD" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}[2] Cleaning backend artifacts...${NC}"
    rm -rf "$ROOT_DIR/backend/bin/transcriptai-backend" "$ROOT_DIR/backend/dist" "$ROOT_DIR/backend/build" 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Backend artifacts cleaned"
fi

# Check / build backend binary
echo ""
echo -e "${YELLOW}[2] Checking backend binary...${NC}"
if [[ "$REBUILD_BACKEND" == "true" ]] || [ ! -e "$ROOT_DIR/backend/bin/transcriptai-backend" ]; then
    echo -e "${YELLOW}⚠${NC} Building backend binary..."
    cd "$ROOT_DIR/backend"
    bash build-backend.sh
    if [ ! -e "$ROOT_DIR/backend/bin/transcriptai-backend" ]; then
        echo -e "${RED}✗${NC} Failed to build backend binary"
        exit 1
    fi
fi
echo -e "${GREEN}✓${NC} Backend binary ready: backend/bin/transcriptai-backend"

# Verify backend binary
echo ""
echo -e "${YELLOW}[2.5] Verifying backend bundle...${NC}"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify-backend-bundle.py"
BACKEND_BIN="$ROOT_DIR/backend/bin/transcriptai-backend/transcriptai-backend"

# Copy verify script to backend bin dir to run it in context if needed,
# but we actually want to run it using the BUNDLED python if possible,
# or just run the binary and see if it imports.
# The best way is to try to run the binary with a command that imports everything.
# Since the binary is a compiled entry point, we can't easily 'run a script' with it.
# Instead, we'll trust that if we can run the binary and it doesn't crash immediately, it's okay.
# BUT, the crash happens on import. So let's try to run it with --help or similar.
# The backend uses argparse/click or just starts uvicorn?
# If it's just uvicorn, it might hang.
# Let's try to run a quick python check if there's a python executable in the bundle.
# In PyInstaller onedir, there is usually no python executable exposed directly
# that can run arbitrary scripts unless we package it that way.

# Alternative: We will try to run the backend binary in background, wait 5s, check if it's still running.
# If it crashed (exit code != 0 or process gone), verification failed.

if [[ "${SKIP_BACKEND_SMOKE_TEST:-0}" == "1" ]]; then
    echo -e "${YELLOW}⚠${NC} Skipping backend smoke test (SKIP_BACKEND_SMOKE_TEST=1)"
else
    echo "Running smoke test on backend binary..."
    # Use desktop mode + workspace data dir to avoid external DB dependencies.
    SMOKE_DATA_DIR="$ROOT_DIR/backend/build/smoke-data"
    mkdir -p "$SMOKE_DATA_DIR"
    TRANSCRIPTAI_MODE="desktop" TRANSCRIPTAI_DATA_DIR="$SMOKE_DATA_DIR" "$BACKEND_BIN" &
    PID=$!
    sleep 5
    if kill -0 $PID > /dev/null 2>&1; then
       echo -e "${GREEN}✓${NC} Backend binary started and stayed running (PID $PID)"
       kill $PID || true
    else
       echo -e "${RED}✗${NC} Backend binary crashed immediately!"
       wait $PID
       EXIT_CODE=$?
       echo "Exit code: $EXIT_CODE"
       exit 1
    fi
fi

# Check frontend build
echo ""
echo -e "${YELLOW}[3] Checking frontend build...${NC}"
if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
    echo -e "${YELLOW}⚠${NC} Frontend not built. Building..."
    cd "$ROOT_DIR/frontend"
    npm run build:electron
    if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
        echo -e "${RED}✗${NC} Failed to build frontend"
        exit 1
    fi
fi
echo -e "${GREEN}✓${NC} Frontend build exists: frontend/dist/index.html"

# Check MLX venv (optional but recommended)
echo ""
echo -e "${YELLOW}[4] Checking MLX virtual environment...${NC}"
if [ ! -d "$ROOT_DIR/venv_mlx" ]; then
    echo -e "${YELLOW}⚠${NC} MLX venv not found. This is optional but recommended for Apple Silicon."
    echo -e "${YELLOW}   Run: bash scripts/build-mlx-venv.sh${NC}"
else
    echo -e "${GREEN}✓${NC} MLX venv exists"
fi

# Build Mac key server
echo ""
echo -e "${YELLOW}[5] Building Mac key server...${NC}"
cd "$DESKTOP_DIR"
npm run build:mac-key-server
echo -e "${GREEN}✓${NC} Mac key server built"

# Run prepack checks
echo ""
echo -e "${YELLOW}[6] Running prepack checks...${NC}"
cd "$DESKTOP_DIR"
npm run prepack:check
echo -e "${GREEN}✓${NC} Prepack checks passed"

# Build DMG
echo ""
echo -e "${YELLOW}[7] Building DMG file...${NC}"
echo -e "${BLUE}This may take several minutes...${NC}"
echo ""

cd "$DESKTOP_DIR"

# Clean old DMG files for a fresh build (if --clean flag or always clean DMG files)
if [[ "$CLEAN_BUILD" == "true" ]]; then
    echo -e "${YELLOW}Cleaning all build artifacts...${NC}"
    rm -rf "$DESKTOP_DIR/dist"/*.dmg 2>/dev/null || true
    rm -rf "$DESKTOP_DIR/dist"/*.dmg.blockmap 2>/dev/null || true
    rm -rf "$DESKTOP_DIR/dist"/*.yml 2>/dev/null || true
    rm -rf "$DESKTOP_DIR/dist/mac-arm64" 2>/dev/null || true
    echo -e "${GREEN}✓${NC} All build artifacts cleaned"
else
    # Always clean old DMG files (but keep mac-arm64 directory)
    echo -e "${YELLOW}Cleaning old DMG files...${NC}"
    rm -f "$DESKTOP_DIR/dist"/*.dmg 2>/dev/null || true
    rm -f "$DESKTOP_DIR/dist"/*.dmg.blockmap 2>/dev/null || true
    rm -f "$DESKTOP_DIR/dist"/*.yml 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Old DMG files cleaned"
fi

# Use npm script which runs electron-builder
npm run dist

# Check if DMG was created
DMG_FILE=$(find "$DESKTOP_DIR/dist" -name "TranscriptAI-*.dmg" -o -name "transcriptai-*.dmg" 2>/dev/null | head -1)

if [ -n "$DMG_FILE" ] && [ -f "$DMG_FILE" ]; then
    DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
    echo ""
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ DMG file created successfully!${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "Location: ${GREEN}$DMG_FILE${NC}"
    echo -e "Size: ${GREEN}$DMG_SIZE${NC}"
    echo ""
    echo -e "${YELLOW}To install:${NC}"
    echo "  1. Double-click the DMG file"
    echo "  2. Drag TranscriptAI.app to Applications folder"
    echo "  3. Open Applications and launch TranscriptAI"
    echo ""
    exit 0
else
    echo ""
    echo -e "${RED}✗${NC} DMG file not found after build"
    echo -e "${YELLOW}Check the build output above for errors${NC}"
    exit 1
fi
