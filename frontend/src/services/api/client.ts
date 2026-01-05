/**
 * HTTP Client Configuration for TranscriptAI API
 * 
 * This file sets up the axios instance with:
 * - Base configuration (URL, timeout, headers)
 * - Request/response logging for debugging
 * - Error handling
 * - Type safety with our TypeScript types
 */

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '@/types/constants';

// Custom logger for API debugging
class ApiLogger {
  private static instance: ApiLogger;
  private isDebugMode: boolean = true; // Set to false in production

  static getInstance(): ApiLogger {
    if (!ApiLogger.instance) {
      ApiLogger.instance = new ApiLogger();
    }
    return ApiLogger.instance;
  }

  log(message: string, data?: any): void {
    if (this.isDebugMode) {
      const timestamp = new Date().toISOString();
      console.log(`[API-LOG ${timestamp}] ${message}`, data || '');
    }
  }

  error(message: string, error?: any): void {
    if (this.isDebugMode) {
      const timestamp = new Date().toISOString();
      console.error(`[API-ERROR ${timestamp}] ${message}`, error || '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.isDebugMode) {
      const timestamp = new Date().toISOString();
      console.warn(`[API-WARN ${timestamp}] ${message}`, data || '');
    }
  }

  setDebugMode(enabled: boolean): void {
    this.isDebugMode = enabled;
    this.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Get logger instance
const logger = ApiLogger.getInstance();

/**
 * Create and configure axios instance
 * 
 * Configuration includes:
 * - Base URL for all API calls
 * - Request timeout
 * - Default headers
 * - Request/response interceptors for logging
 */
export const createApiClient = (): AxiosInstance => {
  // Decide baseURL in a debug-first way:
  // - Dev (Vite, http://localhost:3000): keep relative URLs ('') so Vite proxy works
  // - Packaged Electron (file://): use absolute API_BASE_URL (e.g., http://127.0.0.1:8001)
  const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:'
  // If running inside packaged Electron, prefer port provided by preload (window.api.backend.port)
  // Otherwise allow devs to override via VITE_API_BASE_URL while keeping the Vite proxy default
  const electronPort = (typeof window !== 'undefined' && (window as any)?.api?.backend?.port) || null
  const rawEnvBaseUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).trim()
    : ''
  const devBaseURL = rawEnvBaseUrl || ''

  // UNIFIED DISCOVERY: 
  // 1. If we are in Electron (window.api.backend.port exists), use it directly.
  //    This works in BOTH Dev (http:) and Prod (file:).
  // 2. Otherwise, use VITE_API_BASE_URL if set.
  // 3. Finally, fallback to default API_BASE_URL.
  const chosenBaseURL = electronPort
    ? `http://127.0.0.1:${electronPort}`
    : (isFileProtocol ? API_BASE_URL : devBaseURL)

  logger.log('Creating API client with configuration:', {
    chosenBaseURL,
    isFileProtocol,
    API_BASE_URL,
    timeout: API_TIMEOUT
  });

  // Create axios instance with base configuration
  const apiClient: AxiosInstance = axios.create({
    baseURL: chosenBaseURL,
    timeout: API_TIMEOUT,
    headers: {
      // Do not set Content-Type globally; let axios/browser infer it.
      'Accept': 'application/json',
    },
    // Enable request/response logging in development
    validateStatus: (status) => {
      // Log all status codes for debugging
      logger.log(`Response status: ${status}`);
      return status >= 200 && status < 300; // Accept 2xx status codes
    }
  });

  // Add request interceptor for logging
  apiClient.interceptors.request.use(
    (config: AxiosRequestConfig) => {
      // Ensure correct headers for FormData uploads
      const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData
      if (isFormData) {
        if (config.headers) {
          // Remove any preset Content-Type so the browser can set the multipart boundary
          // @ts-ignore
          delete (config.headers as any)['Content-Type']
          // Some axios versions nest common headers
          // @ts-ignore
          delete (config.headers as any)?.common?.['Content-Type']
        }
      }

      const requestId = Math.random().toString(36).substring(7);
      const startTime = Date.now();

      // Log request details
      logger.log(`[${requestId}] API Request:`, {
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL,
        fullURL: config.url?.startsWith('http') ? config.url : `${config.baseURL}${config.url}`,
        headers: config.headers,
        data: config.data,
        params: config.params,
        timeout: config.timeout
      });

      // Add request metadata for tracking
      config.metadata = {
        requestId,
        startTime,
        url: config.url
      };

      return config;
    },
    (error) => {
      logger.error('Request interceptor error:', error);
      return Promise.reject(error);
    }
  );

  // Add response interceptor for logging
  apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
      const requestId = response.config.metadata?.requestId;
      const startTime = response.config.metadata?.startTime;
      const duration = startTime ? Date.now() - startTime : 0;

      // Log successful response
      logger.log(`[${requestId}] API Response Success:`, {
        status: response.status,
        statusText: response.statusText,
        url: response.config.url,
        duration: `${duration}ms`,
        data: response.data,
        headers: response.headers
      });

      return response;
    },
    (error) => {
      const requestId = error.config?.metadata?.requestId;
      const startTime = error.config?.metadata?.startTime;
      const duration = startTime ? Date.now() - startTime : 0;

      // Enhanced error logging with specific error types
      const errorInfo = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        duration: `${duration}ms`,
        data: error.response?.data,
        headers: error.response?.headers,
        config: {
          method: error.config?.method,
          timeout: error.config?.timeout,
          baseURL: error.config?.baseURL
        }
      };

      // Log specific error types
      if (error.code === 'ECONNREFUSED') {
        logger.error(`[${requestId}] Connection refused - Backend may not be running:`, errorInfo);
      } else if (error.code === 'ENOTFOUND') {
        logger.error(`[${requestId}] Host not found - Check API_BASE_URL:`, errorInfo);
      } else if (error.code === 'ETIMEDOUT') {
        logger.error(`[${requestId}] Request timeout:`, errorInfo);
      } else {
        logger.error(`[${requestId}] API Response Error:`, errorInfo);
      }

      return Promise.reject(error);
    }
  );

  logger.log('API client created successfully');
  return apiClient;
};

// Create and export the main API client instance
export const apiClient: AxiosInstance = createApiClient();

// Export logger for use in other files
export { ApiLogger };

// Export logger instance
export const apiLogger = logger;

// Type for request metadata
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      requestId: string;
      startTime: number;
      url?: string;
    };
  }
}
