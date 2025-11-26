#!/bin/bash

# Master Test Runner for Push-to-Talk Feature
# Runs all phase tests and identifies breaking points

set +e  # Don't exit on first failure, we want to see all results

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "  Push-to-Talk Feature - Master Test Suite"
echo "═══════════════════════════════════════════════════════════"
echo -e "${NC}"

# Phase tracking
declare -a PHASES=(
  "Phase 1: Key Detection"
  "Phase 2: Permission Flow"
  "Phase 3: IPC Bridge"
  "Phase 4: Frontend Recording"
  "Phase 5: Audio Processing"
  "Phase 6: Backend Transcription"
  "Phase 7: Text Insertion"
)

declare -a PHASE_SCRIPTS=(
  "test-phase1-keys.js"
  "test-phase2-permissions.js"
  "test-phase3-ipc.js"
  "test-phase4-recording.js"
  "test-phase5-upload.js"
  "test-phase6-backend.js"
  "test-phase7-insertion.js"
)

TOTAL_PHASES=${#PHASES[@]}
PASSED_PHASES=0
FIRST_FAILURE=""
FIRST_FAILURE_PHASE=""

# Pre-flight checks
echo -e "${YELLOW}Pre-flight Checks:${NC}"

# Check if TranscriptAI is running
if pgrep -f "TranscriptAI" > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} TranscriptAI app is running"
else
  echo -e "${RED}✗${NC} TranscriptAI app is NOT running"
  echo -e "${YELLOW}→${NC} Please start the TranscriptAI desktop app first"
  echo ""
  echo "Aborting test run..."
  exit 1
fi

# Check if dictation is enabled
SETTINGS_FILE="$HOME/Library/Application Support/transcriptai/dictation-settings.json"
if [ -f "$SETTINGS_FILE" ]; then
  if grep -q '"enabled": *true' "$SETTINGS_FILE"; then
    echo -e "${GREEN}✓${NC} Dictation is enabled"
  else
    echo -e "${RED}✗${NC} Dictation is disabled"
    echo -e "${YELLOW}→${NC} Enable dictation in Settings before running tests"
    exit 1
  fi
else
  echo -e "${YELLOW}!${NC} Dictation settings file not found"
  echo -e "${YELLOW}→${NC} Open Settings and configure dictation first"
  exit 1
fi

# Check if node is available
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗${NC} Node.js is not installed or not in PATH"
  exit 1
fi

echo -e "${GREEN}✓${NC} Node.js is available"
echo ""

# Instructions
echo -e "${BLUE}${BOLD}Test Instructions:${NC}"
echo "1. Keep the TranscriptAI app running in the background"
echo "2. Some tests require manual interaction (pressing keys, speaking)"
echo "3. Open browser DevTools in TranscriptAI for Phases 4-7 (Cmd+Option+I)"
echo "4. Have a text editor open (TextEdit, Notes) for Phase 7"
echo ""
echo -e "${YELLOW}Press ENTER when ready to begin testing...${NC}"
read -r

# Run each phase
for i in "${!PHASES[@]}"; do
  PHASE_NUM=$((i + 1))
  PHASE_NAME="${PHASES[$i]}"
  PHASE_SCRIPT="${PHASE_SCRIPTS[$i]}"
  
  echo ""
  echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}${BOLD}Running: ${PHASE_NAME}${NC}"
  echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # Run the phase test
  node "$SCRIPT_DIR/$PHASE_SCRIPT"
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ ${PHASE_NAME} PASSED${NC}"
    PASSED_PHASES=$((PASSED_PHASES + 1))
  else
    echo -e "${RED}✗ ${PHASE_NAME} FAILED${NC}"
    if [ -z "$FIRST_FAILURE" ]; then
      FIRST_FAILURE="$PHASE_SCRIPT"
      FIRST_FAILURE_PHASE="$PHASE_NAME"
    fi
    
    # Ask if user wants to continue
    echo ""
    echo -e "${YELLOW}Phase $PHASE_NUM failed. Continue to next phase? (y/n)${NC}"
    read -r -n 1 CONTINUE
    echo ""
    
    if [[ ! $CONTINUE =~ ^[Yy]$ ]]; then
      echo "Stopping test run at user request."
      break
    fi
  fi
done

# Final Summary
echo ""
echo -e "${BLUE}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "  Test Run Complete - Summary"
echo "═══════════════════════════════════════════════════════════"
echo -e "${NC}"

echo -e "${YELLOW}Results:${NC}"
echo "  Total Phases: $TOTAL_PHASES"
echo "  Passed: ${GREEN}$PASSED_PHASES${NC}"
echo "  Failed: ${RED}$((TOTAL_PHASES - PASSED_PHASES))${NC}"
echo ""

if [ $PASSED_PHASES -eq $TOTAL_PHASES ]; then
  echo -e "${GREEN}${BOLD}🎉 ALL PHASES PASSED!${NC}"
  echo -e "${GREEN}The push-to-talk feature appears to be working correctly.${NC}"
  exit 0
else
  if [ -n "$FIRST_FAILURE_PHASE" ]; then
    echo -e "${RED}${BOLD}Breaking Point:${NC}"
    echo -e "  Phase: ${RED}$FIRST_FAILURE_PHASE${NC}"
    echo -e "  Script: $FIRST_FAILURE"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Review the test output above to see which specific test failed"
    echo "  2. Check the relevant logs for that phase"
    echo "  3. Fix the identified issue"
    echo "  4. Re-run this test suite to verify the fix"
    echo ""
    echo -e "${YELLOW}Detailed Investigation:${NC}"
    echo "  Run the failing phase individually:"
    echo -e "  ${BLUE}node $SCRIPT_DIR/$FIRST_FAILURE${NC}"
    echo ""
    echo "  Check logs:"
    echo -e "  ${BLUE}tail -f ~/Library/Application\\ Support/transcriptai/logs/desktop.log${NC}"
  fi
  
  exit 1
fi

