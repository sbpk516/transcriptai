#!/bin/bash

# ============================================================================
# TranscriptAI Size Monitor Script
# ============================================================================
# Tracks codebase and build sizes to detect bloat.
# Run this BEFORE and AFTER adding features to monitor growth.
#
# Usage:
#   ./scripts/monitor-size.sh                    # Display current sizes
#   ./scripts/monitor-size.sh > baseline.txt     # Save for comparison
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Size Monitor${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo ""
echo "Timestamp: $(date -Iseconds)"
echo ""

# ============================================================================
# 1. DMG Size
# ============================================================================
echo -e "${YELLOW}[1/6] DMG File Size${NC}"

DMG_FILE=$(find "$ROOT_DIR/desktop/dist" -name "*.dmg" 2>/dev/null | head -1)
if [[ -n "$DMG_FILE" ]] && [[ -f "$DMG_FILE" ]]; then
    DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
    DMG_SIZE_MB=$(du -m "$DMG_FILE" | cut -f1)
    echo "DMG file: $DMG_SIZE ($DMG_SIZE_MB MB)"
    echo "Location: $DMG_FILE"
else
    echo "DMG file: Not found"
    DMG_SIZE_MB=0
fi
echo ""

# ============================================================================
# 2. Backend Bundle Size
# ============================================================================
echo -e "${YELLOW}[2/6] Backend Bundle Size${NC}"

BACKEND_BUNDLE="$ROOT_DIR/backend/bin/transcriptai-backend"
if [[ -d "$BACKEND_BUNDLE" ]]; then
    BUNDLE_SIZE=$(du -sh "$BACKEND_BUNDLE" | cut -f1)
    BUNDLE_SIZE_MB=$(du -sm "$BACKEND_BUNDLE" | cut -f1)
    echo "Backend bundle: $BUNDLE_SIZE ($BUNDLE_SIZE_MB MB)"
    
    # Top 5 largest components
    echo "Top 5 components:"
    du -sm "$BACKEND_BUNDLE/_internal"/* 2>/dev/null | sort -rn | head -5 | while read size name; do
        component=$(basename "$name")
        echo "  - $component: ${size}M"
    done
else
    echo "Backend bundle: Not found"
    BUNDLE_SIZE_MB=0
fi
echo ""

# ============================================================================
# 3. Source Code Size
# ============================================================================
echo -e "${YELLOW}[3/6] Source Code Size${NC}"

BACKEND_SRC=$(du -sh "$ROOT_DIR/backend/app" 2>/dev/null | cut -f1 || echo "N/A")
FRONTEND_SRC=$(du -sh "$ROOT_DIR/frontend/src" 2>/dev/null | cut -f1 || echo "N/A")

echo "Backend source (backend/app): $BACKEND_SRC"
echo "Frontend source (frontend/src): $FRONTEND_SRC"
echo ""

# ============================================================================
# 4. Dependencies Count
# ============================================================================
echo -e "${YELLOW}[4/6] Dependencies Count${NC}"

# Python dependencies
if [[ -f "$ROOT_DIR/requirements.txt" ]]; then
    PY_DEPS=$(grep -v "^#" "$ROOT_DIR/requirements.txt" | grep -v "^$" | wc -l | tr -d ' ')
    echo "Python dependencies: $PY_DEPS"
else
    PY_DEPS=0
    echo "Python dependencies: N/A (no requirements.txt)"
fi

# Node dependencies (frontend)
if [[ -f "$ROOT_DIR/frontend/package.json" ]]; then
    NODE_DEPS=$(cat "$ROOT_DIR/frontend/package.json" | grep -A 100 '"dependencies"' | grep -B 100 '"devDependencies"' | grep -c '"' || echo "0")
    NODE_DEV_DEPS=$(cat "$ROOT_DIR/frontend/package.json" | grep -A 100 '"devDependencies"' | grep -c '"' || echo "0")
    echo "Frontend dependencies: ~$NODE_DEPS"
    echo "Frontend dev dependencies: ~$NODE_DEV_DEPS"
else
    NODE_DEPS=0
    echo "Frontend dependencies: N/A"
fi

# Desktop dependencies
if [[ -f "$ROOT_DIR/desktop/package.json" ]]; then
    DESKTOP_DEPS=$(cat "$ROOT_DIR/desktop/package.json" | grep -A 100 '"dependencies"' | grep -B 100 '"devDependencies"' | grep -c '"' || echo "0")
    echo "Desktop dependencies: ~$DESKTOP_DEPS"
else
    DESKTOP_DEPS=0
fi
echo ""

# ============================================================================
# 5. File Counts
# ============================================================================
echo -e "${YELLOW}[5/6] File Counts${NC}"

PY_FILES=$(find "$ROOT_DIR/backend" -name "*.py" | grep -v __pycache__ | grep -v venv | grep -v "/bin/" | wc -l | tr -d ' ')
TS_FILES=$(find "$ROOT_DIR/frontend/src" -name "*.ts" -o -name "*.tsx" 2>/dev/null | wc -l | tr -d ' ')
JS_FILES=$(find "$ROOT_DIR/desktop/src" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')

echo "Python files (backend): $PY_FILES"
echo "TypeScript files (frontend): $TS_FILES"
echo "JavaScript files (desktop): $JS_FILES"
echo ""

# ============================================================================
# 6. Virtual Environments
# ============================================================================
echo -e "${YELLOW}[6/6] Virtual Environment Sizes${NC}"

if [[ -d "$ROOT_DIR/venv" ]]; then
    VENV_SIZE=$(du -sh "$ROOT_DIR/venv" | cut -f1)
    echo "venv: $VENV_SIZE"
else
    echo "venv: Not found"
fi

if [[ -d "$ROOT_DIR/venv_mlx" ]]; then
    VENV_MLX_SIZE=$(du -sh "$ROOT_DIR/venv_mlx" | cut -f1)
    echo "venv_mlx: $VENV_MLX_SIZE"
else
    echo "venv_mlx: Not found"
fi
echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Summary${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo "DMG Size:           ${DMG_SIZE_MB:-0} MB"
echo "Backend Bundle:     ${BUNDLE_SIZE_MB:-0} MB"
echo "Python Deps:        $PY_DEPS"
echo "Frontend Deps:      ~$NODE_DEPS"
echo "Python Files:       $PY_FILES"
echo "TypeScript Files:   $TS_FILES"
echo ""
echo "Compare with previous run to detect growth."


