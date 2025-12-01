#!/bin/bash

# Build DMG file for TranscriptAI desktop app
# This script ensures all prerequisites are met and builds the DMG

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI DMG Builder${NC}"
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

# Check backend binary
echo ""
echo -e "${YELLOW}[2] Checking backend binary...${NC}"
if [ ! -f "$ROOT_DIR/backend/bin/transcriptai-backend" ]; then
    echo -e "${YELLOW}⚠${NC} Backend binary not found. Building..."
    cd "$ROOT_DIR/backend"
    bash build-backend.sh
    if [ ! -f "$ROOT_DIR/backend/bin/transcriptai-backend" ]; then
        echo -e "${RED}✗${NC} Failed to build backend binary"
        exit 1
    fi
fi
echo -e "${GREEN}✓${NC} Backend binary exists: backend/bin/transcriptai-backend"

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

















