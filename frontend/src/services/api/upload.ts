import { apiClient } from './client'
import type {
  FileUploadResponse,
  PipelineStatus,
} from '../../types/api'

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024 // 10GB

/**
 * Upload API Service
 * Handles all operations related to audio file uploads
 */

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void
  onSuccess?: (response: FileUploadResponse) => void
  onError?: (error: Error) => void
}

/**
 * Upload a single audio file to the backend
 */
export const uploadFile = async (
  file: File, 
  options: UploadOptions = {}
): Promise<FileUploadResponse> => {
  try {
    console.log('[UPLOAD API] Starting file upload:', {
      name: file.name,
      size: file.size,
      type: file.type
    })

    // Create FormData for file upload
    const formData = new FormData()
    formData.append('file', file)

    // Make API call with progress tracking
    const response = await apiClient.post('/api/v1/pipeline/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && options.onProgress) {
          const progress: UploadProgress = {
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            percentage: Math.round((progressEvent.loaded * 100) / progressEvent.total)
          }
          options.onProgress(progress)
        }
      }
    })

    console.log('[UPLOAD API] Upload successful:', response.data)

    // Call success callback if provided
    if (options.onSuccess) {
      options.onSuccess(response.data)
    }

    return response.data
  } catch (error) {
    console.error('[UPLOAD API] Upload failed:', error)
    
    // Call error callback if provided
    if (options.onError) {
      options.onError(error instanceof Error ? error : new Error('Upload failed'))
    }
    
    throw error
  }
}

/**
 * Upload multiple audio files
 */
export const uploadMultipleFiles = async (
  files: File[], 
  options: UploadOptions = {}
): Promise<FileUploadResponse[]> => {
  console.log('[UPLOAD API] Starting multiple file upload:', files.length, 'files')
  
  const uploadPromises = files.map(file => uploadFile(file, options))
  const results = await Promise.allSettled(uploadPromises)
  
  const successful: FileUploadResponse[] = []
  const failed: Error[] = []
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successful.push(result.value)
    } else {
      failed.push(result.reason)
      console.error(`[UPLOAD API] File ${files[index].name} failed:`, result.reason)
    }
  })
  
  console.log('[UPLOAD API] Multiple upload completed:', {
    successful: successful.length,
    failed: failed.length
  })
  
  if (failed.length > 0) {
    throw new Error(`${failed.length} files failed to upload`)
  }
  
  return successful
}

/**
 * Get upload status for a specific file
 */
export const getUploadStatus = async (uploadId: string): Promise<PipelineStatus> => {
  try {
    console.log('[UPLOAD API] Getting upload status for:', uploadId)
    
    const response = await apiClient.get(`/api/v1/pipeline/upload/${uploadId}/status`)
    
    console.log('[UPLOAD API] Status retrieved:', response.data)
    
    return response.data
  } catch (error) {
    console.error('[UPLOAD API] Failed to get upload status:', error)
    throw error
  }
}

/**
 * Cancel an ongoing upload
 */
export const cancelUpload = async (uploadId: string): Promise<void> => {
  try {
    console.log('[UPLOAD API] Cancelling upload:', uploadId)
    
    await apiClient.delete(`/api/v1/pipeline/upload/${uploadId}`)
    
    console.log('[UPLOAD API] Upload cancelled successfully')
  } catch (error) {
    console.error('[UPLOAD API] Failed to cancel upload:', error)
    throw error
  }
}

/**
 * Validate file before upload
 */
export const validateFile = (file: File): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  // Check file size (10GB limit)
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    const maxInGb = (MAX_UPLOAD_SIZE_BYTES / 1024 / 1024 / 1024).toFixed(0)
    const actualSize = file.size >= 1024 * 1024 * 1024
      ? `${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB`
      : `${(file.size / 1024 / 1024).toFixed(2)}MB`
    errors.push(`File size (${actualSize}) exceeds ${maxInGb}GB limit`)
  }
  
  // Check file type
  const validTypes = ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/flac']
  if (!validTypes.includes(file.type)) {
    errors.push(`File type "${file.type}" is not supported. Supported types: ${validTypes.join(', ')}`)
  }
  
  // Check if file has content
  if (file.size === 0) {
    errors.push('File is empty')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

/**
 * Get supported file types
 */
export const getSupportedFileTypes = (): string[] => {
  return ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/flac']
}

/**
 * Get maximum file size in bytes
 */
export const getMaxFileSize = (): number => {
  return MAX_UPLOAD_SIZE_BYTES
}

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
