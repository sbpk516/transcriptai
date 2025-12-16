"""
Pytest configuration for regression tests.
"""

import pytest
import os
import sys

# Add backend to Python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND_DIR = os.path.join(ROOT_DIR, 'backend')

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


@pytest.fixture(scope="session")
def app():
    """Get FastAPI app instance."""
    from backend.app.main import app
    return app


@pytest.fixture(scope="session")
def settings():
    """Get application settings."""
    from backend.app.config import settings
    return settings


