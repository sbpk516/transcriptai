"""
Comprehensive logging configuration for TranscriptAI.
Provides detailed logging for debugging during development.
"""
import logging
import logging.handlers
import os
from datetime import datetime
from pathlib import Path

def setup_logging(log_level: str = "DEBUG", log_file: str = "logs/transcriptai.log"):
    """
    Set up comprehensive logging for the application.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Path to log file
    """
    # Route logs to TRANSCRIPTAI_DATA_DIR when available (desktop mode)
    data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
    if data_dir:
        log_file = str(Path(data_dir) / "logs" / Path(log_file).name)
    # Create logs directory if it doesn't exist
    log_dir = Path(log_file).parent
    log_dir.mkdir(exist_ok=True)
    
    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
    )
    
    # Create file handler with rotation
    file_handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5
    )
    file_handler.setFormatter(formatter)
    
    # Create console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    # Create specific loggers for different components
    loggers = {
        'transcriptai.api': logging.getLogger('transcriptai.api'),
        'transcriptai.upload': logging.getLogger('transcriptai.upload'),
        'transcriptai.audio': logging.getLogger('transcriptai.audio'),
        'transcriptai.whisper': logging.getLogger('transcriptai.whisper'),
        'transcriptai.database': logging.getLogger('transcriptai.database'),
    }
    
    # Set levels for specific loggers
    for logger_name, logger in loggers.items():
        logger.setLevel(logging.DEBUG)
    
    return loggers

def log_function_call(func):
    """
    Decorator to log function calls with parameters and return values.
    Useful for debugging API endpoints and processing functions.
    """
    def wrapper(*args, **kwargs):
        logger = logging.getLogger(f'transcriptai.{func.__module__}')
        
        # Log function entry
        logger.debug(f"Entering {func.__name__} with args={args}, kwargs={kwargs}")
        
        try:
            result = func(*args, **kwargs)
            logger.debug(f"Exiting {func.__name__} with result={result}")
            return result
        except Exception as e:
            logger.error(f"Error in {func.__name__}: {e}", exc_info=True)
            raise
    
    return wrapper

def log_file_operation(operation: str):
    """
    Decorator to log file operations (upload, download, delete).
    
    Args:
        operation: Type of operation (upload, download, delete, process)
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            logger = logging.getLogger('transcriptai.upload')
            
            # Extract file information if available
            file_info = "unknown"
            if args and hasattr(args[0], 'filename'):
                file_info = f"filename={args[0].filename}, size={getattr(args[0], 'size', 'unknown')}"
            
            logger.info(f"Starting {operation} operation: {file_info}")
            start_time = datetime.now()
            
            try:
                result = func(*args, **kwargs)
                duration = (datetime.now() - start_time).total_seconds()
                logger.info(f"Completed {operation} operation in {duration:.2f}s: {file_info}")
                return result
            except Exception as e:
                duration = (datetime.now() - start_time).total_seconds()
                logger.error(f"Failed {operation} operation after {duration:.2f}s: {file_info}, error={e}", exc_info=True)
                raise
        
        return wrapper
    return decorator

# Performance monitoring
class PerformanceMonitor:
    """Monitor performance of operations for debugging."""
    
    def __init__(self, operation_name: str):
        self.operation_name = operation_name
        self.start_time = None
        self.logger = logging.getLogger('transcriptai.performance')
    
    def __enter__(self):
        self.start_time = datetime.now()
        self.logger.debug(f"Starting {self.operation_name}")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = (datetime.now() - self.start_time).total_seconds()
        if exc_type:
            self.logger.error(f"Failed {self.operation_name} after {duration:.2f}s: {exc_val}")
        else:
            self.logger.info(f"Completed {self.operation_name} in {duration:.2f}s")
