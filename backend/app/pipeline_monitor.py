"""
Pipeline Monitor for TranscriptAI Phase 1.3.
Real-time monitoring and performance tracking for the audio processing pipeline.
"""
import asyncio
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from pathlib import Path
import logging
from collections import defaultdict, deque
import threading
import psutil

from .debug_utils import debug_helper

# Configure logger for this module
logger = logging.getLogger('transcriptai.pipeline_monitor')


class PerformanceMetrics:
    """
    Tracks performance metrics for pipeline operations.
    """
    
    def __init__(self, max_history: int = 100):
        self.max_history = max_history
        self.metrics = {
            'upload_times': deque(maxlen=max_history),
            'processing_times': deque(maxlen=max_history),
            'transcription_times': deque(maxlen=max_history),
            'storage_times': deque(maxlen=max_history),
            'total_pipeline_times': deque(maxlen=max_history),
            'error_counts': defaultdict(int),
            'success_counts': defaultdict(int)
        }
        self.lock = threading.Lock()
        logger.info("Performance metrics tracker initialized")
    
    def record_operation_time(self, operation: str, duration: float):
        """Record operation duration"""
        with self.lock:
            if operation in self.metrics:
                self.metrics[f'{operation}_times'].append(duration)
    
    def record_success(self, operation: str):
        """Record successful operation"""
        with self.lock:
            self.metrics['success_counts'][operation] += 1
    
    def record_error(self, operation: str, error_type: str):
        """Record operation error"""
        with self.lock:
            self.metrics['error_counts'][f"{operation}_{error_type}"] += 1
    
    def get_operation_stats(self, operation: str) -> Dict[str, Any]:
        """Get statistics for an operation"""
        with self.lock:
            times = list(self.metrics.get(f'{operation}_times', []))
            if not times:
                return {
                    'count': 0,
                    'avg_time': 0,
                    'min_time': 0,
                    'max_time': 0,
                    'success_rate': 0
                }
            
            success_count = self.metrics['success_counts'].get(operation, 0)
            error_count = sum(1 for k, v in self.metrics['error_counts'].items() 
                            if k.startswith(operation))
            total_count = success_count + error_count
            
            return {
                'count': len(times),
                'avg_time': sum(times) / len(times),
                'min_time': min(times),
                'max_time': max(times),
                'success_rate': success_count / total_count if total_count > 0 else 0,
                'recent_times': times[-10:]  # Last 10 operations
            }
    
    def get_system_metrics(self) -> Dict[str, Any]:
        """Get current system resource usage"""
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            return {
                'cpu_percent': cpu_percent,
                'memory_percent': memory.percent,
                'memory_available_gb': memory.available / (1024**3),
                'disk_percent': disk.percent,
                'disk_free_gb': disk.free / (1024**3)
            }
        except Exception as e:
            logger.error(f"Failed to get system metrics: {e}")
            return {'error': str(e)}


class PipelineMonitor:
    """
    Real-time monitoring for the audio processing pipeline.
    """
    
    def __init__(self):
        self.performance_metrics = PerformanceMetrics()
        self.active_pipelines = {}
        self.pipeline_history = deque(maxlen=1000)
        self.alert_thresholds = {
            'max_pipeline_time': 300,  # 5 minutes
            'max_operation_time': 60,   # 1 minute
            'min_success_rate': 0.8,    # 80%
            'max_cpu_percent': 90,
            'max_memory_percent': 85
        }
        self.alerts = deque(maxlen=100)
        self.lock = threading.Lock()
        
        logger.info("Pipeline monitor initialized")
    
    def start_pipeline_monitoring(self, call_id: str, file_info: Dict):
        """Start monitoring a pipeline"""
        with self.lock:
            self.active_pipelines[call_id] = {
                'start_time': datetime.now(),
                'file_info': file_info,
                'steps': {},
                'status': 'running',
                'last_update': datetime.now()
            }
            logger.info(f"Started monitoring pipeline: {call_id}")
    
    def update_pipeline_step(self, call_id: str, step_name: str, status: str, 
                           duration: float = None, error: str = None):
        """Update pipeline step status"""
        with self.lock:
            if call_id in self.active_pipelines:
                self.active_pipelines[call_id]['steps'][step_name] = {
                    'status': status,
                    'duration': duration,
                    'error': error,
                    'timestamp': datetime.now()
                }
                self.active_pipelines[call_id]['last_update'] = datetime.now()
                
                # Record metrics
                if duration:
                    self.performance_metrics.record_operation_time(step_name, duration)
                
                if status == 'completed':
                    self.performance_metrics.record_success(step_name)
                elif status == 'failed':
                    self.performance_metrics.record_error(step_name, error or 'unknown')
                
                # Check for alerts
                self._check_alerts(call_id, step_name, duration, status)
    
    def complete_pipeline(self, call_id: str, final_result: Dict):
        """Mark pipeline as completed"""
        with self.lock:
            if call_id in self.active_pipelines:
                pipeline_info = self.active_pipelines[call_id]
                total_duration = (datetime.now() - pipeline_info['start_time']).total_seconds()
                
                # Move to history
                pipeline_info.update({
                    'status': 'completed',
                    'total_duration': total_duration,
                    'final_result': final_result,
                    'end_time': datetime.now()
                })
                
                self.pipeline_history.append(pipeline_info)
                del self.active_pipelines[call_id]
                
                # Record total pipeline time
                self.performance_metrics.record_operation_time('total_pipeline', total_duration)
                self.performance_metrics.record_success('total_pipeline')
                
                logger.info(f"Pipeline completed: {call_id} (took {total_duration:.2f}s)")
    
    def fail_pipeline(self, call_id: str, error: Exception, step_name: str = None):
        """Mark pipeline as failed"""
        with self.lock:
            if call_id in self.active_pipelines:
                pipeline_info = self.active_pipelines[call_id]
                total_duration = (datetime.now() - pipeline_info['start_time']).total_seconds()
                
                # Move to history
                pipeline_info.update({
                    'status': 'failed',
                    'total_duration': total_duration,
                    'error': str(error),
                    'failed_step': step_name,
                    'end_time': datetime.now()
                })
                
                self.pipeline_history.append(pipeline_info)
                del self.active_pipelines[call_id]
                
                # Record failure
                self.performance_metrics.record_error('total_pipeline', type(error).__name__)
                
                logger.error(f"Pipeline failed: {call_id} at step {step_name}: {error}")
    
    def _check_alerts(self, call_id: str, step_name: str, duration: float, status: str):
        """Check for alert conditions"""
        alerts = []
        
        # Check operation duration
        if duration and duration > self.alert_thresholds['max_operation_time']:
            alerts.append({
                'type': 'slow_operation',
                'call_id': call_id,
                'step': step_name,
                'duration': duration,
                'threshold': self.alert_thresholds['max_operation_time'],
                'timestamp': datetime.now().isoformat()
            })
        
        # Check system resources
        system_metrics = self.performance_metrics.get_system_metrics()
        if 'error' not in system_metrics:
            if system_metrics['cpu_percent'] > self.alert_thresholds['max_cpu_percent']:
                alerts.append({
                    'type': 'high_cpu',
                    'cpu_percent': system_metrics['cpu_percent'],
                    'threshold': self.alert_thresholds['max_cpu_percent'],
                    'timestamp': datetime.now().isoformat()
                })
            
            if system_metrics['memory_percent'] > self.alert_thresholds['max_memory_percent']:
                alerts.append({
                    'type': 'high_memory',
                    'memory_percent': system_metrics['memory_percent'],
                    'threshold': self.alert_thresholds['max_memory_percent'],
                    'timestamp': datetime.now().isoformat()
                })
        
        # Add alerts to queue
        for alert in alerts:
            self.alerts.append(alert)
            logger.warning(f"Alert: {alert}")
    
    def get_active_pipelines(self) -> Dict[str, Any]:
        """Get current active pipelines"""
        with self.lock:
            return {
                call_id: {
                    'start_time': info['start_time'].isoformat(),
                    'duration': (datetime.now() - info['start_time']).total_seconds(),
                    'steps': info['steps'],
                    'status': info['status'],
                    'file_info': info['file_info']
                }
                for call_id, info in self.active_pipelines.items()
            }
    
    def get_pipeline_history(self, limit: int = 50) -> List[Dict]:
        """Get recent pipeline history"""
        with self.lock:
            return list(self.pipeline_history)[-limit:]
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get performance summary"""
        operations = ['upload', 'audio_processing', 'transcription', 'database_storage', 'total_pipeline']
        
        summary = {
            'operations': {},
            'system_metrics': self.performance_metrics.get_system_metrics(),
            'active_pipelines': len(self.active_pipelines),
            'recent_alerts': list(self.alerts)[-10:],
            'timestamp': datetime.now().isoformat()
        }
        
        for operation in operations:
            summary['operations'][operation] = self.performance_metrics.get_operation_stats(operation)
        
        return summary
    
    def get_debug_info(self, call_id: str) -> Dict[str, Any]:
        """Get detailed debug information for a specific pipeline"""
        with self.lock:
            # Check active pipelines
            if call_id in self.active_pipelines:
                return {
                    'status': 'active',
                    'pipeline_info': self.active_pipelines[call_id],
                    'performance_metrics': self.performance_metrics.get_operation_stats('total_pipeline')
                }
            
            # Check history
            for pipeline in reversed(self.pipeline_history):
                if pipeline.get('call_id') == call_id:
                    return {
                        'status': 'completed' if pipeline['status'] == 'completed' else 'failed',
                        'pipeline_info': pipeline,
                        'performance_metrics': self.performance_metrics.get_operation_stats('total_pipeline')
                    }
            
            return {'error': f'Pipeline {call_id} not found'}


# Global monitor instance
pipeline_monitor = PipelineMonitor()
