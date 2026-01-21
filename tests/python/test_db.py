#!/usr/bin/env python3
"""
Simple database connection test.
"""
import os
from sqlalchemy import create_engine, text

# Database URL
DATABASE_URL = "postgresql://signalhub:signalhub123@localhost:5432/signalhub"

def test_database_connection():
    """Test database connection."""
    print("🔍 Testing database connection...")
    print(f"Database URL: {DATABASE_URL}")
    
    try:
        # Create engine
        engine = create_engine(DATABASE_URL, echo=True)
        
        # Test connection
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("✅ Database connection successful!")
            print(f"Result: {result.fetchone()}")
            return True
            
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print(f"Error type: {type(e).__name__}")
        return False

def test_environment():
    """Test environment variables."""
    print("\n🔍 Testing environment...")
    
    # Check if .env file exists
    if os.path.exists(".env"):
        print("✅ .env file exists")
    else:
        print("❌ .env file missing")
    
    # Check DATABASE_URL environment variable
    db_url_env = os.getenv("DATABASE_URL")
    if db_url_env:
        print(f"✅ DATABASE_URL from environment: {db_url_env}")
    else:
        print("⚠️ DATABASE_URL not set in environment")

if __name__ == "__main__":
    test_environment()
    test_database_connection()
