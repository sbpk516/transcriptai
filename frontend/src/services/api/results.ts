import { apiClient } from './client'
import type {
  PipelineResult,
  PipelineStatus,
  ApiResponse,
} from '../../types/api'

/**
 * Results API Service
 * Handles all operations related to retrieving call results and analysis data
 */

export interface ResultsFilters {
  status?: string
  dateFrom?: string
  dateTo?: string
  searchQuery?: string
  sort?: 'created_at'
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface ResultsResponse extends ApiResponse {
  data: {
    results: PipelineResult[]
    total: number
    page: number
    pageSize: number
  }
}

export interface ResultDetailResponse extends ApiResponse {
  data: PipelineResult
}

/**
 * Fetch all call results with optional filtering and pagination
 */
export const fetchResults = async (filters: ResultsFilters = {}): Promise<ResultsResponse> => {
  try {
    console.log('[RESULTS API] Fetching results with filters:', filters)
    
    const params = new URLSearchParams()
    
    if (filters.status) params.append('status', filters.status)
    if (filters.dateFrom) params.append('date_from', filters.dateFrom)
    if (filters.dateTo) params.append('date_to', filters.dateTo)
    if (filters.searchQuery) params.append('search', filters.searchQuery)
    if (filters.sort) params.append('sort', filters.sort)
    if (filters.direction) params.append('direction', filters.direction)
    if (filters.limit) params.append('limit', filters.limit.toString())
    if (filters.offset) params.append('offset', filters.offset.toString())
    
    const queryString = params.toString()
    const url = `/api/v1/pipeline/results${queryString ? `?${queryString}` : ''}`
    
    console.log('[RESULTS API] Request URL:', url)
    
    const response = await apiClient.get(url)
    
    console.log('[RESULTS API] Response received:', {
      status: response.status,
      dataLength: response.data?.data?.results?.length || 0,
      total: response.data?.data?.total || 0
    })
    
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error fetching results:', error)
    throw error
  }
}

/**
 * Fetch detailed information for a specific call result
 */
export const fetchResultDetail = async (callId: string): Promise<ResultDetailResponse> => {
  try {
    console.log('[RESULTS API] Fetching result detail for call ID:', callId)
    
    const response = await apiClient.get(`/api/v1/pipeline/results/${callId}`)
    
    console.log('[RESULTS API] Detail response received:', {
      status: response.status,
      callId: response.data?.data?.call_id,
      hasTranscription: !!response.data?.data?.transcription,
      hasAnalysis: !!response.data?.data?.nlp_analysis
    })
    
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error fetching result detail:', error)
    throw error
  }
}

/**
 * Fetch results for a specific upload session
 */
export const fetchResultsByUpload = async (uploadId: string): Promise<ResultsResponse> => {
  try {
    console.log('[RESULTS API] Fetching results for upload ID:', uploadId)
    
    const response = await apiClient.get(`/api/v1/pipeline/results/upload/${uploadId}`)
    
    console.log('[RESULTS API] Upload results response:', {
      status: response.status,
      resultsCount: response.data?.data?.results?.length || 0
    })
    
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error fetching upload results:', error)
    throw error
  }
}

/**
 * Get real-time status updates for pending/processing calls
 */
export const fetchStatusUpdates = async (callIds: string[]): Promise<PipelineStatus[]> => {
  try {
    if (callIds.length === 0) {
      console.log('[RESULTS API] No call IDs provided for status updates')
      return []
    }
    
    console.log('[RESULTS API] Fetching status updates for calls:', callIds)
    
    const params = new URLSearchParams()
    callIds.forEach(id => params.append('call_ids', id))
    
    const response = await apiClient.get(`/api/v1/pipeline/results/status?${params.toString()}`)
    
    console.log('[RESULTS API] Status updates received:', {
      status: response.status,
      updatesCount: response.data?.data?.results?.length || 0
    })
    
    return response.data?.data?.results || []
  } catch (error) {
    console.error('[RESULTS API] Error fetching status updates:', error)
    throw error
  }
}

/**
 * Search results by text content (transcription, keywords, etc.)
 */
export const searchResults = async (query: string, filters: Omit<ResultsFilters, 'searchQuery'> = {}): Promise<ResultsResponse> => {
  try {
    console.log('[RESULTS API] Searching results with query:', query)
    
    const searchFilters: ResultsFilters = { ...filters, searchQuery: query }
    return await fetchResults(searchFilters)
  } catch (error) {
    console.error('[RESULTS API] Error searching results:', error)
    throw error
  }
}

/**
 * Export results to various formats (CSV, JSON, etc.)
 */
export const exportResults = async (filters: ResultsFilters = {}, format: 'csv' | 'json' = 'json'): Promise<Blob> => {
  try {
    console.log('[RESULTS API] Exporting results in format:', format)
    
    const params = new URLSearchParams()
    params.append('format', format)
    
    if (filters.status) params.append('status', filters.status)
    if (filters.dateFrom) params.append('date_from', filters.dateFrom)
    if (filters.dateTo) params.append('date_to', filters.dateTo)
    
    const response = await apiClient.get(`/api/v1/pipeline/results/export?${params.toString()}`, {
      responseType: 'blob'
    })
    
    console.log('[RESULTS API] Export completed:', {
      status: response.status,
      contentType: response.headers['content-type'],
      size: response.data?.size || 0
    })
    
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error exporting results:', error)
    throw error
  }
}

/**
 * Delete a single result by call ID
 */
export const deleteResult = async (callId: string): Promise<ApiResponse> => {
  try {
    console.log('[RESULTS API] Deleting result for call ID:', callId)
    const response = await apiClient.delete(`/api/v1/pipeline/results/${callId}`)
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error deleting result:', error)
    throw error
  }
}

/**
 * Clear all results from DB and remove uploaded files
 */
export const clearAllResults = async (): Promise<ApiResponse> => {
  try {
    console.log('[RESULTS API] Clearing all results')
    const response = await apiClient.delete('/api/v1/pipeline/results')
    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error clearing results:', error)
    throw error
  }
}

/**
 * Export a single transcript in TXT, DOCX, or PDF format
 */
export type ExportFormat = 'txt' | 'docx' | 'pdf'

export const exportTranscript = async (callId: string, format: ExportFormat = 'txt'): Promise<Blob> => {
  try {
    console.log('[RESULTS API] Exporting transcript:', { callId, format })

    const response = await apiClient.get(`/api/v1/pipeline/results/${callId}/export?format=${format}`, {
      responseType: 'blob'
    })

    console.log('[RESULTS API] Export completed:', {
      status: response.status,
      contentType: response.headers['content-type'],
      size: response.data?.size || 0
    })

    return response.data
  } catch (error) {
    console.error('[RESULTS API] Error exporting transcript:', error)
    throw error
  }
}
