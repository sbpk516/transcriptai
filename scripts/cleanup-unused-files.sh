#!/bin/bash

# Cleanup script for unused files in TranscriptAI project
# This script removes files that are confirmed to be unused

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI - Cleanup Unused Files${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

DELETED=0
SKIPPED=0

delete_file() {
    if [ -f "$1" ]; then
        rm -f "$1"
        echo -e "${GREEN}✓${NC} Deleted: $1"
        ((DELETED++))
    else
        echo -e "${YELLOW}⚠${NC} Not found: $1 (skipping)"
        ((SKIPPED++))
    fi
}

echo -e "${YELLOW}[1] Removing unused PyInstaller spec files...${NC}"
delete_file "signalhub-backend.spec"
delete_file "backend/signalhub-backend.spec"
delete_file "backend/test-mlx-bundle.spec"

echo ""
echo -e "${YELLOW}[2] Removing unused test/transcript file...${NC}"
delete_file "Test1.txt"

echo ""
echo -e "${YELLOW}[3] Removing old log file...${NC}"
delete_file "backend/logs/signalhub.log"

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "Deleted: ${GREEN}${DELETED}${NC} files"
echo -e "Skipped: ${YELLOW}${SKIPPED}${NC} files (not found)"
echo ""

if [ $DELETED -gt 0 ]; then
    echo -e "${GREEN}✅ Cleanup complete!${NC}"
else
    echo -e "${YELLOW}⚠️  No files were deleted (they may have already been removed)${NC}"
fi

echo ""
echo -e "${YELLOW}Note:${NC} The following items need manual verification before deletion:"
echo "  - ichbinbekir-node-global-key-listener-0.4.1.tgz"
echo "  - ports.config (check if duplicate of config/ports.env)"
echo "  - signalhub_data/ directories (check contents first)"
echo "  - Old build artifacts in desktop/dist/ and backend/build/"











