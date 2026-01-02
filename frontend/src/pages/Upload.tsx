import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { API_ENDPOINTS, UI_CONFIG } from '../types/constants'
import { apiClient } from '@/services/api/client'
import { Button, Card } from '../components/Shared'
// Live batch mode: final transcript only; no SSE stream

interface UploadFile {
  id: string
  name: string
  size: number
  type: string
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error'
  progress: number
  error?: string
  file?: File
  callId?: string
  uploadedAt?: string
}

const Capture: React.FC = () => {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [processingTick, setProcessingTick] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState<string>('')
  const [liveSource, setLiveSource] = useState<'mic' | 'upload' | null>(null)
  const [liveCallId, setLiveCallId] = useState<string | null>(null)
  const [liveLoading, setLiveLoading] = useState<boolean>(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [uploadedCallId, setUploadedCallId] = useState<string | null>(null)
  const [copied, setCopied] = useState<boolean>(false)
  const [newlyCompleted, setNewlyCompleted] = useState<string[]>([])
  const [showFormattedText, setShowFormattedText] = useState<boolean>(true)
  const [modelStatus, setModelStatus] = useState<'unknown' | 'not_loaded' | 'loading' | 'ready'>('unknown')
  const [modelStatusMessage, setModelStatusMessage] = useState<string | null>(null)

  // LocalStorage functions for state persistence
  const STORAGE_KEY = 'transcriptai_upload_files'

  const saveFilesToStorage = useCallback((files: UploadFile[]) => {
    try {
      // Filter out File objects (can't be serialized)
      const serializableFiles = files.map(f => ({
        ...f,
        file: undefined // Remove File object
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableFiles))
      console.log(`[CAPTURE] Saved ${files.length} files to storage`)
    } catch (error) {
      console.error('[CAPTURE] Failed to save files to storage:', error)
    }
  }, [])

  const loadFilesFromStorage = useCallback((): UploadFile[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const files = JSON.parse(stored)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

        // Keep only recent files or processing files
        const filteredFiles = files.filter((f: UploadFile) => {
          // Always keep processing files
          if (f.status === 'processing') return true

          // Keep completed files that are less than 24 hours old
          if (f.uploadedAt && new Date(f.uploadedAt) > oneDayAgo) return true

          // Remove old completed files
          return false
        })

        // Update storage if we filtered out any files
        if (filteredFiles.length !== files.length) {
          const removedCount = files.length - filteredFiles.length
          console.log(`[CAPTURE] Cleaned up ${removedCount} old files from storage`)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredFiles))
        }

        console.log(`[CAPTURE] Loaded ${filteredFiles.length} files from storage`)
        return filteredFiles
      }
    } catch (error) {
      console.error('[CAPTURE] Failed to load files from storage:', error)
    }
    return []
  }, [])

  // Wrapper function for setFiles that also saves to storage
  const updateFiles = useCallback((updater: (prev: UploadFile[]) => UploadFile[]) => {
    setFiles(prev => {
      const newFiles = updater(prev)
      saveFilesToStorage(newFiles)
      return newFiles
    })
  }, [saveFilesToStorage])

  /**
   * Check speech model status by polling the backend /health endpoint.
   * 
   * BREAKDOWN OF "CHECKING SPEECH MODEL STATUS":
   * 
   * 1. Frontend polls /health endpoint every 5 seconds
   * 2. Backend /health endpoint checks whisper_processor.get_status()
   * 3. get_status() returns "ready" if _model_loaded flag is True
   * 4. Model loading (_load_model) just stores model_id string (~0.001s)
   * 5. Actual model weights load lazily on first transcription call
   * 
   * TIMING BREAKDOWN:
   * - Model loading: ~0.001 seconds (just stores model_id)
   * - Backend startup: ~82-86 seconds (Python initialization)
   * - Health check execution: ~1-5ms per request
   * - Total delay: Backend startup time, not model loading time
   * 
   * WHY NO IMPROVEMENT:
   * - PyInstaller cache eliminates extraction delay (~40s)
   * - But Python initialization (~40-45s) happens every launch
   * - Model status becomes "ready" immediately, but backend takes 80+s to start
   */
  const refreshModelStatus = useCallback(async (): Promise<'ready' | 'loading' | 'not_loaded' | 'unknown'> => {
    const modelStatusStartTime = performance.now()
    const modelStatusStartTimestamp = new Date().toISOString()
    console.log('[MODEL_STATUS] phase=health_check_start timestamp=' + modelStatusStartTimestamp)

    try {
      const requestStartTime = performance.now()
      const requestStartTimestamp = new Date().toISOString()
      console.log('[MODEL_STATUS] phase=api_request_start timestamp=' + requestStartTimestamp)

      const response = await apiClient.get('/health')

      const responseReceivedTime = performance.now()
      const responseReceivedTimestamp = new Date().toISOString()
      const requestElapsed = responseReceivedTime - requestStartTime
      console.log('[MODEL_STATUS] phase=api_response_received timestamp=' + responseReceivedTimestamp + ' elapsed=' + requestElapsed.toFixed(2) + 'ms')

      const parseStartTime = performance.now()
      const models = response.data?.models ?? {}
      const whisperStatus = models.whisper?.status as string | undefined
      const nlpStatus = models.nlp?.status as string | undefined
      const statuses = [whisperStatus, nlpStatus].filter(Boolean) as string[]

      let nextStatus: 'ready' | 'loading' | 'not_loaded' | 'unknown' = 'unknown'
      if (statuses.length && statuses.every(status => status === 'ready')) {
        nextStatus = 'ready'
      } else if (statuses.some(status => status === 'loading')) {
        nextStatus = 'loading'
      } else if (statuses.some(status => status === 'not_loaded')) {
        nextStatus = 'not_loaded'
      }
      const parseElapsed = performance.now() - parseStartTime
      console.log('[MODEL_STATUS] phase=parse_status elapsed=' + parseElapsed.toFixed(2) + 'ms whisper_status=' + whisperStatus + ' nlp_status=' + nlpStatus + ' final_status=' + nextStatus)

      const updateStateStartTime = performance.now()
      setModelStatus(nextStatus)

      if (nextStatus === 'loading') {
        setModelStatusMessage('Preparing speech model… first load can take up to a minute.')
      } else if (nextStatus === 'not_loaded') {
        setModelStatusMessage('Speech model unavailable. Uploads will resume automatically once it finishes loading.')
      } else if (nextStatus === 'unknown') {
        setModelStatusMessage('Checking speech model status…')
      } else {
        setModelStatusMessage(null)
      }
      const updateStateElapsed = performance.now() - updateStateStartTime
      console.log('[MODEL_STATUS] phase=update_state elapsed=' + updateStateElapsed.toFixed(2) + 'ms')

      const totalElapsed = performance.now() - modelStatusStartTime
      console.log('[MODEL_STATUS] phase=complete total_elapsed=' + totalElapsed.toFixed(2) + 'ms')

      return nextStatus
    } catch (error) {
      const totalElapsed = performance.now() - modelStatusStartTime
      console.error('[MODEL_STATUS] phase=error elapsed=' + totalElapsed.toFixed(2) + 'ms error=', error)
      console.error('[CAPTURE] Failed to fetch health status', error)
      setModelStatus('unknown')
      const errorMsg = (error as any)?.message || 'Unknown error'
      setModelStatusMessage(`Error checking speech model status: ${errorMsg}`)
      return 'unknown'
    }
  }, [])

  const ensureModelsReady = useCallback(async (maxWaitMs = 20000) => {
    const deadline = Date.now() + maxWaitMs
    let status = await refreshModelStatus()
    if (status === 'ready') {
      return true
    }

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      status = await refreshModelStatus()
      if (status === 'ready') {
        return true
      }
    }

    return status === 'ready'
  }, [refreshModelStatus])

  useEffect(() => {
    const componentMountTime = performance.now()
    const componentMountTimestamp = new Date().toISOString()
    console.log('[MODEL_STATUS] phase=component_mount timestamp=' + componentMountTimestamp)

    const firstCheckStartTime = performance.now()
    refreshModelStatus().then(() => {
      const firstCheckElapsed = performance.now() - firstCheckStartTime
      const mountToFirstCheckElapsed = performance.now() - componentMountTime
      console.log('[MODEL_STATUS] phase=first_check_complete elapsed=' + firstCheckElapsed.toFixed(2) + 'ms mount_to_check=' + mountToFirstCheckElapsed.toFixed(2) + 'ms')
    })

    const intervalId = window.setInterval(() => {
      refreshModelStatus()
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshModelStatus])

  // Poll backend for file processing status
  const pollFileStatus = useCallback(async (callId: string): Promise<{
    status: 'processing' | 'completed' | 'failed'
    progress?: number
    error?: string
  }> => {
    try {
      console.log(`[CAPTURE] Polling status for call_id: ${callId}`)
      const response = await apiClient.get(`/api/v1/pipeline/results/${callId}`)
      const data = response.data.data

      if (data.status === 'completed') {
        console.log(`[CAPTURE] File ${callId} completed processing`)
        return { status: 'completed' }
      } else if (data.status === 'failed') {
        console.log(`[CAPTURE] File ${callId} failed processing`)
        return { status: 'failed', error: data.error || 'Processing failed' }
      } else {
        console.log(`[CAPTURE] File ${callId} still processing`)
        return { status: 'processing' }
      }
    } catch (error) {
      console.error(`[CAPTURE] Failed to poll status for ${callId}:`, error)
      return { status: 'processing' } // Assume still processing on error
    }
  }, [])

  // Fetch transcript for uploaded file
  const fetchUploadedTranscript = useCallback(async (callId: string, attempt = 0) => {
    try {
      console.log(`[CAPTURE] Fetching transcript for call_id: ${callId}`)
      setLiveLoading(true)
      setLiveError(null)

      // Don't block on model status - backend will load model on-demand
      // Transcription will work even if model status shows "not_loaded"
      // The model loads automatically on first transcription request

      const response = await apiClient.get(`/api/v1/pipeline/results/${callId}`)
      const data = response.data?.data || {}
      const status = data.status
      const transcriptText = data.transcription?.transcription_text || ''

      console.log(`[CAPTURE] Transcript fetched:`, { callId, status, textLength: transcriptText.length })

      if ((status !== 'completed' || !transcriptText) && attempt < 4) {
        console.log(`[CAPTURE] Transcript not ready (status=${status}, len=${transcriptText.length}), retry ${attempt + 1}`)
        await new Promise(r => setTimeout(r, 1500))
        return fetchUploadedTranscript(callId, attempt + 1)
      }

      if (status !== 'completed' || !transcriptText) {
        console.log(`[CAPTURE] Transcript unavailable after retries for ${callId}`)
        return
      }

      // Populate Live Transcription box
      setLiveTranscript(transcriptText)
      setLiveSource('upload')
      setLiveCallId(callId)
    } catch (error) {
      console.error(`[CAPTURE] Failed to fetch transcript for ${callId}:`, error)
      setLiveError('Failed to fetch transcript')
    } finally {
      setLiveLoading(false)
    }
  }, [])

  // Copy transcript to clipboard (always use raw text)
  const copyTranscript = useCallback(async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(liveTranscript)
      } else {
        // Fallback for older browsers
        const ta = document.createElement('textarea')
        ta.value = liveTranscript
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000) // Reset after 2 seconds
    } catch (error) {
      console.error('Copy failed:', error)
    }
  }, [liveTranscript])

  // Download transcript as text file
  const downloadTranscript = useCallback(() => {
    try {
      const blob = new Blob([liveTranscript], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')

      // Generate filename based on source and call ID
      const source = liveSource === 'mic' ? 'live-mic' : 'upload'
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      a.download = `${source}-${liveCallId?.slice(0, 8) || timestamp}.txt`

      a.href = url
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }, [liveTranscript, liveSource, liveCallId])

  // Cancel processing for a specific file
  const cancelFileProcessing = useCallback((fileId: string) => {
    console.log(`[CAPTURE] Cancelling processing for file: ${fileId}`)
    updateFiles(prev => prev.map(f =>
      f.id === fileId
        ? { ...f, status: 'error', error: 'Processing cancelled by user' }
        : f
    ))
  }, [updateFiles])


  // Check for files that have been processing too long (timeout)
  const checkProcessingTimeouts = useCallback(() => {
    const now = Date.now()
    const timeoutMs = 10 * 60 * 1000 // 10 minutes timeout

    updateFiles(prev => prev.map(f => {
      if (f.status === 'processing' && f.uploadedAt) {
        const processingTime = now - new Date(f.uploadedAt).getTime()
        if (processingTime > timeoutMs) {
          console.log(`[CAPTURE] File ${f.name} timed out after ${Math.round(processingTime / 1000 / 60)} minutes`)
          return { ...f, status: 'error', error: 'Processing timed out (10+ minutes)' }
        }
      }
      return f
    }))
  }, [updateFiles])

  // Format transcript text for better readability
  const formatTranscriptText = useCallback((text: string): string => {
    if (!text || text.trim().length === 0) return text

    let formatted = text.trim()

    // Clean up multiple spaces
    formatted = formatted.replace(/\s+/g, ' ')

    // Add proper spacing after punctuation if missing
    formatted = formatted.replace(/([.!?])([A-Za-z])/g, '$1 $2')
    formatted = formatted.replace(/([,;:])([A-Za-z])/g, '$1 $2')

    // Capitalize first letter of each sentence
    formatted = formatted.replace(/([.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase())

    // Ensure first letter is capitalized
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1)

    // Split into sentences and create paragraphs
    const sentences = formatted.split(/([.!?]+)/).filter(s => s.trim().length > 0)
    const paragraphs: string[] = []
    let currentParagraph = ''

    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i]?.trim() || ''
      const punctuation = sentences[i + 1]?.trim() || ''

      if (sentence) {
        const fullSentence = sentence + punctuation
        currentParagraph += fullSentence + ' '

        // Create paragraph break every 3-4 sentences or on natural pauses
        if (currentParagraph.split(/[.!?]/).length > 3 ||
          fullSentence.includes('right') ||
          fullSentence.includes('okay') ||
          fullSentence.includes('so')) {
          paragraphs.push(currentParagraph.trim())
          currentParagraph = ''
        }
      }
    }

    // Add remaining text as final paragraph
    if (currentParagraph.trim()) {
      paragraphs.push(currentParagraph.trim())
    }

    // Join paragraphs with double line breaks
    return paragraphs.join('\n\n')
  }, [])

  // Cycle processing label while any file is in 'processing'
  useEffect(() => {
    const anyProcessing = files.some(f => f.status === 'processing')
    if (!anyProcessing) return
    const id = window.setInterval(() => {
      setProcessingTick(t => (t + 1) % processingStages.length)
    }, 3000)
    return () => window.clearInterval(id)
  }, [files])

  // Fetch transcript when upload completes
  useEffect(() => {
    if (uploadedCallId) {
      console.log(`[CAPTURE] Upload completed, fetching transcript for: ${uploadedCallId}`)
      fetchUploadedTranscript(uploadedCallId)
    }
  }, [uploadedCallId, fetchUploadedTranscript])

  // Load files from storage on component mount
  useEffect(() => {
    const storedFiles = loadFilesFromStorage()
    if (storedFiles.length > 0) {
      setFiles(storedFiles)
      console.log(`[CAPTURE] Restored ${storedFiles.length} files from storage`)
    }
  }, [loadFilesFromStorage])

  // Check for processing timeouts every minute
  useEffect(() => {
    const timeoutInterval = setInterval(() => {
      checkProcessingTimeouts()
    }, 60000) // Check every minute

    return () => clearInterval(timeoutInterval)
  }, [checkProcessingTimeouts])

  // Polling mechanism for processing files
  useEffect(() => {
    const processingFiles = files.filter(f =>
      f.status === 'processing' && f.callId
    )

    if (processingFiles.length === 0) {
      console.log(`[CAPTURE] No files to poll`)
      return
    }

    console.log(`[CAPTURE] Starting polling for ${processingFiles.length} files:`,
      processingFiles.map(f => ({ id: f.id, callId: f.callId, name: f.name }))
    )

    const pollInterval = setInterval(async () => {
      console.log(`[CAPTURE] Polling ${processingFiles.length} processing files...`)

      for (const file of processingFiles) {
        if (file.callId) {
          try {
            const status = await pollFileStatus(file.callId)

            if (status.status === 'completed') {
              console.log(`[CAPTURE] File ${file.name} completed processing`)
              updateFiles(prev => prev.map(f =>
                f.id === file.id
                  ? { ...f, status: 'completed', progress: 100 }
                  : f
              ))
              if (file.callId) {
                fetchUploadedTranscript(file.callId)
              }
              // Add to newly completed notifications
              setNewlyCompleted(prev => [...prev, file.id])
              // Remove notification after 5 seconds
              setTimeout(() => {
                setNewlyCompleted(prev => prev.filter(id => id !== file.id))
              }, 5000)
            } else if (status.status === 'failed') {
              console.log(`[CAPTURE] File ${file.name} failed processing: ${status.error}`)
              updateFiles(prev => prev.map(f =>
                f.id === file.id
                  ? { ...f, status: 'error', error: status.error }
                  : f
              ))
            } else {
              console.log(`[CAPTURE] File ${file.name} still processing`)
            }
          } catch (error) {
            console.error(`[CAPTURE] Error polling file ${file.name}:`, error)
          }
        }
      }
    }, 5000) // Poll every 5 seconds

    return () => {
      console.log(`[CAPTURE] Stopping polling for ${processingFiles.length} files`)
      clearInterval(pollInterval)
    }
  }, [files, pollFileStatus, updateFiles, fetchUploadedTranscript])

  const processingLabel = processingStages[processingTick]

  // Handle file selection
  const handleFileSelect = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return

    const newFiles: UploadFile[] = Array.from(selectedFiles).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'pending',
      progress: 0,
      file,
      uploadedAt: new Date().toISOString()
    }))

    updateFiles(prev => [...prev, ...newFiles])
  }, [updateFiles])

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeLoading, setYoutubeLoading] = useState(false)
  const [youtubeError, setYoutubeError] = useState<string | null>(null)

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl) return
    setYoutubeLoading(true)
    setYoutubeError(null)
    setLiveTranscript('') // clear previous

    try {
      console.log(`[CAPTURE] Transcribing YouTube URL: ${youtubeUrl}`)
      const response = await apiClient.post('/api/v1/youtube/transcribe', { url: youtubeUrl })
      const data = response.data // { source, title, text, segments, duration }

      console.log(`[CAPTURE] YouTube transcription success:`, data.title)
      setLiveTranscript(data.text || '')
      setLiveSource('upload') // Re-use 'upload' type for now to enable download features
      setLiveCallId(`yt-${Date.now()}`) // Mock ID

      // Optional: Show success toast or message
    } catch (error: any) {
      console.error('[CAPTURE] YouTube transcription failed:', error)
      setYoutubeError(error?.response?.data?.detail || error.message || 'Transcription failed')
    } finally {
      setYoutubeLoading(false)
    }
  }

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])


  // Upload file to backend
  const uploadFile = async (file: UploadFile) => {
    try {
      console.log(`[CAPTURE] Starting upload for file: ${file.name}`)
      setUploading(true)

      // Update status to uploading
      updateFiles(prev => prev.map(f =>
        f.id === file.id
          ? { ...f, status: 'uploading', progress: 0 }
          : f
      ))

      // Create FormData for file upload
      const formData = new FormData()
      const actualFile = file.file
      if (!actualFile) throw new Error('File content not available')
      formData.append('file', actualFile)

      console.log(`[CAPTURE] Sending file to: ${API_ENDPOINTS.UPLOAD}`)
      console.log(`[CAPTURE] File details:`, {
        name: actualFile.name,
        size: actualFile.size,
        type: actualFile.type
      })

      // Make API call to backend using relative URL (will use Vite proxy)
      const uploadUrl = API_ENDPOINTS.UPLOAD
      console.log(`[CAPTURE] Upload URL: ${uploadUrl}`)

      let uploadFinished = false
      const response = await apiClient.post(uploadUrl, formData, {
        timeout: UI_CONFIG.UPLOAD_TIMEOUT,
        // Do NOT set 'Content-Type' for FormData; the browser will add the correct boundary
        onUploadProgress: (evt: any) => {
          const total = evt.total || actualFile.size || 0
          const loaded = evt.loaded || 0
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : loaded ? 100 : 0
          // Debug log to verify progress events
          if (pct % 10 === 0) console.log(`[CAPTURE] Progress ${pct}% (${loaded}/${total})`)
          updateFiles(prev => prev.map(f => f.id === file.id ? { ...f, progress: pct } : f))
          if (pct >= 100 && !uploadFinished) {
            uploadFinished = true
            // Show processing state while awaiting server-side pipeline
            updateFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f))
          }
        }
      })

      console.log(`[CAPTURE] Response status: ${response.status}`)
      console.log(`[CAPTURE] Response headers:`, response.headers)

      const result = response.data
      console.log(`[CAPTURE] Upload successful:`, result)

      // Extract call_id from upload response for transcript fetching
      const callId = result.call_id
      if (callId) {
        console.log(`[CAPTURE] Extracted call_id: ${callId}`)
        setUploadedCallId(callId)
      }

      // Keep file in processing state until pipeline finishes
      updateFiles(prev => prev.map(f =>
        f.id === file.id
          ? { ...f, status: 'processing', progress: 100, callId }
          : f
      ))

      console.log(`[CAPTURE] File ${file.name} uploaded successfully!`)

      // Don't immediately switch pages - let user see the completed status
      // if (onUploadComplete) {
      //   onUploadComplete()
      // }

      // Show success message instead
      // Optional: inline success message or toast could be added here

    } catch (error) {
      console.error(`[CAPTURE] Error uploading ${file.name}:`, error)

      updateFiles(prev => prev.map(f =>
        f.id === file.id
          ? {
            ...f,
            status: 'error',
            error: (error as any)?.message || 'Upload failed'
          }
          : f
      ))
    } finally {
      setUploading(false)
    }
  }

  // Start upload for all pending files
  const startUpload = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    console.log(`[CAPTURE] Starting upload for ${pendingFiles.length} pending files`)

    for (const file of pendingFiles) {
      await uploadFile(file)
    }
  }

  // Clear completed files
  const clearCompleted = () => {
    updateFiles(prev => prev.filter(f => f.status !== 'completed'))
  }

  // Remove file
  const removeFile = (fileId: string) => {
    updateFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const uploadStats = useMemo(() => {
    const completed = files.filter(f => f.status === 'completed').length
    const processing = files.filter(f => f.status === 'processing' || f.status === 'uploading').length
    const pending = files.filter(f => f.status === 'pending').length
    return {
      total: files.length,
      completed,
      processing,
      pending,
    }
  }, [files])

  const hasFiles = files.length > 0

  return (
    <div className="space-y-8">
      <section className="glass-surface rounded-3xl border border-white/10 px-6 py-8 shadow-glow md:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-white/60">Capture</p>
            <h1 className="gradient-heading mt-3 text-4xl font-semibold leading-tight">
              Audio Capture
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/70">
              Record live or import existing audio files for instant AI-powered transcription. Supported formats: WAV, MP3, M4A, FLAC (up to 10GB).
            </p>
          </div>

        </div>
      </section>

      {modelStatusMessage && (
        <div
          className={`glass-surface flex items-center gap-3 rounded-2xl border px-4 py-4 text-sm shadow-glow ${modelStatus === 'loading'
            ? 'border-yellow-400/30 text-yellow-100'
            : modelStatus === 'not_loaded'
              ? 'border-pink-500/40 text-rose-100'
              : 'border-cyan-400/30 text-cyan-100'
            }`}
        >
          <span
            className={`inline-flex h-3 w-3 rounded-full ${modelStatus === 'loading'
              ? 'bg-yellow-300 animate-pulse'
              : modelStatus === 'not_loaded'
                ? 'bg-pink-500'
                : 'bg-cyan-300 animate-ping'
              }`}
          />
          <span>{modelStatusMessage}</span>
        </div>
      )}

      {newlyCompleted.length > 0 && (
        <div className="glass-surface rounded-2xl border border-emerald-400/20 px-4 py-4 text-sm text-emerald-100 shadow-glow-green">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✨</span>
            <div>
              <p className="font-semibold">
                {newlyCompleted.length === 1 ? 'Fresh transcript ready' : `${newlyCompleted.length} files just finished`}
              </p>
              <p className="text-white/70">
                Completed transcripts auto-sync with the Transcripts tab in real time.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Live Mic"
          subtitle="Capture ad-hoc sessions with animated visual feedback."
          icon="🎤"
          className="relative overflow-hidden"
        >
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-pink-500/40 to-cyan-400/40 blur-3xl" aria-hidden />
          <div className="relative z-10 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <LiveMicPanel
                onTranscriptStart={() => {
                  console.log('[DEBUG] onTranscriptStart called - Resetting states')
                  console.log('[DEBUG] Previous state:', {
                    liveTranscript: liveTranscript?.length || 0,
                    liveCallId,
                    liveError,
                    liveSource
                  })
                  setLiveLoading(true)
                  setLiveError(null)
                  setLiveTranscript('')
                  setLiveCallId(null)
                  setLiveSource('mic')
                  console.log('[DEBUG] States reset - liveTranscript cleared, liveCallId cleared')
                }}
                onTranscriptComplete={({ text, callId }) => {
                  console.log('[DEBUG] onTranscriptComplete called')
                  console.log('[DEBUG] Received data:', {
                    textLength: text?.length || 0,
                    callId,
                    textPreview: text?.substring(0, 50) + '...' || 'empty'
                  })
                  setLiveLoading(false)
                  setLiveError(null)
                  setLiveTranscript(text)
                  setLiveCallId(callId)
                  setLiveSource('mic')
                  console.log('[DEBUG] States updated - transcript set, callId set')
                }}
                onTranscriptError={(message) => {
                  console.log('[DEBUG] onTranscriptError called')
                  console.log('[DEBUG] Error message:', message)
                  setLiveLoading(false)
                  setLiveError(message)
                  console.log('[DEBUG] Error state set - loading false, error message set')
                }}
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Keep the tab focused for the best live capture fidelity. Completed takes appear under Transcripts automatically.
            </div>
          </div>
        </Card>

        <Card
          title="Import Audio"
          subtitle="Drag & drop uploader with progress pulses."
          icon="📼"
          className="flex flex-col gap-6"
        >
          <div
            className={`rounded-2xl border-2 border-dashed p-10 text-center transition-all ${isDragOver ? 'border-cyan-400 bg-white/10' : 'border-white/20 hover:border-cyan-300/70'
              }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="mb-4 text-5xl">🎶</div>
            <h3 className="text-xl font-semibold">Drop audio files here or browse</h3>
            <p className="mt-2 text-sm text-white/70">
              Drag your files in or use the selector to stay in flow.
            </p>
            <input
              id="file-input"
              type="file"
              multiple
              accept="audio/*"
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />
            <Button
              variant="primary"
              size="md"
              className="mt-6"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              Choose Files
            </Button>
          </div>

          {hasFiles && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="success"
                    size="sm"
                    onClick={startUpload}
                    disabled={uploading || !files.some(f => f.status === 'pending')}
                    isLoading={uploading}
                  >
                    Process Files
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearCompleted}
                    disabled={!files.some(f => f.status === 'completed')}
                  >
                    Clear Completed
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-white">
                          {file.name}
                          {file.uploadedAt && (
                            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-normal text-white/60">
                              {new Date(file.uploadedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white/60">
                          {formatFileSize(file.size)} · {file.type}
                          {file.callId && (
                            <span className="ml-2 text-xs text-white/50">
                              ID: {file.callId.slice(0, 8)}
                            </span>
                          )}
                        </p>
                        {file.status === 'error' && (
                          <p className="text-sm text-rose-300">{file.error}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 text-sm text-white/70 sm:items-end">
                        {file.status === 'uploading' && (
                          <div className="w-48">
                            <div className="h-2 rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width]"
                                style={{ width: `${file.progress}%` }}
                              />
                            </div>
                            <p className="mt-1 text-right text-xs text-white/60">{file.progress}%</p>
                          </div>
                        )}
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-wide text-white">
                          {file.status === 'completed'
                            ? '✅ Completed'
                            : file.status === 'uploading'
                              ? 'Uploading'
                              : file.status === 'processing'
                                ? processingLabel
                                : file.status === 'error'
                                  ? 'Error'
                                  : 'Pending'}
                        </span>
                        <div className="flex gap-2">
                          {file.status === 'processing' && (
                            <Button
                              variant="danger"
                              size="sm"
                              className="!px-3 !py-1 text-xs"
                              onClick={() => cancelFileProcessing(file.id)}
                            >
                              Cancel
                            </Button>
                          )}
                          {file.status !== 'uploading' && file.status !== 'processing' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="!px-3 !py-1 text-xs text-white/70"
                              onClick={() => removeFile(file.id)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* New YouTube Card */}
        <Card
          title="Import from YouTube"
          subtitle="Paste a YouTube URL to transcribe instantly."
          icon="📺"
          className="col-span-full xl:col-span-2"
        >
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 placeholder-white/30 focus:border-cyan-400 focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
              />
              <Button
                variant="primary"
                onClick={handleYoutubeSubmit}
                disabled={!youtubeUrl || youtubeLoading}
              >
                {youtubeLoading ? 'Processing...' : 'Transcribe'}
              </Button>
            </div>
            {youtubeError && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200 border border-red-500/20">
                Error: {youtubeError}
              </div>
            )}
            <p className="text-xs text-white/50">
              Supports most YouTube videos. Tries captions first (instant), then falls back to audio processing (slower).
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Live Transcription"
        subtitle="Latest output from live capture or uploads."
        icon="📝"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/70">
            Latest transcript appears instantly after capture or upload completion.
          </p>
          {liveTranscript && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowFormattedText(!showFormattedText)}
              >
                {showFormattedText ? 'Formatted' : 'Raw'}
              </Button>
              <Button variant="ghost" size="sm" onClick={copyTranscript}>
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={downloadTranscript}>
                Download
              </Button>
              {copied && (
                <span className="rounded-full border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">
                  Copied!
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center">
          {liveLoading ? (
            <p className="text-sm text-white/60">Generating transcript…</p>
          ) : liveError ? (
            <p className="text-sm text-rose-300">{liveError}</p>
          ) : liveTranscript ? (
            <div className="space-y-2 text-left">
              <div className="text-xs uppercase tracking-wide text-white/50">
                {liveSource === 'mic' ? 'Live Mic' : 'Import'}
                {liveCallId ? ` • ${liveCallId.slice(0, 8)}` : ''}
              </div>
              <p className="text-sm text-white/80 whitespace-pre-wrap">
                {showFormattedText ? formatTranscriptText(liveTranscript) : liveTranscript}
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/60">No transcript available yet. Capture audio or upload a file.</p>
          )}
        </div>
      </Card>

      <Card
        title="Capture Guidelines"
        subtitle="Keep latency low and accuracy high."
        icon="📘"
      >
        <div className="grid gap-4 md:grid-cols-2 text-sm text-white/70">
          {[
            { icon: '🗂️', text: 'Supported formats: WAV, MP3, M4A, FLAC' },
            { icon: '💾', text: 'Maximum file size: 10GB' },
            { icon: '⚡', text: 'Uploads auto-start processing once complete' },
            { icon: '👀', text: 'Transcripts tab shows status updates' },
            { icon: '⏱️', text: 'Processing time depends on duration & complexity' },
            { icon: '📈', text: 'Higher quality audio produces more accurate transcripts' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/5 p-4">
              <span className="text-xl">{icon}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Cycling processing label
const processingStages = ['Processing audio…', 'Transcribing speech…', 'Running NLP analysis…']

// Hook-like logic in component scope will compute label

export default Capture

function LiveMicPanel({
  onTranscriptStart,
  onTranscriptComplete,
  onTranscriptError,
}: {
  onTranscriptStart?: () => void
  onTranscriptComplete?: (payload: { text: string; callId: string | null }) => void
  onTranscriptError?: (message: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Track in-flight chunk uploads to avoid truncation at stop
  const pendingUploadsRef = useRef<number>(0)
  const uploadsSettledResolveRef = useRef<null | (() => void)>(null)
  const uploadsSettledPromiseRef = useRef<Promise<void> | null>(null)
  // Batch-only live mic (no SSE): we rely on parent to show transcript
  const [processingFinal, setProcessingFinal] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 12 }, () => 0.2))

  useEffect(() => {
    if (!recording) {
      setLevels(prev => prev.map(() => 0.2))
      return
    }
    const id = window.setInterval(() => {
      setLevels(prev => prev.map(() => 0.2 + Math.random() * 0.8))
    }, 180)
    return () => window.clearInterval(id)
  }, [recording])

  const start = useCallback(async () => {
    try {
      setError(null)
      console.log('[DEBUG] LiveMicPanel start() called')
      console.log('[DEBUG] Previous sessionId:', sessionId)
      console.log('[LIVE] start(): creating session…')
      // Start session
      const res = await apiClient.post('/api/v1/live/start')
      const sid = res.data?.session_id as string
      if (!sid) throw new Error('Failed to create session')
      setSessionId(sid)
      console.log('[DEBUG] New sessionId set:', sid)
      console.log('[LIVE] start(): session created', { sessionId: sid })
      // Clear any previous transcript immediately for the new session
      if (onTranscriptStart) {
        console.log('[DEBUG] LiveMicPanel start() - invoking onTranscriptStart to reset transcript state')
        onTranscriptStart()
      }

      // Get mic
      console.log('[LIVE] start(): requesting mic via getUserMedia')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const preferredMime = 'audio/webm;codecs=opus'
      const mimeSupported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferredMime)
      const recorderOptions = mimeSupported ? { mimeType: preferredMime } : undefined
      const mr = recorderOptions ? new MediaRecorder(stream, recorderOptions) : new MediaRecorder(stream)
      mediaRef.current = mr
      console.log('[LIVE] start(): MediaRecorder ready', {
        mimeType: mr.mimeType,
        requestedMime: mimeSupported ? preferredMime : 'default',
        state: mr.state
      })

      mr.ondataavailable = async (ev: BlobEvent) => {
        try {
          if (!sessionId && sid) setSessionId(sid)
          const s = sid  // Always use the new session ID from this recording
          if (!s) return
          const blob = ev.data
          if (!blob || blob.size === 0) {
            console.warn('[LIVE] ondataavailable: empty blob skipped')
            return
          }
          console.log('[LIVE] ondataavailable: chunk ready', { size: blob.size, type: blob.type })
          const fd = new FormData()
          const extension = blob.type === 'audio/mp4' ? 'm4a' : 'webm'
          const file = new File([blob], `chunk_${Date.now()}.${extension}`, { type: blob.type })
          fd.append('file', file)
          console.log('[LIVE] uploading chunk…', { sessionId: s, filename: file.name, size: file.size, note: 'Using new session ID from current recording' })
          const t0 = performance.now()
          // Initialize a settle promise the first time we upload
          if (!uploadsSettledPromiseRef.current) {
            uploadsSettledPromiseRef.current = new Promise<void>(resolve => {
              uploadsSettledResolveRef.current = resolve
            })
          }
          pendingUploadsRef.current += 1
          try {
            await apiClient.post(`/api/v1/live/chunk?session_id=${encodeURIComponent(s)}`, fd)
          } finally {
            pendingUploadsRef.current -= 1
            if (pendingUploadsRef.current <= 0 && uploadsSettledResolveRef.current) {
              // Resolve and reset so a new recording can recreate it
              uploadsSettledResolveRef.current()
              uploadsSettledResolveRef.current = null
              uploadsSettledPromiseRef.current = null
            }
          }
          const dt = Math.round(performance.now() - t0)
          console.log('[LIVE] chunk upload done', { ms: dt })
        } catch (e) {
          console.warn('[LIVE] chunk upload failed', e)
        }
      }
      mr.start(4000) // 4s chunks
      console.log('[LIVE] MediaRecorder started with 4000ms timeslice')
      setRecording(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to start recording')
      console.error('[LIVE] start() failed', e)
      try { mediaRef.current?.stop() } catch { }
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { }
      setRecording(false)
      setSessionId(null)
    }
  }, [sessionId])

  const stop = useCallback(async () => {
    try {
      console.log('[LIVE] stop(): stopping recorder and mic…')
      try { mediaRef.current?.requestData?.() } catch { }
      mediaRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
    } catch { }
    setRecording(false)
    setProcessingFinal(true)
    try {
      // Wait a little for MediaRecorder to emit the final dataavailable
      console.log('[LIVE] stop(): waiting 1200ms for recorder flush…')
      await new Promise(r => setTimeout(r, 1200))
      // Then wait for any in-flight chunk uploads to settle (with a cap)
      const waitForUploads = async (timeoutMs = 5000) => {
        if (pendingUploadsRef.current <= 0) return
        const p = uploadsSettledPromiseRef.current || new Promise<void>(resolve => setTimeout(resolve, 0))
        await Promise.race([
          p,
          new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
        ])
      }
      console.log('[LIVE] stop(): waiting for in-flight chunk uploads to settle…', { pending: pendingUploadsRef.current })
      await waitForUploads(5000)
      if (sessionId) {
        console.log('[LIVE] stop(): calling /live/stop', { sessionId })
        const t0 = performance.now()
        const res = await apiClient.post(
          `/api/v1/live/stop?session_id=${encodeURIComponent(sessionId)}`,
          undefined, // No request body
          {
            // Set indefinite timeout for this request
            timeout: 0,
          }
        )
        const dt = Math.round(performance.now() - t0)
        const txt = (res.data?.final_text as string) || ''
        const cid = (res.data?.call_id as string) || null
        const chunksCount = res.data?.chunks_count
        const concatOk = res.data?.concat_ok
        const durationSec = res.data?.duration_seconds
        const transcriptPath = res.data?.transcript_path
        const combinedPath = res.data?.combined_path
        console.log('[LIVE] stop(): response received', { ms: dt, chunksCount, concatOk, durationSec, callId: cid, transcriptPath, combinedPath, textLen: txt.length })

        // Check if transcription was successful
        if (!txt || txt.trim().length === 0) {
          console.warn('[LIVE] stop(): Transcription returned empty text', { callId: cid, chunksCount, concatOk })
          const errorMsg = 'Transcription returned empty text. This may indicate silence was detected or transcription failed.'
          onTranscriptError && onTranscriptError(errorMsg)
          return
        }

        setCallId(cid)
        console.log('[DEBUG] LiveMicPanel stop() - calling onTranscriptComplete with:', { textLength: txt.length, callId: cid, textPreview: txt.substring(0, 50) })
        onTranscriptComplete && onTranscriptComplete({ text: txt, callId: cid })
        console.log('[DEBUG] LiveMicPanel stop() - onTranscriptComplete completed')
        setSessionId(null)
      } else {
        console.log('[DEBUG] LiveMicPanel stop() - no sessionId, calling onTranscriptError')
        onTranscriptError && onTranscriptError('Session not found')
      }
    } catch (e) {
      console.warn('[LIVE] stop() failed', e)
      const msg = e instanceof Error ? e.message : 'Failed to generate transcript'
      console.log('[DEBUG] LiveMicPanel stop() - error occurred, calling onTranscriptError with:', msg)
      onTranscriptError && onTranscriptError(msg)
    } finally {
      setProcessingFinal(false)
      setSessionId(null)
    }
  }, [sessionId, onTranscriptStart, onTranscriptComplete, onTranscriptError])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-white/70">
          {recording
            ? 'Listening for every detail...'
            : processingFinal
              ? 'Processing final transcript…'
              : callId
                ? 'Transcript ready — see Live Transcription or Transcripts tab.'
                : 'Press record to capture high-fidelity audio.'}
        </div>
        {sessionId && (
          <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70">
            Session · {sessionId.slice(0, 8)}
          </span>
        )}
      </div>
      {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-100">{error}</div>}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <button
          onClick={recording ? stop : start}
          className={`relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-pink-500/50 bg-gradient-to-br from-pink-500 via-red-500 to-orange-500 text-white shadow-glow-pink transition-transform hover:scale-105 ${recording ? 'animate-mic-ripple' : ''
            }`}
        >
          <span className="text-lg font-semibold tracking-wide uppercase">
            {recording ? 'Stop' : 'Rec'}
          </span>
          <span
            className="absolute inset-3 rounded-full bg-slate-950/60"
            aria-hidden
          />
          <span className="relative z-10 text-2xl">{recording ? '■' : '●'}</span>
        </button>
        <div className="flex-1">
          <div className="flex h-24 items-end justify-between gap-1">
            {levels.map((value, idx) => (
              <span
                key={`level-${idx}`}
                className="w-2 rounded-full bg-gradient-to-b from-cyan-400 via-blue-500 to-purple-500"
                style={{ height: `${Math.max(20, value * 100)}%`, opacity: recording ? 1 : 0.35 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
