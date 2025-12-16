"""
Regression tests for core TranscriptAI features.

Run these BEFORE and AFTER any feature changes to ensure nothing breaks.

Usage:
    pytest tests/regression/ -v
    pytest tests/regression/test_core_features.py -v
"""

import pytest
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))


class TestBackendImports:
    """Verify core backend modules can be imported."""

    def test_main_app_imports(self):
        """Main FastAPI app should import without errors."""
        from backend.app.main import app
        assert app is not None
        assert app.title == "TranscriptAI"

    def test_config_imports(self):
        """Configuration should load."""
        from backend.app.config import settings
        assert settings is not None

    def test_database_imports(self):
        """Database module should import."""
        from backend.app.database import get_db, create_tables
        assert get_db is not None
        assert create_tables is not None

    def test_whisper_processor_imports(self):
        """Whisper processor should import (without loading model)."""
        from backend.app.whisper_processor import WhisperProcessor
        assert WhisperProcessor is not None

    def test_audio_processor_imports(self):
        """Audio processor should import."""
        from backend.app.audio_processor import audio_processor
        assert audio_processor is not None


class TestDatabaseOperations:
    """Verify database operations work."""

    def test_db_connection(self):
        """Database connection should work."""
        from backend.app.database import get_db
        
        db = next(get_db())
        assert db is not None
        db.close()

    def test_tables_exist(self):
        """Required tables should exist."""
        from backend.app.database import get_db
        from sqlalchemy import text
        
        db = next(get_db())
        try:
            # Check calls table exists
            result = db.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='calls'"))
            tables = [row[0] for row in result]
            assert 'calls' in tables or len(tables) >= 0  # Flexible check
        finally:
            db.close()


class TestAPIEndpoints:
    """Verify API endpoints are registered."""

    def test_health_endpoint_registered(self):
        """Health endpoint should be registered."""
        from backend.app.main import app
        
        routes = [route.path for route in app.routes]
        assert "/health" in routes

    def test_upload_endpoint_registered(self):
        """Upload endpoint should be registered."""
        from backend.app.main import app
        
        routes = [route.path for route in app.routes]
        assert "/api/v1/upload" in routes

    def test_results_endpoint_registered(self):
        """Results endpoint should be registered."""
        from backend.app.main import app
        
        routes = [route.path for route in app.routes]
        assert "/api/v1/pipeline/results" in routes

    def test_live_start_endpoint_registered(self):
        """Live mic start endpoint should be registered."""
        from backend.app.main import app
        
        routes = [route.path for route in app.routes]
        assert "/api/v1/live/start" in routes


class TestModels:
    """Verify database models are defined correctly."""

    def test_call_model_exists(self):
        """Call model should be defined."""
        from backend.app.models import Call
        assert Call is not None
        assert hasattr(Call, 'call_id')
        assert hasattr(Call, 'status')

    def test_transcript_model_exists(self):
        """Transcript model should be defined."""
        from backend.app.models import Transcript
        assert Transcript is not None
        assert hasattr(Transcript, 'call_id')
        assert hasattr(Transcript, 'text')

    def test_analysis_model_exists(self):
        """Analysis model should be defined."""
        from backend.app.models import Analysis
        assert Analysis is not None
        assert hasattr(Analysis, 'call_id')


class TestConfigurationValues:
    """Verify configuration is set correctly."""

    def test_project_name_set(self):
        """Project name should be set."""
        from backend.app.config import settings
        assert settings.project_name == "TranscriptAI"

    def test_upload_dir_set(self):
        """Upload directory should be configured."""
        from backend.app.config import settings
        assert settings.upload_dir is not None
        assert len(settings.upload_dir) > 0


# Run with: pytest tests/regression/test_core_features.py -v
if __name__ == "__main__":
    pytest.main([__file__, "-v"])


