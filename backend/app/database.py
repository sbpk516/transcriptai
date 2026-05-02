"""
Database connection and session management.
"""
import logging
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import get_database_url

logger = logging.getLogger("transcriptai.database")

# Create database engine
db_url = get_database_url()
engine_kwargs = {
    "pool_pre_ping": True,
    # Enable verbose SQL logging only if explicitly requested
    "echo": os.getenv("SQLALCHEMY_ECHO", "0") == "1",
}

# For SQLite (desktop mode), allow connections across threads used by Uvicorn
if db_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(db_url, **engine_kwargs)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create base class for models
Base = declarative_base()


def get_db():
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create all database tables, then run idempotent column migrations."""
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()


_LIGHTWEIGHT_MIGRATIONS = (
    # (table, column, ddl_fragment)
    ("transcripts", "rephrased_text", "ADD COLUMN rephrased_text TEXT"),
)


def _run_lightweight_migrations() -> None:
    """Apply additive ALTER TABLE migrations idempotently. SQLite-friendly."""
    for table, column, ddl in _LIGHTWEIGHT_MIGRATIONS:
        try:
            with engine.connect() as conn:
                conn.execute(text(f"ALTER TABLE {table} {ddl}"))
                conn.commit()
            logger.info(f"applied migration: {table}.{column}")
        except Exception as exc:
            msg = str(exc).lower()
            if "duplicate column" in msg or "already exists" in msg:
                continue  # already migrated
            logger.warning(f"migration {table}.{column} skipped: {exc}")


def drop_tables():
    """Drop all database tables."""
    Base.metadata.drop_all(bind=engine)
