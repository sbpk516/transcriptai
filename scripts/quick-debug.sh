#!/bin/bash

# Quick Debug Script - TranscriptAI
# Comprehensive debugging for both frontend and backend

echo "🔍 Quick Debug - TranscriptAI"
echo "=========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "OK") echo -e "${GREEN}✅ $message${NC}" ;;
        "WARN") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "ERROR") echo -e "${RED}❌ $message${NC}" ;;
        "INFO") echo -e "${BLUE}ℹ️  $message${NC}" ;;
    esac
}

# Check 1: Directory
echo "📁 Checking directory..."
CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"/transcriptai" ]]; then
    print_status "OK" "Correct directory: $CURRENT_DIR"
else
    print_status "ERROR" "Wrong directory: $CURRENT_DIR"
    print_status "INFO" "Should be in: .../transcriptai"
    exit 1
fi

# Check 2: Git status
echo "📝 Checking Git status..."
if git status --porcelain | grep -q .; then
    print_status "WARN" "Uncommitted changes detected"
    git status --short
else
    print_status "OK" "Working directory clean"
fi

# Check 3: Frontend
echo "🎨 Checking Frontend..."
if [ -d "frontend" ]; then
    cd frontend
    
    # Check if in frontend directory
    if [ -f "package.json" ]; then
        print_status "OK" "Frontend directory found"
        
        # Check dependencies
        if [ -d "node_modules" ]; then
            print_status "OK" "Node modules installed"
        else
            print_status "ERROR" "Node modules missing"
            print_status "INFO" "Run: npm install"
        fi
        
        # Check TypeScript
        if npx tsc --noEmit > /dev/null 2>&1; then
            print_status "OK" "TypeScript compilation successful"
        else
            print_status "ERROR" "TypeScript compilation failed"
        fi
        
        # Check port 3000
        if lsof -i :3000 > /dev/null 2>&1; then
            print_status "WARN" "Port 3000 is in use"
            lsof -i :3000 | head -3
        else
            print_status "OK" "Port 3000 is available"
        fi
        
        # Test file resolution
        if curl -s http://localhost:3000/src/main.tsx | grep -q "import" 2>/dev/null; then
            print_status "OK" "Frontend files resolving correctly"
        else
            print_status "WARN" "Frontend files not resolving (server may not be running)"
        fi
        
    else
        print_status "ERROR" "package.json not found in frontend directory"
    fi
    
    cd ..
else
    print_status "ERROR" "Frontend directory not found"
fi

# Check 4: Backend
echo "⚙️  Checking Backend..."
if [ -d "backend" ]; then
    cd backend
    
    # Check Python imports
    if python -c "import app" 2>/dev/null; then
        print_status "OK" "Backend imports work"
    else
        print_status "ERROR" "Backend imports failed"
    fi
    
    # Check port 8000
    if lsof -i :8000 > /dev/null 2>&1; then
        print_status "WARN" "Port 8000 is in use"
        lsof -i :8000 | head -3
    else
        print_status "OK" "Port 8000 is available"
    fi
    
    # Test API health
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        print_status "OK" "Backend API responding"
    else
        print_status "WARN" "Backend API not responding (server may not be running)"
    fi
    
    cd ..
else
    print_status "ERROR" "Backend directory not found"
fi

# Check 5: Database
echo "🗄️  Checking Database..."
if command -v psql > /dev/null 2>&1; then
    if psql -d transcriptai -c "SELECT 1;" > /dev/null 2>&1; then
        print_status "OK" "Database connection successful"
    else
        print_status "WARN" "Database connection failed"
    fi
else
    print_status "INFO" "PostgreSQL not installed or not in PATH"
fi

# Check 6: Logs
echo "📋 Checking Logs..."
if [ -f "logs/transcriptai.log" ]; then
    print_status "OK" "Log file exists"
    echo "Last 5 log entries:"
    tail -5 logs/transcriptai.log
else
    print_status "WARN" "Log file not found"
fi

# Check 7: Environment
echo "🌍 Checking Environment..."
if [ -f ".env" ]; then
    print_status "OK" ".env file exists"
else
    print_status "WARN" ".env file not found"
fi

# Summary
echo ""
echo "🎯 QUICK FIXES:"
echo "==============="

# Frontend fixes
if [ -d "frontend" ]; then
    echo "Frontend:"
    echo "  cd frontend && npm run dev:safe"
    echo "  cd frontend && npm run restart"
    echo "  cd frontend && npm run clean"
fi

# Backend fixes
if [ -d "backend" ]; then
    echo "Backend:"
    echo "  cd backend && python -m uvicorn app.main:app --reload --port 8000"
    echo "  pkill -f uvicorn"
fi

# Port fixes
echo "Ports:"
echo "  lsof -i :3000 | awk 'NR>1 {print \$2}' | xargs kill -9"
echo "  lsof -i :8000 | awk 'NR>1 {print \$2}' | xargs kill -9"

# Emergency reset
echo "Emergency:"
echo "  git stash && git checkout main"
echo "  pkill -f vite && pkill -f uvicorn"

echo ""
print_status "INFO" "Debug check completed!"
print_status "INFO" "Use 'npm run check' in frontend directory for detailed frontend check"
