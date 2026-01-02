#!/bin/bash

# ============================================================================
# TranscriptAI Lean DMG Builder
# ============================================================================
# Builds DMG with the lean backend using whisper.cpp (~300MB instead of 1.1GB+)
#
# Architecture: Python (FastAPI) + whisper.cpp (C++ inference)
# - No PyTorch/MLX bundling
# - Uses pre-built whisper-server binary
# - GGML models instead of .pt files
#
# Usage:
#   bash scripts/build-dmg-lean.sh
#   bash scripts/build-dmg-lean.sh --clean  # Clean build
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_step() { echo -e "\n${GREEN}═══════════════════════════════════════════════════${NC}\n${GREEN}$1${NC}\n${GREEN}═══════════════════════════════════════════════════${NC}\n"; }

# Get root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_CPP_DIR="$ROOT_DIR/backend-cpp"
FRONTEND_DIR="$ROOT_DIR/frontend"
DESKTOP_DIR="$ROOT_DIR/desktop"

# Parse args
CLEAN_BUILD=false
if [[ "${1:-}" == "--clean" ]]; then
    CLEAN_BUILD=true
fi

BUILD_START=$(date +%s)

# ============================================================================
# STEP 1: Clean (if requested)
# ============================================================================
if [[ "$CLEAN_BUILD" == "true" ]]; then
    log_step "Cleaning previous builds..."
    rm -rf "$BACKEND_DIR/dist" "$BACKEND_DIR/build" 2>/dev/null || true
    rm -rf "$FRONTEND_DIR/dist" 2>/dev/null || true
    rm -f "$DESKTOP_DIR/dist"/*.dmg 2>/dev/null || true
    log_success "Cleanup complete"
fi

# ============================================================================
# STEP 2: Build Lean Backend
# ============================================================================
log_step "Building Lean Backend..."

cd "$BACKEND_DIR"

# Check if lean venv exists
if [[ ! -d ".venv_lean" ]]; then
    log_info "Creating lean Python venv..."
    python3.12 -m venv .venv_lean
    source .venv_lean/bin/activate
    pip install --upgrade pip wheel
    pip install -r requirements-lean.txt
    pip install pyinstaller pyinstaller-hooks-contrib
else
    source .venv_lean/bin/activate
fi

log_info "Building backend with PyInstaller (lean mode)..."
TRANSCRIPTAI_BUNDLE_TORCH=0 pyinstaller --clean transcriptai-backend.spec

# Verify
if [[ ! -d "$BACKEND_DIR/dist/transcriptai-backend" ]]; then
    log_error "Backend build failed!"
    exit 1
fi

BACKEND_SIZE=$(du -sh "$BACKEND_DIR/dist/transcriptai-backend" | cut -f1)
log_success "Backend built: $BACKEND_SIZE"

# Copy to bin/ where electron-builder expects it
log_info "Copying backend to bin/..."
rm -rf "$BACKEND_DIR/bin/transcriptai-backend"
mkdir -p "$BACKEND_DIR/bin"
cp -R "$BACKEND_DIR/dist/transcriptai-backend" "$BACKEND_DIR/bin/"
log_success "Backend copied to bin/"

# ============================================================================
# STEP 3: Build Frontend
# ============================================================================
log_step "Building Frontend..."

cd "$FRONTEND_DIR"

if [[ ! -d "node_modules" ]]; then
    npm install
fi

npm run build:electron

if [[ ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
    log_error "Frontend build failed!"
    exit 1
fi

log_success "Frontend built"

# ============================================================================
# STEP 4: Build DMG
# ============================================================================
log_step "Creating DMG..."

cd "$DESKTOP_DIR"

if [[ ! -d "node_modules" ]]; then
    npm install
fi

npm run dist

# Find DMG
DMG_FILE=$(find "$DESKTOP_DIR/dist" -name "*.dmg" 2>/dev/null | head -1)

if [[ -n "$DMG_FILE" ]] && [[ -f "$DMG_FILE" ]]; then
    DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
    BUILD_END=$(date +%s)
    BUILD_TIME=$((BUILD_END - BUILD_START))
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ DMG CREATED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  Location: ${GREEN}$DMG_FILE${NC}"
    echo -e "  Size: ${GREEN}$DMG_SIZE${NC}"
    echo -e "  Build Time: ${GREEN}${BUILD_TIME}s${NC}"
    echo ""
    echo "  To open: open \"$DMG_FILE\""
    echo ""
else
    log_error "DMG file not found!"
    exit 1
fi
