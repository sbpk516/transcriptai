"""
Pipeline Execution Logger for TranscriptAI
Logs every step and sub-step of the pipeline execution to JSON files for debugging and analysis.
"""
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger('transcriptai.pipeline_logger')

class PipelineLogger:
    """
    Comprehensive logger for pipeline execution steps.
    Logs every action to JSON files for easy analysis.
    """
    
    def __init__(self):
        # Create logs directory under TRANSCRIPTAI_DATA_DIR when available
        data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
        if data_dir:
            base = Path(data_dir) / "logs"
        else:
            # macOS user library default; fallback to current working dir logs if not macOS
            base = Path.home() / "Library" / "Application Support" / "TranscriptAI" / "logs" if os.name == "posix" else Path.cwd() / "logs"
        try:
            base.mkdir(parents=True, exist_ok=True)
        except Exception:
            import tempfile
            base = Path(tempfile.gettempdir()) / "transcriptai_logs"
            base.mkdir(parents=True, exist_ok=True)

        self.logs_dir = base
        # Create pipeline_logs subdirectory
        self.pipeline_logs_dir = self.logs_dir / "pipeline_logs"
        self.pipeline_logs_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Pipeline logger initialized. Logs will be saved to: {self.pipeline_logs_dir}")
    
    def log_pipeline_start(self, call_id: str, file_info: Dict[str, Any]) -> str:
        """Log the start of a new pipeline execution"""
        log_data = {
            "pipeline_id": call_id,
            "event": "pipeline_started",
            "timestamp": datetime.now().isoformat(),
            "file_info": file_info,
            "steps": []
        }
        
        filename = f"pipeline_{call_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = self.pipeline_logs_dir / filename
        
        with open(filepath, 'w') as f:
            json.dump(log_data, f, indent=2)
        
        logger.info(f"Pipeline execution log started: {filepath}")
        return str(filepath)
    
    def log_step_start(self, call_id: str, step_name: str, step_data: Dict[str, Any]) -> None:
        """Log the start of a pipeline step"""
        log_entry = {
            "step_name": step_name,
            "event": "step_started",
            "timestamp": datetime.now().isoformat(),
            "step_data": step_data
        }
        
        self._append_to_log(call_id, log_entry)
        logger.info(f"STEP STARTED: {step_name} for call {call_id}")
    
    def log_substep(self, call_id: str, step_name: str, substep_name: str, substep_data: Dict[str, Any]) -> None:
        """Log a sub-step within a pipeline step"""
        log_entry = {
            "step_name": step_name,
            "substep_name": substep_name,
            "event": "substep_executed",
            "timestamp": datetime.now().isoformat(),
            "substep_data": substep_data
        }
        
        self._append_to_log(call_id, log_entry)
        logger.info(f"SUBSTEP: {step_name} -> {substep_name} for call {call_id}")
    
    def log_step_complete(self, call_id: str, step_name: str, result: Dict[str, Any], duration: float) -> None:
        """Log the completion of a pipeline step"""
        log_entry = {
            "step_name": step_name,
            "event": "step_completed",
            "timestamp": datetime.now().isoformat(),
            "duration_seconds": duration,
            "result": result
        }
        
        self._append_to_log(call_id, log_entry)
        logger.info(f"STEP COMPLETED: {step_name} for call {call_id} (took {duration:.2f}s)")
    
    def log_step_error(self, call_id: str, step_name: str, error: Exception, error_data: Dict[str, Any]) -> None:
        """Log an error in a pipeline step"""
        log_entry = {
            "step_name": step_name,
            "event": "step_error",
            "timestamp": datetime.now().isoformat(),
            "error_type": type(error).__name__,
            "error_message": str(error),
            "error_data": error_data
        }
        
        self._append_to_log(call_id, log_entry)
        logger.error(f"STEP ERROR: {step_name} for call {call_id} - {error}")
    
    def log_database_operation(self, call_id: str, operation: str, table: str, data: Dict[str, Any], success: bool) -> None:
        """Log database operations"""
        log_entry = {
            "event": "database_operation",
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "table": table,
            "data": data,
            "success": success
        }
        
        self._append_to_log(call_id, log_entry)
        status = "SUCCESS" if success else "FAILED"
        logger.info(f"DB OPERATION: {operation} on {table} for call {call_id} - {status}")
    
    def log_file_operation(self, call_id: str, operation: str, file_path: str, file_info: Dict[str, Any]) -> None:
        """Log file operations"""
        log_entry = {
            "event": "file_operation",
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "file_path": file_path,
            "file_info": file_info
        }
        
        self._append_to_log(call_id, log_entry)
        logger.info(f"FILE OPERATION: {operation} on {file_path} for call {call_id}")
    
    def log_pipeline_complete(self, call_id: str, final_result: Dict[str, Any], total_duration: float) -> None:
        """Log the completion of the entire pipeline"""
        log_entry = {
            "event": "pipeline_completed",
            "timestamp": datetime.now().isoformat(),
            "total_duration_seconds": total_duration,
            "final_result": final_result
        }
        
        self._append_to_log(call_id, log_entry)
        logger.info(f"PIPELINE COMPLETED: {call_id} (total time: {total_duration:.2f}s)")
    
    def _append_to_log(self, call_id: str, log_entry: Dict[str, Any]) -> None:
        """Append a log entry to the pipeline log file"""
        try:
            # Find the log file for this call_id
            log_files = list(self.pipeline_logs_dir.glob(f"pipeline_{call_id}_*.json"))
            if not log_files:
                logger.warning(f"No log file found for call_id: {call_id}")
                return
            
            log_file = log_files[0]
            
            # Read existing log
            with open(log_file, 'r') as f:
                log_data = json.load(f)
            
            # Append new entry
            log_data["steps"].append(log_entry)
            
            # Write updated log
            with open(log_file, 'w') as f:
                json.dump(log_data, f, indent=2)
                
        except Exception as e:
            logger.error(f"Failed to append to log for call_id {call_id}: {e}")
    
    def get_pipeline_log(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve the complete log for a pipeline execution"""
        try:
            log_files = list(self.pipeline_logs_dir.glob(f"pipeline_{call_id}_*.json"))
            if not log_files:
                return None
            
            log_file = log_files[0]
            with open(log_file, 'r') as f:
                return json.load(f)
                
        except Exception as e:
            logger.error(f"Failed to retrieve log for call_id {call_id}: {e}")
            return None

# Global pipeline logger instance
pipeline_logger = PipelineLogger()
