"""
Utility to clear all rows from TranscriptAI database tables without dropping them.

Usage:
  python backend/scripts/clear_db.py

This issues a TRUNCATE ... RESTART IDENTITY CASCADE on all ORM tables defined
in backend.app.models, preserving the schema while removing all data and
resetting autoincrement IDs.
"""
from sqlalchemy import text
import sys
from pathlib import Path

# Ensure project root is on sys.path so `backend` package is importable
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.database import Base, engine
from backend.app import models as _models  # ensure models are registered with Base


def main() -> None:
    # Collect table names from SQLAlchemy metadata
    table_names = [t.name for t in Base.metadata.sorted_tables]
    if not table_names:
        print("[DB-CLEAR] No tables found in metadata. Nothing to clear.")
        return

    # Build TRUNCATE statement (quoted identifiers for safety)
    table_list = ", ".join(f'"{name}"' for name in table_names)
    stmt = text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE;")

    print(f"[DB-CLEAR] Truncating tables: {', '.join(table_names)}")
    with engine.begin() as conn:
        conn.execute(stmt)
    print("[DB-CLEAR] Done. All rows removed and identities reset.")


if __name__ == "__main__":
    main()
