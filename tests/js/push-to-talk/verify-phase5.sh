#!/bin/bash

# Phase 5 Programmatic Verification Script
# Checks if audio chunks are captured, snippet created, and upload initiated

set +e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}${BOLD}Phase 5 Diagnostic Test${NC}"
echo "This test will verify audio upload is working"
echo ""

# Get desktop log path
LOG_PATH="$HOME/Library/Application Support/transcriptai-desktop/logs/desktop.log"

if [ ! -f "$LOG_PATH" ]; then
  echo -e "${RED}✗${NC} Desktop log not found"
  exit 1
fi

echo -e "${YELLOW}Instructions:${NC}"
echo "1. Make sure TranscriptAI app is running with DevTools open (Cmd+Option+I)"
echo "2. Clear the browser console (optional but recommended)"
echo "3. Perform dictation: Hold CMD+Option, speak 'test', release"
echo "4. Wait 3 seconds"
echo ""
echo -e "${YELLOW}Press ENTER when you've completed the dictation...${NC}"
read -r

echo ""
echo -e "${BLUE}Analyzing logs and console output...${NC}"
echo ""

# Check recent logs for Phase 5 activity
echo -e "${YELLOW}[BACKEND] Checking if events were sent:${NC}"

if tail -n 50 "$LOG_PATH" | grep -q "dictation_event_start"; then
  echo -e "${GREEN}✓${NC} Press-start event sent"
else
  echo -e "${RED}✗${NC} No press-start event found"
fi

if tail -n 50 "$LOG_PATH" | grep -q "dictation_event_end"; then
  echo -e "${GREEN}✓${NC} Press-end event sent"
else
  echo -e "${RED}✗${NC} No press-end event found"
fi

echo ""
echo -e "${YELLOW}[FRONTEND] Check browser console for these messages:${NC}"
echo ""
echo "Expected logs in sequence:"
echo -e "  ${GREEN}1.${NC} '[PHASE 5 DIAGNOSTIC] Building snippet from chunks'"
echo "     - Should show chunkCount, chunkSizes, totalBytes"
echo ""
echo -e "  ${GREEN}2.${NC} '[PHASE 5] snippet prepared for upload'"
echo "     - Should show sizeBytes, durationMs, requestId"
echo ""
echo -e "  ${GREEN}3.${NC} '[PHASE 5] dictation upload started'"
echo "     - Should show requestId, sizeBytes, base64Length"
echo ""
echo -e "  ${GREEN}4.${NC} '[PHASE 5->6->7] dictation upload succeeded'"
echo "     - Should show transcript text"
echo ""
echo -e "${YELLOW}Common Phase 5 Issues:${NC}"
echo ""
echo -e "${RED}If you see 'chunkCount: 0':${NC}"
echo "  → Audio chunks not being captured"
echo "  → Check Phase 4 (recording)"
echo ""
echo -e "${RED}If you see 'No audio chunks available for upload':${NC}"
echo "  → Chunks were cleared before snippet creation"
echo "  → This should be fixed by the chunk capture fix"
echo ""
echo -e "${RED}If snippet prepared but no 'upload started':${NC}"
echo "  → Issue in startSnippetUpload function"
echo "  → Check for JavaScript errors in console"
echo ""
echo -e "${RED}If upload started but never succeeded:${NC}"
echo "  → Check Network tab for POST to /api/v1/dictation/transcribe"
echo "  → Check backend logs for transcription errors"
echo "  → Verify backend is running (should be green)"
echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo "Please check your browser console and report:"
echo "1. Which messages you see"
echo "2. Any error messages"
echo "3. The values shown (chunkCount, sizeBytes, etc.)"
echo -e "${BLUE}════════════════════════════════════════${NC}"

