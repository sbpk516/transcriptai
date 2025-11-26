// API Configuration
// Centralized port configuration - change in config.js to update everywhere
const config = { BACKEND_PORT: 8001 }; // Import from config.js
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://127.0.0.1:${config.BACKEND_PORT}`;
export const API_VERSION = 'v1';
export const API_TIMEOUT = 30000; // 30 seconds

// API Endpoints
export const API_ENDPOINTS = {
  // File Upload
  UPLOAD: `/api/${API_VERSION}/pipeline/upload`,
  
  // Pipeline
  PIPELINE_STATUS: `/api/${API_VERSION}/pipeline/status`,
  PIPELINE_RESULT: `/api/${API_VERSION}/pipeline/result`,
  
  // Monitoring
  SYSTEM_METRICS: `/api/${API_VERSION}/monitor/system`,
  PERFORMANCE_METRICS: `/api/${API_VERSION}/monitor/performance`,
  
  // Health Check
  HEALTH: `/api/${API_VERSION}/health`,
} as const;

// File Upload Configuration
export const FILE_UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
  ACCEPTED_TYPES: [
    'audio/wav',
    'audio/mp3', 
    'audio/m4a',
    'audio/aiff',
    'audio/x-wav',
    'audio/x-m4a'
  ],
  MAX_FILES: 1,
} as const;

// UI Configuration
export const UI_CONFIG = {
  // Progress Bar
  PROGRESS_UPDATE_INTERVAL: 1000, // 1 second
  
  // Auto-refresh intervals
  STATUS_REFRESH_INTERVAL: 2000, // 2 seconds
  METRICS_REFRESH_INTERVAL: 5000, // 5 seconds
  
  // Timeouts
  UPLOAD_TIMEOUT: 600000, // 10 minutes
  PROCESSING_TIMEOUT: 600000, // 10 minutes
  
  // Animation durations
  FADE_DURATION: 300, // 300ms
  SLIDE_DURATION: 400, // 400ms
} as const;

// Status Colors
export const STATUS_COLORS = {
  pending: 'text-gray-500',
  uploading: 'text-blue-500',
  processing: 'text-yellow-500',
  transcribing: 'text-orange-500',
  analyzing: 'text-purple-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
} as const;

// Risk Level Colors
export const RISK_COLORS = {
  low: 'text-green-600',
  medium: 'text-yellow-600',
  high: 'text-orange-600',
  critical: 'text-red-600',
} as const;

// Sentiment Colors
export const SENTIMENT_COLORS = {
  positive: 'text-green-600',
  negative: 'text-red-600',
  neutral: 'text-gray-600',
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  FILE_TOO_LARGE: 'File size exceeds the maximum limit of 10GB',
  INVALID_FILE_TYPE: 'Please select a valid audio file (WAV, MP3, M4A, AIFF)',
  UPLOAD_FAILED: 'Failed to upload file. Please try again.',
  PROCESSING_FAILED: 'Audio processing failed. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  SERVER_ERROR: 'Server error. Please try again later.',
  TIMEOUT_ERROR: 'Request timed out. Please try again.',
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  FILE_UPLOADED: 'File uploaded successfully!',
  PROCESSING_STARTED: 'Audio processing started successfully!',
  ANALYSIS_COMPLETED: 'Analysis completed successfully!',
} as const;

// Validation Rules
export const VALIDATION_RULES = {
  CALL_ID: {
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    message: 'Invalid call ID format',
  },
  FILE_NAME: {
    pattern: /^[a-zA-Z0-9._-]+$/,
    message: 'Invalid file name',
  },
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  UPLOAD_HISTORY: 'transcriptai_upload_history',
  USER_PREFERENCES: 'transcriptai_user_preferences',
  THEME: 'transcriptai_theme',
} as const;

// Theme Configuration
export const THEME_CONFIG = {
  light: {
    primary: '#3B82F6',
    secondary: '#6B7280',
    background: '#FFFFFF',
    surface: '#F9FAFB',
    text: '#111827',
    border: '#E5E7EB',
  },
  dark: {
    primary: '#60A5FA',
    secondary: '#9CA3AF',
    background: '#111827',
    surface: '#1F2937',
    text: '#F9FAFB',
    border: '#374151',
  },
} as const;
