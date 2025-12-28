#!/bin/bash

# Database Setup Script for TranscriptAI
# This script helps set up either PostgreSQL or SQLite database

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TranscriptAI Database Setup${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ .env file not found. Creating from env.example...${NC}"
    if [ -f "env.example" ]; then
        cp env.example .env
        echo -e "${GREEN}✓ Created .env file${NC}"
    else
        echo -e "${RED}✗ env.example not found${NC}"
        exit 1
    fi
fi

echo "Choose database type:"
echo "1) PostgreSQL (requires PostgreSQL installed)"
echo "2) SQLite (no setup required, recommended for development)"
echo ""
read -p "Enter choice [1-2] (default: 2): " db_choice
db_choice=${db_choice:-2}

if [ "$db_choice" = "1" ]; then
    echo ""
    echo -e "${YELLOW}Setting up PostgreSQL...${NC}"
    
    # Check if PostgreSQL is installed
    if ! command -v psql &> /dev/null; then
        echo -e "${RED}✗ PostgreSQL (psql) not found${NC}"
        echo "Please install PostgreSQL first:"
        echo "  macOS: brew install postgresql@15"
        echo "  Linux: sudo apt-get install postgresql postgresql-contrib"
        exit 1
    fi
    
    # Check if PostgreSQL is running
    if ! pg_isready -h localhost -p 5432 &> /dev/null; then
        echo -e "${YELLOW}⚠ PostgreSQL server is not running${NC}"
        echo "Please start PostgreSQL:"
        echo "  macOS: brew services start postgresql@15"
        echo "  Linux: sudo systemctl start postgresql"
        exit 1
    fi
    
    echo -e "${GREEN}✓ PostgreSQL is running${NC}"
    
    # Create database and user
    DB_NAME="transcriptai"
    DB_USER="transcriptai"
    DB_PASSWORD="transcriptai123"
    
    echo ""
    echo "Creating PostgreSQL database and user..."
    echo "Database: $DB_NAME"
    echo "User: $DB_USER"
    echo ""
    
    # Create user (ignore error if exists)
    psql -h localhost -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || echo "User may already exist"
    
    # Create database (ignore error if exists)
    psql -h localhost -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || echo "Database may already exist"
    
    # Grant privileges
    psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
    
    # Update .env file
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME|" .env
    rm -f .env.bak
    
    echo -e "${GREEN}✓ PostgreSQL database setup complete!${NC}"
    echo ""
    echo "Database URL: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
    
elif [ "$db_choice" = "2" ]; then
    echo ""
    echo -e "${YELLOW}Setting up SQLite...${NC}"
    
    # Determine SQLite database path
    DATA_DIR="${TRANSCRIPTAI_DATA_DIR:-$HOME/Library/Application Support/TranscriptAI}"
    DB_PATH="$DATA_DIR/transcriptai.db"
    
    # Create directory if it doesn't exist
    mkdir -p "$DATA_DIR"
    
    # Update .env file to use SQLite
    if grep -q "^DATABASE_URL=" .env; then
        sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///$DB_PATH|" .env
        rm -f .env.bak
    else
        echo "DATABASE_URL=sqlite:///$DB_PATH" >> .env
    fi
    
    echo -e "${GREEN}✓ SQLite database setup complete!${NC}"
    echo ""
    echo "Database path: $DB_PATH"
    echo ""
    echo -e "${YELLOW}Note: SQLite is perfect for development.${NC}"
    echo "For production, consider using PostgreSQL."
    
else
    echo -e "${RED}✗ Invalid choice${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Database setup complete!${NC}"
echo ""
echo "You can now start the backend:"
echo "  cd backend && npm run dev"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"






































