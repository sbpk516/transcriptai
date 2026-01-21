"""
Test suite for Pipeline Monitor (Phase 1.3 Week 3).
Tests the monitoring and debugging capabilities.
"""
import pytest
import asyncio
import time
from datetime import datetime
from unittest.mock import Mock, patch
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.app.pipeline_monitor import PipelineMonitor, PerformanceMetrics


class TestPerformanceMetrics:
    """Test PerformanceMetrics class."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.metrics = PerformanceMetrics(max_history=10)
    
    def test_record_operation_time(self):
        """Test recording operation times."""
        self.metrics.record_operation_time('upload', 1.5)
        self.metrics.record_operation_time('upload', 2.0)
        
        stats = self.metrics.get_operation_stats('upload')
        assert stats['count'] == 2
        assert stats['avg_time'] == 1.75
        assert stats['min_time'] == 1.5
        assert stats['max_time'] == 2.0
    
    def test_record_success_and_error(self):
        """Test recording success and error counts."""
        self.metrics.record_success('upload')
        self.metrics.record_success('upload')
        self.metrics.record_error('upload', 'timeout')
        
        stats = self.metrics.get_operation_stats('upload')
        assert stats['success_rate'] == 2/3  # 2 successes out of 3 total
    
    def test_max_history_limit(self):
        """Test that metrics respect max history limit."""
        for i in range(15):  # More than max_history (10)
            self.metrics.record_operation_time('upload', float(i))
        
        stats = self.metrics.get_operation_stats('upload')
        assert stats['count'] == 10  # Should be limited to max_history
    
    @patch('psutil.cpu_percent')
    @patch('psutil.virtual_memory')
    @patch('psutil.disk_usage')
    def test_get_system_metrics(self, mock_disk, mock_memory, mock_cpu):
        """Test system metrics collection."""
        # Mock system metrics
        mock_cpu.return_value = 45.2
        mock_memory.return_value = Mock(
            percent=67.8,
            available=8589934592  # 8GB in bytes
        )
        mock_disk.return_value = Mock(
            percent=23.4,
            free=107374182400  # 100GB in bytes
        )
        
        metrics = self.metrics.get_system_metrics()
        
        assert metrics['cpu_percent'] == 45.2
        assert metrics['memory_percent'] == 67.8
        assert abs(metrics['memory_available_gb'] - 8.0) < 0.1
        assert metrics['disk_percent'] == 23.4
        assert abs(metrics['disk_free_gb'] - 100.0) < 0.1


class TestPipelineMonitor:
    """Test PipelineMonitor class."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.monitor = PipelineMonitor()
    
    def test_start_pipeline_monitoring(self):
        """Test starting pipeline monitoring."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav", "size": 1024}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        
        assert call_id in self.monitor.active_pipelines
        assert self.monitor.active_pipelines[call_id]['status'] == 'running'
        assert self.monitor.active_pipelines[call_id]['file_info'] == file_info
    
    def test_update_pipeline_step(self):
        """Test updating pipeline step status."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        self.monitor.update_pipeline_step(call_id, "upload", "completed", 2.5)
        
        steps = self.monitor.active_pipelines[call_id]['steps']
        assert steps['upload']['status'] == 'completed'
        assert steps['upload']['duration'] == 2.5
    
    def test_complete_pipeline(self):
        """Test completing a pipeline."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        final_result = {"status": "success"}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        time.sleep(0.1)  # Small delay to ensure different timestamps
        self.monitor.complete_pipeline(call_id, final_result)
        
        # Should be moved to history
        assert call_id not in self.monitor.active_pipelines
        assert len(self.monitor.pipeline_history) == 1
        
        history_item = self.monitor.pipeline_history[0]
        assert history_item['status'] == 'completed'
        assert history_item['final_result'] == final_result
        assert history_item['total_duration'] > 0
    
    def test_fail_pipeline(self):
        """Test failing a pipeline."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        error = Exception("Test error")
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        time.sleep(0.1)
        self.monitor.fail_pipeline(call_id, error, "upload")
        
        # Should be moved to history
        assert call_id not in self.monitor.active_pipelines
        assert len(self.monitor.pipeline_history) == 1
        
        history_item = self.monitor.pipeline_history[0]
        assert history_item['status'] == 'failed'
        assert history_item['error'] == "Test error"
        assert history_item['failed_step'] == "upload"
    
    def test_get_active_pipelines(self):
        """Test getting active pipelines."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        active = self.monitor.get_active_pipelines()
        
        assert call_id in active
        assert active[call_id]['status'] == 'running'
        assert active[call_id]['file_info'] == file_info
    
    def test_get_pipeline_history(self):
        """Test getting pipeline history."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        self.monitor.complete_pipeline(call_id, {"status": "success"})
        
        history = self.monitor.get_pipeline_history(limit=10)
        assert len(history) == 1
        assert history[0]['status'] == 'completed'
    
    def test_get_performance_summary(self):
        """Test getting performance summary."""
        summary = self.monitor.get_performance_summary()
        
        assert 'operations' in summary
        assert 'system_metrics' in summary
        assert 'active_pipelines' in summary
        assert 'recent_alerts' in summary
        assert 'timestamp' in summary
        
        # Check that all operations are included
        expected_operations = ['upload', 'audio_processing', 'transcription', 'database_storage', 'total_pipeline']
        for op in expected_operations:
            assert op in summary['operations']
    
    def test_get_debug_info(self):
        """Test getting debug info for specific pipeline."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        
        # Test active pipeline
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        debug_info = self.monitor.get_debug_info(call_id)
        assert debug_info['status'] == 'active'
        
        # Test completed pipeline
        self.monitor.complete_pipeline(call_id, {"status": "success"})
        debug_info = self.monitor.get_debug_info(call_id)
        assert debug_info['status'] == 'completed'
        
        # Test non-existent pipeline
        debug_info = self.monitor.get_debug_info("non-existent")
        assert 'error' in debug_info
    
    def test_alert_thresholds(self):
        """Test alert generation for threshold violations."""
        call_id = "test-call-123"
        file_info = {"filename": "test.wav"}
        
        self.monitor.start_pipeline_monitoring(call_id, file_info)
        
        # Test slow operation alert
        self.monitor.update_pipeline_step(call_id, "upload", "completed", 70.0)  # Above 60s threshold
        
        alerts = list(self.monitor.alerts)
        assert len(alerts) > 0
        assert any(alert['type'] == 'slow_operation' for alert in alerts)


class TestMonitoringIntegration:
    """Test integration with pipeline orchestrator."""
    
    @pytest.mark.asyncio
    async def test_monitoring_with_pipeline(self):
        """Test that monitoring works with actual pipeline operations."""
        from backend.app.pipeline_orchestrator import AudioProcessingPipeline
        
        monitor = PipelineMonitor()
        pipeline = AudioProcessingPipeline()
        
        # Mock file for testing
        mock_file = Mock()
        mock_file.filename = "test.wav"
        mock_file.content_type = "audio/wav"
        mock_file.size = 1024
        
        # This would normally process a real file
        # For testing, we'll just verify monitoring starts
        call_id = "test-integration-123"
        file_info = {
            "filename": mock_file.filename,
            "content_type": mock_file.content_type,
            "size": mock_file.size
        }
        
        monitor.start_pipeline_monitoring(call_id, file_info)
        
        assert call_id in monitor.active_pipelines
        assert monitor.active_pipelines[call_id]['status'] == 'running'


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
