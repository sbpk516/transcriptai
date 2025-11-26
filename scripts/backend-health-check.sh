#!/bin/bash

# Backend Health Check Script
# Run this before starting backend development to prevent issues

echo "🔍 Backend Health Check - TranscriptAI"
echo "==================================="

# Check 1: Directory
echo "📁 Checking directory..."
CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"/backend" ]]; then
    echo "✅ Correct directory: $CURRENT_DIR"
else
    echo "❌ Wrong directory: $CURRENT_DIR"
    echo "   Should be in: .../transcriptai/backend"
    echo "   Run: cd backend"
    exit 1
fi

# Check 2: Python environment
echo "🐍 Checking Python environment..."
if command -v python > /dev/null 2>&1; then
    PYTHON_VERSION=$(python --version 2>&1)
    echo "✅ Python found: $PYTHON_VERSION"
else
    echo "❌ Python not found"
    echo "   Install Python 3.8+"
    exit 1
fi

# Check 3: Critical files
echo "📄 Checking critical files..."
if [ -f "app/main.py" ] && [ -f "requirements.txt" ]; then
    echo "✅ All critical files exist"
else
    echo "❌ Missing critical files:"
    [ -f "app/main.py" ] || echo "   - app/main.py"
    [ -f "requirements.txt" ] || echo "   - requirements.txt"
    exit 1
fi

# Check 4: Dependencies
echo "📦 Checking dependencies..."
if pip show fastapi > /dev/null 2>&1; then
    echo "✅ FastAPI installed"
else
    echo "❌ FastAPI not installed"
    echo "   Run: pip install -r requirements.txt"
    exit 1
fi

if pip show uvicorn > /dev/null 2>&1; then
    echo "✅ Uvicorn installed"
else
    echo "❌ Uvicorn not installed"
    echo "   Run: pip install -r requirements.txt"
    exit 1
fi

# Check 5: Python imports
echo "🔧 Checking Python imports..."
if python -c "import app" 2>/dev/null; then
    echo "✅ Backend imports work"
else
    echo "❌ Backend imports failed"
    echo "   Check app/__init__.py exists"
    exit 1
fi

if python -c "from app.main import app" 2>/dev/null; then
    echo "✅ FastAPI app imports work"
else
    echo "❌ FastAPI app import failed"
    echo "   Check app/main.py has 'app' variable"
    exit 1
fi

# Check 6: Port availability
echo "🌐 Checking port 8000..."
if lsof -i :8000 > /dev/null 2>&1; then
    echo "⚠️  Port 8000 is in use"
    echo "   Run: pkill -f uvicorn"
else
    echo "✅ Port 8000 is available"
fi

# Check 7: Database connection (if applicable)
echo "🗄️  Checking database..."
if command -v psql > /dev/null 2>&1; then
    if psql -d transcriptai -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ Database connection successful"
    else
        echo "⚠️  Database connection failed"
        echo "   Check PostgreSQL is running and transcriptai database exists"
    fi
else
    echo "ℹ️  PostgreSQL not installed or not in PATH"
fi

# Check 8: Log directory
echo "📋 Checking logs..."
if [ -d "../logs" ]; then
    echo "✅ Log directory exists"
else
    echo "⚠️  Log directory missing"
    echo "   Run: mkdir -p ../logs"
fi

echo ""
echo "🎉 Health check completed!"
echo "🚀 Ready to start development: python -m uvicorn app.main:app --reload --port 8000"
