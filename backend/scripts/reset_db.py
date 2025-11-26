"""
Utility to drop and recreate all database tables for TranscriptAI.

Usage:
  python backend/scripts/reset_db.py

Reads configuration from the existing .env via pydantic settings used by
backend.app.config and backend.app.database. Requires the database server
to be reachable with the configured credentials.
"""
import sys
from pathlib import Path

# Ensure project root is on sys.path so `backend` package is importable
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.database import drop_tables, create_tables
# Ensure models are registered with SQLAlchemy Base before (re)creating tables
from backend.app import models as _models  # noqa: F401

def main() -> None:
    print("[DB-RESET] Dropping all tables...")
    drop_tables()
    print("[DB-RESET] Creating tables...")
    create_tables()
    print("[DB-RESET] Done. Database schema has been reset.")

if __name__ == "__main__":
    main()
