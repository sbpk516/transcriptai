#!/bin/bash

# Frontend Health Check Script
# Run this before starting development to prevent issues

echo "🔍 Frontend Health Check - TranscriptAI"
echo "======================================"

# Check 1: Directory
echo "📁 Checking directory..."
CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"/frontend" ]]; then
    echo "✅ Correct directory: $CURRENT_DIR"
else
    echo "❌ Wrong directory: $CURRENT_DIR"
    echo "   Should be in: .../transcriptai/frontend"
    echo "   Run: cd frontend"
    exit 1
fi

# Check 2: Critical files
echo "📄 Checking critical files..."
if [ -f "src/main.tsx" ] && [ -f "src/App.tsx" ] && [ -f "package.json" ]; then
    echo "✅ All critical files exist"
else
    echo "❌ Missing critical files:"
    [ -f "src/main.tsx" ] || echo "   - src/main.tsx"
    [ -f "src/App.tsx" ] || echo "   - src/App.tsx"
    [ -f "package.json" ] || echo "   - package.json"
    exit 1
fi

# Check 3: Dependencies
echo "📦 Checking dependencies..."
if npm list react react-dom > /dev/null 2>&1; then
    echo "✅ React dependencies installed"
else
    echo "❌ Missing React dependencies"
    echo "   Run: npm install"
    exit 1
fi

# Check 4: TypeScript compilation
echo "🔧 Checking TypeScript..."
if npx tsc --noEmit > /dev/null 2>&1; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
    echo "   Run: npx tsc --noEmit"
    exit 1
fi

# Check 5: Port availability
echo "🌐 Checking port 3000..."
if lsof -i :3000 > /dev/null 2>&1; then
    echo "⚠️  Port 3000 is in use"
    echo "   Run: pkill -f vite"
else
    echo "✅ Port 3000 is available"
fi

echo ""
echo "🎉 Health check completed!"
echo "🚀 Ready to start development: npx vite --port 3000"
