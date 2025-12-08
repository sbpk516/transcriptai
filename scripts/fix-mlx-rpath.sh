#!/bin/bash

# ============================================================================
# Fix MLX @rpath for Relocatable Virtual Environment
# ============================================================================
# This script fixes the @rpath entries in MLX shared libraries to make the
# venv_mlx environment relocatable. It removes hardcoded build paths and
# ensures libraries can be found via @loader_path.
#
# Usage:
#   bash scripts/fix-mlx-rpath.sh [venv_path]
#
# If venv_path is not provided, defaults to ../venv_mlx relative to script.
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
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# Get venv path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PATH="${1:-$SCRIPT_DIR/../venv_mlx}"
VENV_PATH="$(cd "$VENV_PATH" 2>/dev/null && pwd)" || {
    log_error "venv_mlx not found at: ${1:-$SCRIPT_DIR/../venv_mlx}"
    exit 1
}

log_info "Fixing MLX @rpath in: $VENV_PATH"

# Find MLX directory
MLX_DIR="$VENV_PATH/lib/python3.11/site-packages/mlx"
if [[ ! -d "$MLX_DIR" ]]; then
    log_error "MLX directory not found at: $MLX_DIR"
    exit 1
fi
log_success "Found MLX directory: $MLX_DIR"

# Find libmlx.dylib
LIBMLX="$MLX_DIR/lib/libmlx.dylib"
if [[ ! -f "$LIBMLX" ]]; then
    log_error "libmlx.dylib not found at: $LIBMLX"
    exit 1
fi
log_success "Found libmlx.dylib: $LIBMLX"

# Find all .so files
SO_FILES=$(find "$MLX_DIR" -name "*.so" -type f)
SO_COUNT=$(echo "$SO_FILES" | wc -l | tr -d ' ')

if [[ $SO_COUNT -eq 0 ]]; then
    log_error "No .so files found in $MLX_DIR"
    exit 1
fi
log_info "Found $SO_COUNT .so files to process"

# Process each .so file
FIXED_COUNT=0
SKIPPED_COUNT=0

for SO_FILE in $SO_FILES; do
    SO_NAME=$(basename "$SO_FILE")
    log_info "Processing: $SO_NAME"
    
    # Get current @rpath entries
    CURRENT_RPATHS=$(otool -l "$SO_FILE" | grep -A 2 "LC_RPATH" | grep "path" | awk '{print $2}' || true)
    
    # Check if @loader_path/lib is present
    HAS_LOADER_PATH=false
    if echo "$CURRENT_RPATHS" | grep -q "@loader_path/lib"; then
        HAS_LOADER_PATH=true
    fi
    
    # Remove hardcoded build paths (anything with /Users/ or /home/ or absolute paths)
    REMOVED_COUNT=0
    while IFS= read -r RPATH; do
        if [[ -z "$RPATH" ]]; then
            continue
        fi
        
        # Skip @loader_path entries (these are good)
        if [[ "$RPATH" == @loader_path* ]]; then
            continue
        fi
        
        # Remove absolute paths and build paths
        if [[ "$RPATH" == /* ]] || [[ "$RPATH" == *"/Users/"* ]] || [[ "$RPATH" == *"/home/"* ]] || [[ "$RPATH" == *"/build/"* ]] || [[ "$RPATH" == *"/project/"* ]]; then
            log_warning "  Removing hardcoded path: $RPATH"
            install_name_tool -delete_rpath "$RPATH" "$SO_FILE" 2>/dev/null || {
                log_warning "  Failed to remove (might not exist): $RPATH"
            }
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        fi
    done <<< "$CURRENT_RPATHS"
    
    # Add @loader_path/lib if not present
    if [[ "$HAS_LOADER_PATH" == false ]]; then
        log_info "  Adding @loader_path/lib"
        install_name_tool -add_rpath "@loader_path/lib" "$SO_FILE" || {
            log_error "  Failed to add @loader_path/lib"
            exit 1
        }
        FIXED_COUNT=$((FIXED_COUNT + 1))
    else
        log_success "  Already has @loader_path/lib"
        if [[ $REMOVED_COUNT -gt 0 ]]; then
            FIXED_COUNT=$((FIXED_COUNT + 1))
        else
            SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        fi
    fi
done

echo ""
log_success "Processing complete!"
log_info "  Fixed: $FIXED_COUNT files"
log_info "  Skipped: $SKIPPED_COUNT files (already correct)"
log_info "  Total: $SO_COUNT files"

# Verify the fix
echo ""
log_info "Verifying fix on first .so file..."
FIRST_SO=$(echo "$SO_FILES" | head -1)
FIRST_SO_NAME=$(basename "$FIRST_SO")
log_info "Checking: $FIRST_SO_NAME"

FINAL_RPATHS=$(otool -l "$FIRST_SO" | grep -A 2 "LC_RPATH" | grep "path" | awk '{print $2}')
echo ""
echo "Final @rpath entries:"
while IFS= read -r RPATH; do
    if [[ -n "$RPATH" ]]; then
        if [[ "$RPATH" == @loader_path* ]]; then
            echo -e "  ${GREEN}✓${NC} $RPATH"
        else
            echo -e "  ${YELLOW}⚠${NC} $RPATH (might be problematic)"
        fi
    fi
done <<< "$FINAL_RPATHS"

echo ""
log_success "MLX @rpath fix completed successfully!"
log_info "The venv_mlx is now relocatable and should work in the packaged app."
