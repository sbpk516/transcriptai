#!/bin/bash

# ============================================================================
# TranscriptAI Complete DMG Builder
# ============================================================================
# This script handles EVERYTHING needed to build a DMG file:
# - Checks all prerequisites
# - Installs missing dependencies
# - Cleans previous builds (optional)
# - Builds backend, frontend, and DMG
# - Validates each step
# - Provides clear progress indicators
#
# Usage:
#   bash scripts/build-dmg-complete.sh          # Normal build
#   bash scripts/build-dmg-complete.sh --clean  # Clean build (removes old builds)
#   bash scripts/build-dmg-complete.sh --force   # Force rebuild everything
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Parse arguments
CLEAN_BUILD=false
FORCE_REBUILD=false
if [[ "${1:-}" == "--clean" ]] || [[ "${1:-}" == "-c" ]]; then
    CLEAN_BUILD=true
elif [[ "${1:-}" == "--force" ]] || [[ "${1:-}" == "-f" ]]; then
    FORCE_REBUILD=true
    CLEAN_BUILD=true
fi

# Get root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_step() { echo -e "\n${CYAN}══════════════════════════════════════════════════════════${NC}"; echo -e "${BOLD}${CYAN}$1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}\n"; }

# Track start time
BUILD_START=$(date +%s)

# ============================================================================
# STEP 0: Cleanup (if requested)
# ============================================================================
if [[ "$CLEAN_BUILD" == "true" ]]; then
    log_step "STEP 0: Cleaning Previous Builds"
    
    log_info "Removing old backend build..."
    rm -rf "$BACKEND_DIR/bin/transcriptai-backend" 2>/dev/null || true
    rm -rf "$BACKEND_DIR/dist" 2>/dev/null || true
    rm -rf "$BACKEND_DIR/build" 2>/dev/null || true
    
    log_info "Removing old frontend build..."
    rm -rf "$FRONTEND_DIR/dist" 2>/dev/null || true
    
    log_info "Removing old DMG files..."
    rm -f "$DESKTOP_DIR/dist"/*.dmg 2>/dev/null || true
    
    log_success "Cleanup complete"
fi

# ============================================================================
# STEP 1: System Prerequisites
# ============================================================================
log_step "STEP 1: Checking System Prerequisites"

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
    log_error "This script must be run on macOS to build DMG files"
    exit 1
fi
log_success "Running on macOS"

# Check Python
if ! command -v python3 &> /dev/null; then
    log_error "Python 3 is required but not found"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
log_success "Python found: $PYTHON_VERSION"

# Check Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js is required but not found. Install from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
log_success "Node.js found: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm is required but not found"
    exit 1
fi
NPM_VERSION=$(npm --version)
log_success "npm found: $NPM_VERSION"

# Check PyInstaller
if ! python3 -c "import PyInstaller" 2>/dev/null; then
    log_warning "PyInstaller not found. Installing..."
    pip3 install pyinstaller
    log_success "PyInstaller installed"
else
    log_success "PyInstaller found"
fi

# ============================================================================
# STEP 2: Python Environment Setup
# ============================================================================
log_step "STEP 2: Setting Up Python Environment"

# Check if venv exists
if [[ ! -d "$ROOT_DIR/venv" ]]; then
    log_warning "Python venv not found. Creating..."
    cd "$ROOT_DIR"
    python3 -m venv venv
    log_success "Python venv created"
fi

# Activate venv
source "$ROOT_DIR/venv/bin/activate"
log_success "Python venv activated"

# Install/upgrade pip
log_info "Ensuring pip is up to date..."
pip install --upgrade pip --quiet

# Install Python dependencies
log_info "Installing Python dependencies..."
cd "$ROOT_DIR"
if [[ -f "requirements.txt" ]]; then
    pip install -q -r requirements.txt
    log_success "Python dependencies installed"
else
    log_warning "requirements.txt not found"
fi

# ============================================================================
# STEP 3: Node.js Dependencies
# ============================================================================
log_step "STEP 3: Installing Node.js Dependencies"

# Install desktop dependencies
log_info "Installing desktop dependencies..."
cd "$DESKTOP_DIR"
if [[ ! -d "node_modules" ]] || [[ "$FORCE_REBUILD" == "true" ]]; then
    npm install
    log_success "Desktop dependencies installed"
else
    log_success "Desktop dependencies already installed"
fi

# Install frontend dependencies
log_info "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
if [[ ! -d "node_modules" ]] || [[ "$FORCE_REBUILD" == "true" ]]; then
    npm install
    log_success "Frontend dependencies installed"
else
    log_success "Frontend dependencies already installed"
fi

# ============================================================================
# STEP 4: MLX Virtual Environment (Optional)
# ============================================================================
log_step "STEP 4: Checking MLX Virtual Environment"

if [[ ! -d "$ROOT_DIR/venv_mlx" ]]; then
    log_warning "MLX venv not found. This is optional but recommended for Apple Silicon."
    log_warning "The app will use PyTorch backend instead (slower)."
    log_info "To build MLX venv later, run: bash scripts/build-mlx-venv.sh"
else
    # Verify MLX venv is valid
    if [[ ! -x "$ROOT_DIR/venv_mlx/bin/python" ]]; then
        log_warning "MLX venv exists but Python binary is missing. Recreating..."
        bash "$ROOT_DIR/scripts/build-mlx-venv.sh" || log_warning "MLX venv build failed, continuing without it"
    elif ! "$ROOT_DIR/venv_mlx/bin/python" -c "import mlx, mlx_whisper" 2>/dev/null; then
        log_warning "MLX venv exists but packages are missing. Recreating..."
        bash "$ROOT_DIR/scripts/build-mlx-venv.sh" || log_warning "MLX venv build failed, continuing without it"
    else
        log_success "MLX venv is ready"
        
        # Cleanup MLX venv to reduce size
        if [[ -f "$ROOT_DIR/scripts/cleanup-mlx-venv.sh" ]]; then
            log_info "Cleaning up MLX venv to reduce package size..."
            bash "$ROOT_DIR/scripts/cleanup-mlx-venv.sh" || log_warning "MLX venv cleanup had warnings"
        fi
    fi
fi

# ============================================================================
# STEP 5: Backend Build
# ============================================================================
log_step "STEP 5: Building Backend"

cd "$BACKEND_DIR"

# Check if backend needs rebuilding
BACKEND_EXISTS=false
if [[ -d "$BACKEND_DIR/bin/transcriptai-backend" ]] && [[ "$FORCE_REBUILD" != "true" ]]; then
    BACKEND_EXISTS=true
    log_info "Backend binary exists, skipping rebuild (use --force to rebuild)"
fi

if [[ "$BACKEND_EXISTS" == "false" ]]; then
    log_info "Building backend with PyInstaller..."
    bash build-backend.sh
    
    # Verify backend was built
    if [[ ! -d "$BACKEND_DIR/bin/transcriptai-backend" ]] && [[ ! -f "$BACKEND_DIR/bin/transcriptai-backend" ]]; then
        log_error "Backend build failed - binary not found"
        exit 1
    fi
    
    log_success "Backend built successfully"
else
    log_success "Backend binary exists"
fi

# ============================================================================
# STEP 6: Frontend Build
# ============================================================================
log_step "STEP 6: Building Frontend"

cd "$FRONTEND_DIR"

# Check if frontend needs rebuilding
FRONTEND_EXISTS=false
if [[ -f "$FRONTEND_DIR/dist/index.html" ]] && [[ "$FORCE_REBUILD" != "true" ]]; then
    FRONTEND_EXISTS=true
    log_info "Frontend build exists, skipping rebuild (use --force to rebuild)"
fi

if [[ "$FRONTEND_EXISTS" == "false" ]]; then
    log_info "Building frontend with Vite..."
    npm run build:electron
    
    # Verify frontend was built
    if [[ ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
        log_error "Frontend build failed - index.html not found"
        exit 1
    fi
    
    log_success "Frontend built successfully"
else
    log_success "Frontend build exists"
fi

# ============================================================================
# STEP 7: Whisper Model Cache Check
# ============================================================================
log_step "STEP 7: Checking Whisper Model Cache"

WHISPER_CACHE="$ROOT_DIR/backend/whisper_cache/whisper/tiny.pt"
if [[ ! -f "$WHISPER_CACHE" ]]; then
    log_warning "Whisper model cache not found: $WHISPER_CACHE"
    log_warning "The app will download models on first use (requires internet)"
    log_info "To pre-download models, run the app once and let it download"
else
    TINY_SIZE_MB=$(du -sm "$WHISPER_CACHE" 2>/dev/null | cut -f1 || echo "unknown")
    log_success "Whisper model cache found (${TINY_SIZE_MB}M)"
fi

# ============================================================================
# STEP 8: Mac Key Server Build
# ============================================================================
log_step "STEP 8: Building Mac Key Server"

cd "$DESKTOP_DIR"
log_info "Building native macOS key server..."
npm run build:mac-key-server
log_success "Mac key server built"

# ============================================================================
# STEP 9: Prepack Validation
# ============================================================================
log_step "STEP 9: Running Prepack Validation"

cd "$DESKTOP_DIR"
log_info "Running prepack checks..."
if npm run prepack:check; then
    log_success "Prepack checks passed"
else
    log_error "Prepack checks failed"
    exit 1
fi

# ============================================================================
# STEP 10: DMG Creation
# ============================================================================
log_step "STEP 10: Creating DMG File"

cd "$DESKTOP_DIR"
log_info "Building DMG with electron-builder..."
log_info "This may take 5-10 minutes..."

# Run electron-builder
if npm run dist; then
    log_success "DMG build completed"
else
    log_error "DMG build failed"
    exit 1
fi

# ============================================================================
# STEP 11: Verification
# ============================================================================
log_step "STEP 11: Verifying DMG File"

DMG_FILE=$(find "$DESKTOP_DIR/dist" -name "TranscriptAI-*.dmg" -o -name "transcriptai-*.dmg" 2>/dev/null | head -1)

if [[ -n "$DMG_FILE" ]] && [[ -f "$DMG_FILE" ]]; then
    DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
    DMG_SIZE_BYTES=$(stat -f%z "$DMG_FILE" 2>/dev/null || stat -c%s "$DMG_FILE" 2>/dev/null)
    DMG_SIZE_MB=$((DMG_SIZE_BYTES / 1024 / 1024))
    
    BUILD_END=$(date +%s)
    BUILD_TIME=$((BUILD_END - BUILD_START))
    BUILD_MINUTES=$((BUILD_TIME / 60))
    BUILD_SECONDS=$((BUILD_TIME % 60))
    
    echo ""
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  ✅ DMG FILE CREATED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Location:${NC} ${GREEN}$DMG_FILE${NC}"
    echo -e "  ${BOLD}Size:${NC} ${GREEN}$DMG_SIZE${NC} (${DMG_SIZE_MB} MB)"
    echo -e "  ${BOLD}Build Time:${NC} ${GREEN}${BUILD_MINUTES}m ${BUILD_SECONDS}s${NC}"
    echo ""
    echo -e "${YELLOW}To install:${NC}"
    echo "  1. Double-click the DMG file"
    echo "  2. Drag TranscriptAI.app to Applications folder"
    echo "  3. Open Applications and launch TranscriptAI"
    echo ""
    echo -e "${CYAN}To test the DMG:${NC}"
    echo "  open \"$DMG_FILE\""
    echo ""
    
    exit 0
else
    log_error "DMG file not found after build"
    log_error "Check the build output above for errors"
    exit 1
fi







