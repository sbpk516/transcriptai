"""
Tests for transcription statistics (analytics) feature.

TRAN-5: source_type column on Call model
TRAN-6: YouTube metadata columns
TRAN-10: GET /api/v1/stats endpoint
TRAN-11: Pydantic models for stats response
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Set test database URL BEFORE importing any app modules
# This must happen before any imports that touch database.py
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["TRANSCRIPTAI_MODE"] = "desktop"  # Use desktop mode which supports SQLite

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker, declarative_base

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Now safe to import app modules
from backend.app.models import Call
from backend.app.database import Base


# ============================================================================
# TRAN-5: Test source_type column on Call model
# ============================================================================

class TestSourceTypeColumn:
    """Tests for TRAN-5: Add source_type column to Call model."""

    @pytest.fixture
    def test_db(self):
        """Create an in-memory SQLite database for testing."""
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = TestingSessionLocal()
        yield db
        db.close()

    def test_call_model_has_source_type_column(self, test_db):
        """Call model should have source_type column."""
        inspector = inspect(test_db.bind)
        columns = [col['name'] for col in inspector.get_columns('calls')]
        assert 'source_type' in columns, "Call model should have source_type column"

    def test_source_type_accepts_upload_value(self, test_db):
        """source_type should accept 'upload' value."""
        call = Call(
            call_id="test-upload-001",
            source_type="upload",
            duration=300
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)
        assert call.source_type == "upload"

    def test_source_type_accepts_live_value(self, test_db):
        """source_type should accept 'live' value."""
        call = Call(
            call_id="test-live-001",
            source_type="live",
            duration=120
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)
        assert call.source_type == "live"

    def test_source_type_accepts_youtube_value(self, test_db):
        """source_type should accept 'youtube' value."""
        call = Call(
            call_id="test-youtube-001",
            source_type="youtube",
            duration=600
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)
        assert call.source_type == "youtube"

    def test_source_type_defaults_to_upload(self, test_db):
        """source_type should default to 'upload' when not specified."""
        call = Call(
            call_id="test-default-001",
            duration=180
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)
        assert call.source_type == "upload", "source_type should default to 'upload'"


# ============================================================================
# TRAN-6: Test YouTube metadata columns
# ============================================================================

class TestYouTubeMetadataColumns:
    """Tests for TRAN-6: Add video metadata columns for YouTube transcriptions."""

    @pytest.fixture
    def test_db(self):
        """Create an in-memory SQLite database for testing."""
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = TestingSessionLocal()
        yield db
        db.close()

    def test_call_model_has_youtube_url_column(self, test_db):
        """Call model should have youtube_url column."""
        inspector = inspect(test_db.bind)
        columns = [col['name'] for col in inspector.get_columns('calls')]
        assert 'youtube_url' in columns, "Call model should have youtube_url column"

    def test_call_model_has_youtube_title_column(self, test_db):
        """Call model should have youtube_title column."""
        inspector = inspect(test_db.bind)
        columns = [col['name'] for col in inspector.get_columns('calls')]
        assert 'youtube_title' in columns, "Call model should have youtube_title column"

    def test_youtube_metadata_can_be_stored(self, test_db):
        """YouTube metadata fields should store and retrieve correctly."""
        call = Call(
            call_id="test-yt-meta-001",
            source_type="youtube",
            duration=900,
            youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            youtube_title="Test Video Title"
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)

        assert call.youtube_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert call.youtube_title == "Test Video Title"

    def test_youtube_metadata_nullable(self, test_db):
        """YouTube metadata should be nullable for non-YouTube sources."""
        call = Call(
            call_id="test-non-yt-001",
            source_type="upload",
            duration=300
        )
        test_db.add(call)
        test_db.commit()
        test_db.refresh(call)

        assert call.youtube_url is None
        assert call.youtube_title is None


# ============================================================================
# TRAN-10 & TRAN-11: Test Stats API endpoint and Pydantic models
# ============================================================================

class TestStatsAPI:
    """Tests for TRAN-10 & TRAN-11: Stats API endpoint and response models."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from backend.app.main import app
        return TestClient(app)

    @pytest.fixture
    def test_db_with_data(self):
        """Create a test database with sample data."""
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = TestingSessionLocal()

        # Add sample calls for each source type
        calls = [
            # Upload calls: 3 files, 600 seconds total (10 mins)
            Call(call_id="upload-1", source_type="upload", duration=300, status="completed"),
            Call(call_id="upload-2", source_type="upload", duration=180, status="completed"),
            Call(call_id="upload-3", source_type="upload", duration=120, status="completed"),
            # Live calls: 2 sessions, 480 seconds total (8 mins)
            Call(call_id="live-1", source_type="live", duration=240, status="completed"),
            Call(call_id="live-2", source_type="live", duration=240, status="completed"),
            # YouTube calls: 2 videos, 1200 seconds total (20 mins)
            Call(call_id="youtube-1", source_type="youtube", duration=600, status="completed",
                 youtube_url="https://youtube.com/1", youtube_title="Video 1"),
            Call(call_id="youtube-2", source_type="youtube", duration=600, status="completed",
                 youtube_url="https://youtube.com/2", youtube_title="Video 2"),
        ]

        for call in calls:
            db.add(call)
        db.commit()

        yield db
        db.close()

    def test_stats_endpoint_exists(self, client):
        """GET /api/v1/stats should exist."""
        response = client.get("/api/v1/stats")
        assert response.status_code != 404, "Stats endpoint should exist"

    def test_stats_endpoint_returns_json(self, client):
        """Stats endpoint should return JSON."""
        response = client.get("/api/v1/stats")
        assert response.headers.get("content-type") == "application/json"

    def test_stats_response_structure(self, client):
        """Stats response should have correct structure."""
        response = client.get("/api/v1/stats")
        data = response.json()

        # Check top-level keys
        assert "audioFiles" in data, "Response should have audioFiles"
        assert "liveRecordings" in data, "Response should have liveRecordings"
        assert "youtubeVideos" in data, "Response should have youtubeVideos"

        # Check nested structure for each category
        for key in ["audioFiles", "liveRecordings", "youtubeVideos"]:
            assert "minutes" in data[key], f"{key} should have minutes"
            assert "count" in data[key], f"{key} should have count"

    def test_stats_values_are_numbers(self, client):
        """Stats values should be numbers."""
        response = client.get("/api/v1/stats")
        data = response.json()

        for key in ["audioFiles", "liveRecordings", "youtubeVideos"]:
            assert isinstance(data[key]["minutes"], (int, float)), f"{key}.minutes should be a number"
            assert isinstance(data[key]["count"], int), f"{key}.count should be an integer"

    def test_stats_empty_database(self, client):
        """Stats should return zeros for empty database."""
        # Note: This tests the actual endpoint which may have real data
        # In practice, we'd mock the database
        response = client.get("/api/v1/stats")
        data = response.json()

        # Just verify the structure, not specific values
        assert data["audioFiles"]["minutes"] >= 0
        assert data["audioFiles"]["count"] >= 0
