#!/usr/bin/env bash
# Quick verification script to check if backend and frontend are running
# Usage: bash scripts/verify-running.sh

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     🔍 VERIFYING BACKEND AND FRONTEND STATUS                               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Backend
echo -e "${BLUE}Checking Backend (port $BACKEND_PORT)...${NC}"
if curl -s --max-time 2 "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running${NC}"
    
    # Get health status
    HEALTH_RESPONSE=$(curl -s "http://127.0.0.1:$BACKEND_PORT/health" 2>/dev/null || echo "{}")
    
    # Extract status using grep/sed (works without jq)
    STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    DB_STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"database":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    WHISPER_STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"status":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "unknown")
    
    echo -e "   Status: $STATUS"
    echo -e "   Database: $DB_STATUS"
    echo -e "   Whisper Model: $WHISPER_STATUS"
    
    if [ "$STATUS" = "healthy" ]; then
        echo -e "${GREEN}   ✅ Backend health check passed${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Backend health check returned: $STATUS${NC}"
    fi
else
    echo -e "${RED}❌ Backend is NOT running${NC}"
    echo -e "   Check if backend is started: bash scripts/start-backend.sh"
fi
echo ""

# Check Frontend
echo -e "${BLUE}Checking Frontend (port $FRONTEND_PORT)...${NC}"
if curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is running${NC}"
    echo -e "   URL: http://localhost:$FRONTEND_PORT"
else
    echo -e "${RED}❌ Frontend is NOT running${NC}"
    echo -e "   Check if frontend is started: cd frontend && npm run dev"
fi
echo ""

# Check Ports
echo -e "${BLUE}Checking Port Usage...${NC}"
BACKEND_PID=$(lsof -ti:$BACKEND_PORT 2>/dev/null || echo "")
FRONTEND_PID=$(lsof -ti:$FRONTEND_PORT 2>/dev/null || echo "")

if [ -n "$BACKEND_PID" ]; then
    echo -e "${GREEN}✅ Port $BACKEND_PORT: In use (PID: $BACKEND_PID)${NC}"
else
    echo -e "${YELLOW}⚠️  Port $BACKEND_PORT: Not in use${NC}"
fi

if [ -n "$FRONTEND_PID" ]; then
    echo -e "${GREEN}✅ Port $FRONTEND_PORT: In use (PID: $FRONTEND_PID)${NC}"
else
    echo -e "${YELLOW}⚠️  Port $FRONTEND_PORT: Not in use${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     📊 SUMMARY                                                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"

BACKEND_OK=false
FRONTEND_OK=false

if curl -s --max-time 2 "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null 2>&1; then
    BACKEND_OK=true
fi

if curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    FRONTEND_OK=true
fi

if [ "$BACKEND_OK" = true ] && [ "$FRONTEND_OK" = true ]; then
    echo -e "${GREEN}✅ Both backend and frontend are running!${NC}"
    echo ""
    echo -e "${GREEN}📊 Backend:  http://127.0.0.1:$BACKEND_PORT${NC}"
    echo -e "${GREEN}📊 Frontend: http://localhost:$FRONTEND_PORT${NC}"
    echo -e "${GREEN}📊 Health:   http://127.0.0.1:$BACKEND_PORT/health${NC}"
    exit 0
elif [ "$BACKEND_OK" = true ]; then
    echo -e "${YELLOW}⚠️  Backend is running, but frontend is not${NC}"
    exit 1
elif [ "$FRONTEND_OK" = true ]; then
    echo -e "${YELLOW}⚠️  Frontend is running, but backend is not${NC}"
    exit 1
else
    echo -e "${RED}❌ Neither backend nor frontend is running${NC}"
    echo ""
    echo -e "To start everything:"
    echo -e "  ${BLUE}bash scripts/start-all.sh${NC}"
    exit 1
fi



















