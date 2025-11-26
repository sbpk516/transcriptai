#!/bin/bash

# Push-to-Talk Debug Script
# This script helps diagnose issues with the dictation feature

# Note: We don't use 'set -e' because this is a diagnostic script
# that should continue checking all components even if some checks fail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Push-to-Talk Diagnostic Tool${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. Check if TranscriptAI is running
echo -e "${BLUE}[1/8]${NC} Checking if TranscriptAI desktop app is running..."
if pgrep -f "TranscriptAI" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} TranscriptAI is running"
else
    echo -e "${RED}✗${NC} TranscriptAI is NOT running"
    echo -e "${YELLOW}→${NC} Please start the TranscriptAI desktop app first"
    echo -e "${YELLOW}→${NC} Note: Some checks will still run to show configuration status"
    echo ""
fi
echo ""

# 2. Check dictation settings file
echo -e "${BLUE}[2/8]${NC} Checking dictation settings..."
SETTINGS_FILE="$HOME/Library/Application Support/transcriptai/dictation-settings.json"
if [ -f "$SETTINGS_FILE" ]; then
    echo -e "${GREEN}✓${NC} Settings file exists"
    echo -e "${YELLOW}Contents:${NC}"
    cat "$SETTINGS_FILE" | python3 -m json.tool 2>/dev/null || cat "$SETTINGS_FILE"
    
    # Check if enabled
    if grep -q '"enabled": *true' "$SETTINGS_FILE"; then
        echo -e "${GREEN}✓${NC} Dictation is enabled"
    else
        echo -e "${RED}✗${NC} Dictation is disabled"
        echo -e "${YELLOW}→${NC} Enable it in Settings"
    fi
    
    # Extract shortcut
    SHORTCUT=$(grep -o '"shortcut": *"[^"]*"' "$SETTINGS_FILE" | cut -d'"' -f4)
    echo -e "${YELLOW}Configured shortcut:${NC} $SHORTCUT"
else
    echo -e "${RED}✗${NC} Settings file not found at: $SETTINGS_FILE"
    echo -e "${YELLOW}→${NC} Settings may not have been initialized yet"
fi
echo ""

# 3. Check macOS Accessibility permissions
echo -e "${BLUE}[3/8]${NC} Checking macOS Accessibility permissions..."
# This requires tccutil or manual check
if command -v tccutil &> /dev/null; then
    echo -e "${YELLOW}→${NC} Please manually verify:"
    echo "   System Preferences → Security & Privacy → Privacy → Accessibility"
    echo "   TranscriptAI should be listed and enabled"
else
    echo -e "${YELLOW}→${NC} Cannot auto-check. Please manually verify:"
    echo "   System Preferences → Security & Privacy → Privacy → Accessibility"
    echo "   TranscriptAI should be listed and enabled"
fi
echo ""

# 4. Check macOS Microphone permissions  
echo -e "${BLUE}[4/8]${NC} Checking macOS Microphone permissions..."
echo -e "${YELLOW}→${NC} Please manually verify:"
echo "   System Preferences → Security & Privacy → Privacy → Microphone"
echo "   TranscriptAI should be listed and enabled"
echo ""

# 5. Check desktop logs for recent activity
echo -e "${BLUE}[5/8]${NC} Checking recent desktop logs..."
# Check both possible locations (dev uses transcriptai, prod uses transcriptai-desktop)
DESKTOP_LOG_PROD="$HOME/Library/Application Support/transcriptai-desktop/logs/desktop.log"
DESKTOP_LOG_DEV="$HOME/Library/Application Support/transcriptai/logs/desktop.log"

if [ -f "$DESKTOP_LOG_PROD" ]; then
    DESKTOP_LOG="$DESKTOP_LOG_PROD"
elif [ -f "$DESKTOP_LOG_DEV" ]; then
    DESKTOP_LOG="$DESKTOP_LOG_DEV"
else
    DESKTOP_LOG=""
fi
if [ -n "$DESKTOP_LOG" ] && [ -f "$DESKTOP_LOG" ]; then
    echo -e "${GREEN}✓${NC} Desktop log exists at: $DESKTOP_LOG"
    
    # Check for dictation manager start
    if tail -n 100 "$DESKTOP_LOG" | grep -q "dictation_manager_start"; then
        echo -e "${GREEN}✓${NC} Dictation manager was started"
    else
        echo -e "${YELLOW}!${NC} No recent dictation manager start found"
    fi
    
    # Check for key detection
    KEY_COUNT=$(tail -n 100 "$DESKTOP_LOG" | grep -c "key down detected" || echo "0")
    if [ "$KEY_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Key presses detected (last 100 lines: $KEY_COUNT events)"
    else
        echo -e "${RED}✗${NC} No key presses detected in recent logs"
        echo -e "${YELLOW}→${NC} This suggests keys are not being captured by the global listener"
    fi
    
    # Check for shortcut satisfaction
    if tail -n 100 "$DESKTOP_LOG" | grep -q "shortcut satisfied"; then
        echo -e "${GREEN}✓${NC} Shortcut combination was satisfied"
    else
        echo -e "${YELLOW}!${NC} No recent shortcut satisfaction found"
    fi
    
    # Check for permission flow
    if tail -n 100 "$DESKTOP_LOG" | grep -q "dictation_permission"; then
        echo -e "${GREEN}✓${NC} Permission flow was triggered"
        
        if tail -n 100 "$DESKTOP_LOG" | grep -q "dictation_permission_autogranted"; then
            echo -e "${GREEN}✓${NC} Permission was auto-granted"
        else
            echo -e "${YELLOW}!${NC} Permission request found but not auto-granted"
        fi
    else
        echo -e "${YELLOW}!${NC} No recent permission flow found"
    fi
    
    # Check for press-end events
    END_COUNT=$(tail -n 100 "$DESKTOP_LOG" | grep -c "dictation_event_end" || echo "0")
    if [ "$END_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Press-end events detected (count: $END_COUNT)"
    else
        echo -e "${YELLOW}!${NC} No press-end events in recent logs"
        echo -e "${YELLOW}→${NC} Keys may not be releasing properly, or keyup not detected"
    fi
    
    # Check for errors
    ERROR_COUNT=$(tail -n 100 "$DESKTOP_LOG" | grep -c "error" || echo "0")
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "${RED}!${NC} Errors found in logs (count: $ERROR_COUNT)"
        echo -e "${YELLOW}Recent errors:${NC}"
        tail -n 100 "$DESKTOP_LOG" | grep "error" | tail -n 5
    fi
else
    echo -e "${RED}✗${NC} Desktop log not found at: $DESKTOP_LOG"
fi
echo ""

# 6. Check backend health
echo -e "${BLUE}[6/8]${NC} Checking backend health..."
# Try common ports with timeout
for PORT in 8001 8011 8021; do
    if curl --max-time 3 -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Backend is responding on port $PORT"
        BACKEND_PORT=$PORT
        break
    fi
done

if [ -z "$BACKEND_PORT" ]; then
    echo -e "${RED}✗${NC} Backend is not responding on common ports"
    echo -e "${YELLOW}→${NC} Backend may not be started"
else
    # Check if dictation endpoint exists
    HTTP_CODE=$(curl --max-time 3 -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$BACKEND_PORT/api/v1/dictation/transcribe" \
        -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "422" || "$HTTP_CODE" == "400" ]]; then
        echo -e "${GREEN}✓${NC} Dictation endpoint is accessible (port $BACKEND_PORT)"
    elif [[ "$HTTP_CODE" == "000" ]]; then
        echo -e "${YELLOW}!${NC} Dictation endpoint check timed out"
    else
        echo -e "${YELLOW}!${NC} Dictation endpoint returned unexpected status: $HTTP_CODE"
    fi
fi
echo ""

# 7. Check for nut-js and global key listener modules
echo -e "${BLUE}[7/8]${NC} Checking native modules..."
# Resolve script directory and desktop path properly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/../desktop"
if [ -d "$DESKTOP_DIR/node_modules" ]; then
    if [ -d "$DESKTOP_DIR/node_modules/@nut-tree-fork" ]; then
        echo -e "${GREEN}✓${NC} @nut-tree-fork/nut-js is installed"
    else
        echo -e "${RED}✗${NC} @nut-tree-fork/nut-js is NOT installed"
    fi
    
    if [ -d "$DESKTOP_DIR/node_modules/node-global-key-listener" ]; then
        echo -e "${GREEN}✓${NC} node-global-key-listener is installed"
    else
        echo -e "${RED}✗${NC} node-global-key-listener is NOT installed"
    fi
else
    echo -e "${YELLOW}!${NC} Cannot verify modules (desktop/node_modules not found)"
fi
echo ""

# 8. Live log monitoring instructions
echo -e "${BLUE}[8/8]${NC} Live monitoring setup"
echo -e "${YELLOW}To monitor logs in real-time while testing:${NC}"
echo ""
echo "Terminal 1 (Desktop logs):"
echo -e "${GREEN}tail -f \"$DESKTOP_LOG\" | grep -E '(key|shortcut|permission|dictation_event)'${NC}"
echo ""
echo "Terminal 2 (Browser console):"
echo "Open DevTools in TranscriptAI → Console tab → Filter by 'DictationController'"
echo ""
echo "Terminal 3 (Backend logs):"
BACKEND_LOG="$HOME/Library/Application Support/transcriptai/transcriptai_data/logs/transcriptai.log"
if [ -f "$BACKEND_LOG" ]; then
    echo -e "${GREEN}tail -f \"$BACKEND_LOG\" | grep -i transcrib${NC}"
else
    echo -e "${YELLOW}Backend log location: ${NC}$BACKEND_LOG"
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary & Next Steps${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}1.${NC} Try the Push-to-Talk feature now:"
echo "   - Hold CMD+Option keys"
echo "   - Say something"
echo "   - Release keys"
echo ""
echo -e "${YELLOW}2.${NC} While testing, run in another terminal:"
echo -e "   ${GREEN}tail -f \"$DESKTOP_LOG\" | grep -E '(key|shortcut|permission|event)'${NC}"
echo ""
echo -e "${YELLOW}3.${NC} Report what you see in the logs:"
echo "   - Do you see 'key down detected'? → Keys are being captured ✓"
echo "   - Do you see 'shortcut satisfied'? → Combination recognized ✓"
echo "   - Do you see 'dictation_event_start'? → Recording should start ✓"
echo "   - Do you see 'dictation_event_end'? → Recording should stop ✓"
echo ""
echo -e "${YELLOW}4.${NC} Check the testing guide for detailed analysis:"
echo "   docs/PUSH_TO_TALK_TESTING_GUIDE.md"
echo ""

