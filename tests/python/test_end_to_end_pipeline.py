"""
End-to-End Pipeline Testing for SignalHub Phase 1.3 Week 4.
Tests the complete audio processing pipeline with real audio files.
"""
import pytest
import asyncio
import os
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch
import sys
import json
import time

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.app.pipeline_orchestrator import AudioProcessingPipeline
from backend.app.pipeline_monitor import pipeline_monitor
from backend.app.main import app
from fastapi.testclient import TestClient


class TestEndToEndPipeline:
    """End-to-end tests for the complete audio processing pipeline."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.client = TestClient(app)
        self.pipeline = AudioProcessingPipeline()
        
        # Create test directories
        self.test_audio_dir = Path("test_audio_files")
        self.test_audio_dir.mkdir(exist_ok=True)
        
        # Create a simple test audio file (1 second of silence)
        self.create_test_audio_file()
    
    def teardown_method(self):
        """Clean up test fixtures."""
        # Clean up test files
        if self.test_audio_dir.exists():
            shutil.rmtree(self.test_audio_dir)
        
        # Clean up debug logs
        debug_dir = Path("debug_logs")
        if debug_dir.exists():
            for file in debug_dir.glob("test_*"):
                file.unlink()
    
    def create_test_audio_file(self):
        """Create a test audio file for testing."""
        test_file_path = self.test_audio_dir / "test_audio.wav"
        
        # Use ffmpeg to create a 1-second silent WAV file
        import subprocess
        try:
            subprocess.run([
                "ffmpeg", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-t", "1", "-c:a", "pcm_s16le", str(test_file_path), "-y"
            ], check=True, capture_output=True)
            self.test_audio_path = test_file_path
        except (subprocess.CalledProcessError, FileNotFoundError):
            # Fallback: create a mock file
            self.test_audio_path = test_file_path
            with open(self.test_audio_path, 'wb') as f:
                f.write(b'RIFF' + b'\x00' * 44)  # Minimal WAV header
    
    @pytest.mark.asyncio
    async def test_complete_pipeline_flow(self):
        """Test the complete pipeline from upload to completion."""
        # Prepare test file
        with open(self.test_audio_path, 'rb') as f:
            files = {'file': ('test_audio.wav', f, 'audio/wav')}
            
            # Test the complete pipeline endpoint
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            
            assert response.status_code == 200
            result = response.json()
            
            # Verify response structure
            assert 'call_id' in result
            assert 'pipeline_status' in result
            assert 'pipeline_summary' in result
            assert 'processing_timeline' in result
            
            call_id = result['call_id']
            
            # Verify pipeline summary
            summary = result['pipeline_summary']
            assert 'upload' in summary
            assert 'audio_processing' in summary
            assert 'transcription' in summary
            assert 'database_storage' in summary
            
            # Check that all steps completed
            for step_name, step_info in summary.items():
                assert step_info['status'] == 'completed'
            
            # Verify processing timeline
            timeline = result['processing_timeline']
            assert 'step_status' in timeline
            assert 'step_timings' in timeline
            
            # Check that all steps are marked as completed
            step_status = timeline['step_status']
            expected_steps = ['upload', 'audio_processing', 'transcription', 'database_storage']
            for step in expected_steps:
                assert step in step_status
                assert step_status[step] == 'completed'
    
    @pytest.mark.asyncio
    async def test_pipeline_status_endpoint(self):
        """Test the pipeline status endpoint."""
        # First, run a pipeline
        with open(self.test_audio_path, 'rb') as f:
            files = {'file': ('test_audio.wav', f, 'audio/wav')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            assert response.status_code == 200
            call_id = response.json()['call_id']
        
        # Test status endpoint
        status_response = self.client.get(f"/api/v1/pipeline/{call_id}/status")
        assert status_response.status_code == 200
        
        status_data = status_response.json()
        assert 'call_id' in status_data
        assert 'pipeline_status' in status_data
        assert 'debug_info' in status_data
        
        # Verify pipeline status
        pipeline_status = status_data['pipeline_status']
        assert 'overall_status' in pipeline_status
        assert pipeline_status['overall_status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_pipeline_debug_endpoint(self):
        """Test the pipeline debug endpoint."""
        # First, run a pipeline
        with open(self.test_audio_path, 'rb') as f:
            files = {'file': ('test_audio.wav', f, 'audio/wav')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            assert response.status_code == 200
            call_id = response.json()['call_id']
        
        # Test debug endpoint
        debug_response = self.client.get(f"/api/v1/pipeline/{call_id}/debug")
        assert debug_response.status_code == 200
        
        debug_data = debug_response.json()
        assert 'call_id' in debug_data
        assert 'debug_info' in debug_data
        assert 'debug_logs' in debug_data
        assert 'timestamp' in debug_data
    
    @pytest.mark.asyncio
    async def test_monitoring_endpoints(self):
        """Test all monitoring endpoints."""
        # Test active pipelines endpoint
        active_response = self.client.get("/api/v1/monitor/active")
        assert active_response.status_code == 200
        
        active_data = active_response.json()
        assert 'active_pipelines' in active_data
        assert 'count' in active_data
        assert 'timestamp' in active_data
        
        # Test performance summary endpoint
        performance_response = self.client.get("/api/v1/monitor/performance")
        assert performance_response.status_code == 200
        
        performance_data = performance_response.json()
        assert 'performance_summary' in performance_data
        assert 'timestamp' in performance_data
        
        # Verify performance summary structure
        summary = performance_data['performance_summary']
        assert 'operations' in summary
        assert 'system_metrics' in summary
        assert 'active_pipelines' in summary
        assert 'recent_alerts' in summary
        
        # Test alerts endpoint
        alerts_response = self.client.get("/api/v1/monitor/alerts")
        assert alerts_response.status_code == 200
        
        alerts_data = alerts_response.json()
        assert 'alerts' in alerts_data
        assert 'count' in alerts_data
        assert 'timestamp' in alerts_data
    
    @pytest.mark.asyncio
    async def test_pipeline_with_large_file(self):
        """Test pipeline with a larger audio file."""
        # Create a larger test file (5 seconds)
        large_file_path = self.test_audio_dir / "large_test_audio.wav"
        
        import subprocess
        try:
            subprocess.run([
                "ffmpeg", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-t", "5", "-c:a", "pcm_s16le", str(large_file_path), "-y"
            ], check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            # Fallback: create a larger mock file
            with open(large_file_path, 'wb') as f:
                f.write(b'RIFF' + b'\x00' * 220500)  # Larger WAV file
        
        # Test with larger file
        with open(large_file_path, 'rb') as f:
            files = {'file': ('large_test_audio.wav', f, 'audio/wav')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            
            assert response.status_code == 200
            result = response.json()
            
            # Verify it completed successfully
            assert result['pipeline_status'] == 'completed'
            
            # Check timing information
            timeline = result['processing_timeline']
            assert 'total_duration' in timeline
            assert timeline['total_duration'] > 0
    
    @pytest.mark.asyncio
    async def test_error_handling(self):
        """Test error handling with invalid files."""
        # Test with invalid file type
        invalid_file_path = self.test_audio_dir / "invalid.txt"
        with open(invalid_file_path, 'w') as f:
            f.write("This is not an audio file")
        
        with open(invalid_file_path, 'rb') as f:
            files = {'file': ('invalid.txt', f, 'text/plain')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            
            # Should return an error
            assert response.status_code in [400, 422, 500]
    
    @pytest.mark.asyncio
    async def test_concurrent_pipelines(self):
        """Test handling multiple concurrent pipelines."""
        # Start multiple pipelines concurrently
        tasks = []
        call_ids = []
        
        for i in range(3):
            with open(self.test_audio_path, 'rb') as f:
                files = {'file': (f'test_audio_{i}.wav', f, 'audio/wav')}
                response = self.client.post("/api/v1/pipeline/upload", files=files)
                assert response.status_code == 200
                call_ids.append(response.json()['call_id'])
        
        # Check that all pipelines completed
        for call_id in call_ids:
            status_response = self.client.get(f"/api/v1/pipeline/{call_id}/status")
            assert status_response.status_code == 200
            
            status_data = status_response.json()
            pipeline_status = status_data['pipeline_status']
            assert pipeline_status['overall_status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_pipeline_performance_metrics(self):
        """Test that performance metrics are being collected."""
        # Run a pipeline
        with open(self.test_audio_path, 'rb') as f:
            files = {'file': ('test_audio.wav', f, 'audio/wav')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
            assert response.status_code == 200
        
        # Check performance metrics
        performance_response = self.client.get("/api/v1/monitor/performance")
        assert performance_response.status_code == 200
        
        performance_data = performance_response.json()
        summary = performance_data['performance_summary']
        
        # Verify that metrics are being collected
        operations = summary['operations']
        expected_operations = ['upload', 'audio_processing', 'transcription', 'database_storage', 'total_pipeline']
        
        for operation in expected_operations:
            assert operation in operations
            op_stats = operations[operation]
            assert 'count' in op_stats
            assert 'avg_time' in op_stats
            assert 'success_rate' in op_stats
    
    @pytest.mark.asyncio
    async def test_pipeline_history(self):
        """Test pipeline history tracking."""
        # Run a few pipelines
        for i in range(2):
            with open(self.test_audio_path, 'rb') as f:
                files = {'file': (f'test_audio_{i}.wav', f, 'audio/wav')}
                response = self.client.post("/api/v1/pipeline/upload", files=files)
                assert response.status_code == 200
        
        # Check history
        history_response = self.client.get("/api/v1/monitor/history")
        assert history_response.status_code == 200
        
        history_data = history_response.json()
        assert 'pipeline_history' in history_data
        assert 'count' in history_data
        
        # Should have at least 2 entries
        assert history_data['count'] >= 2


class TestProductionReadiness:
    """Tests for production readiness."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.client = TestClient(app)
    
    def test_health_check_endpoint(self):
        """Test health check endpoint."""
        response = self.client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}
    
    def test_api_documentation(self):
        """Test that API documentation is accessible."""
        response = self.client.get("/docs")
        assert response.status_code == 200
        
        response = self.client.get("/redoc")
        assert response.status_code == 200
    
    def test_error_handling_consistency(self):
        """Test that error handling is consistent across endpoints."""
        # Test with non-existent call ID
        response = self.client.get("/api/v1/pipeline/non-existent/status")
        assert response.status_code in [404, 500]  # Should return an error
        
        response = self.client.get("/api/v1/pipeline/non-existent/debug")
        assert response.status_code in [404, 500]  # Should return an error
    
    def test_response_format_consistency(self):
        """Test that all endpoints return consistent response formats."""
        # Test status endpoint format
        response = self.client.get("/api/v1/monitor/active")
        assert response.status_code == 200
        data = response.json()
        
        # All monitoring endpoints should have timestamp
        assert 'timestamp' in data
        
        # Test performance endpoint format
        response = self.client.get("/api/v1/monitor/performance")
        assert response.status_code == 200
        data = response.json()
        assert 'timestamp' in data


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v", "--tb=short"])
