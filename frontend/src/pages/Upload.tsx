import React, { useState, useCallback, useEffect, useRef } from 'react'
import { API_ENDPOINTS, UI_CONFIG } from '../types/constants'
import { apiClient } from '@/services/api/client'
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

interface CaptureProps {
  onNavigate?: (page: 'dashboard' | 'capture' | 'transcripts') => void
}

const Capture: React.FC<CaptureProps> = ({ onNavigate }) => {
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

  const refreshModelStatus = useCallback(async (): Promise<'ready' | 'loading' | 'not_loaded' | 'unknown'> => {
    try {
      const response = await apiClient.get('/health')
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

      return nextStatus
    } catch (error) {
      console.error('[CAPTURE] Failed to fetch health status', error)
      setModelStatus('unknown')
      setModelStatusMessage('Checking speech model status…')
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
    refreshModelStatus()
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

      const ready = await ensureModelsReady()
      if (!ready) {
        console.log('[CAPTURE] Speech model still warming up, delaying transcript fetch')
        setLiveLoading(false)
        setLiveError('Speech model is still warming up. Please try again in a moment.')
        return
      }

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

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-semibold text-gray-900">Capture Audio</h1>
          <p className="text-gray-600 text-base max-w-2xl mx-auto">
            Record live or import existing audio for transcription and analysis. Supported formats: WAV, MP3, M4A, FLAC
          </p>
        </div>

        {modelStatusMessage && (
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
              modelStatus === 'loading'
                ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
                : modelStatus === 'not_loaded'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                modelStatus === 'loading'
                  ? 'bg-yellow-400 animate-pulse'
                  : modelStatus === 'not_loaded'
                    ? 'bg-red-400'
                    : 'bg-blue-400 animate-pulse'
              }`}
            />
            <span>{modelStatusMessage}</span>
          </div>
        )}

        {/* Notifications for newly completed files */}
        {newlyCompleted.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center">
              <span className="text-green-400 text-xl mr-3">✅</span>
              <div>
                <h3 className="text-sm font-medium text-green-800">
                  {newlyCompleted.length === 1 ? 'File completed!' : `${newlyCompleted.length} files completed!`}
                </h3>
                <p className="text-sm text-green-700 mt-1">
                  {newlyCompleted.length === 1 
                    ? 'Your file has finished processing and is ready for download.'
                    : 'Your files have finished processing and are ready for download.'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Live Mic card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <span role="img" aria-hidden>🎤</span> Live Mic
              </h2>
              <span className="text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-600 px-2 py-1 rounded-full">
                Beta
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Capture ad-hoc audio directly from your browser. Start and stop to generate transcripts instantly.
            </p>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 mb-6">
              <LiveMicPanel
                onNavigate={onNavigate}
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
            <div className="text-sm text-blue-700 bg-blue-100 border border-blue-200 rounded-xl px-4 py-3">
              <strong>Tip:</strong> Keep the browser tab focused while recording for best results. You can view the finished transcript in the Transcripts tab.
            </div>
          </div>

          {/* Import card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Import Audio Files</h2>
              <p className="text-sm text-gray-600">
                Upload existing audio files for transcription and analysis.
              </p>
            </div>

            <div
              className={`rounded-2xl border-2 border-dashed text-center p-10 transition-all ${
                isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="text-5xl mb-4 text-blue-500">🎶</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Drop audio files here, or click to browse
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Drag and drop your audio files, or click the button below to select files
              </p>
              <input
                id="file-input"
                type="file"
                multiple
                accept="audio/*"
                onChange={(e) => handleFileSelect(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => document.getElementById('file-input')?.click()}
                className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all"
              >
                <span className="text-lg">⬆️</span>
                Choose Files
              </button>
            </div>

            {files.length > 0 && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                  <div className="flex space-x-3">
                    <button
                      onClick={startUpload}
                      disabled={uploading || !files.some(f => f.status === 'pending')}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      🚀 Process Files
                    </button>
                    <button
                      onClick={clearCompleted}
                      disabled={!files.some(f => f.status === 'completed')}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                    >
                      🗑️ Clear Completed
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 rounded-xl"
                    >
                      <div className="flex items-center space-x-4 flex-1">
                        <div className="text-2xl">
                          {file.status === 'completed' ? '✅' : 
                           file.status === 'uploading' ? '🔼' : 
                           file.status === 'processing' ? '🔄' :
                           file.status === 'error' ? '❌' : '📁'}
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-900">{file.name}</span>
                            {file.uploadedAt && (
                              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                                📅 {new Date(file.uploadedAt).toLocaleTimeString()}
                              </span>
                            )}
                            {file.status === 'error' && (
                              <span className="text-red-600 text-sm">{file.error}</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">
                            {formatFileSize(file.size)} • {file.type}
                            {file.callId && (
                              <span className="ml-2 text-xs text-gray-400">
                                ID: {file.callId.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Progress indicator for uploading */}
                        {file.status === 'uploading' && (
                          <div className="w-32">
                            <div className="bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${file.progress}%` }}
                              ></div>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 text-center">
                              {file.progress}%
                            </div>
                          </div>
                        )}


                        {/* Status badge */}
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          file.status === 'completed' ? 'bg-green-100 text-green-800' :
                          file.status === 'uploading' ? 'bg-blue-100 text-blue-800' :
                          file.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                          file.status === 'error' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {file.status === 'completed' ? '✅ Completed' : 
                           file.status === 'uploading' ? `🔼 Uploading ${file.progress}%` : 
                           file.status === 'processing' ? (
                             <>
                               <span className="inline-block w-3 h-3 rounded-full border-2 border-yellow-600 border-t-transparent animate-spin"></span>
                               {processingLabel}
                             </>
                           ) : 
                           file.status === 'error' ? '❌ Error' : '⏳ Pending'}
                        </span>

                        {/* Action buttons */}
                        {file.status === 'processing' && (
                          <button
                            onClick={() => cancelFileProcessing(file.id)}
                            className="text-red-600 hover:text-red-800 text-sm px-3 py-1.5 rounded border border-red-300 hover:bg-red-50 transition-colors"
                            title="Cancel processing"
                          >
                            ⏹️ Cancel
                          </button>
                        )}

                        {file.status !== 'uploading' && file.status !== 'processing' && (
                          <button
                            onClick={() => removeFile(file.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Remove file"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live transcription panel */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📝</span>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Live Transcription</h3>
                <p className="text-sm text-gray-500">Latest transcript will appear here after recording or import completes.</p>
              </div>
            </div>
            
            {/* Action buttons - only show when transcript exists */}
            {liveTranscript && (
              <div className="flex items-center gap-2 relative">
                {/* Formatting toggle */}
                <button
                  onClick={() => setShowFormattedText(!showFormattedText)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                    showFormattedText 
                      ? 'bg-blue-100 text-blue-700 border-blue-300' 
                      : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                  }`}
                  title={showFormattedText ? 'Switch to raw text' : 'Switch to formatted text'}
                >
                  {showFormattedText ? '📝 Formatted' : '📄 Raw'}
                </button>
                
                <button
                  onClick={copyTranscript}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
                  title="Copy transcript"
                >
                  <img src={`${import.meta.env.BASE_URL}copy_icon.png`} alt="Copy" className="w-4 h-4" />
                </button>
                <button
                  onClick={downloadTranscript}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
                  title="Download transcript"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
                {copied && (
                  <div className="absolute -bottom-8 right-0 px-2 py-1 rounded bg-green-100 text-green-700 text-xs shadow">
                    Copied!
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
            {liveLoading ? (
              <p className="text-sm text-gray-500">Generating transcript…</p>
            ) : liveError ? (
              <p className="text-sm text-red-500">{liveError}</p>
            ) : liveTranscript ? (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-400">{liveSource === 'mic' ? 'Live Mic' : 'Import'} {liveCallId ? `• ${liveCallId.slice(0, 8)}` : ''}</div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap text-left">
                  {showFormattedText ? formatTranscriptText(liveTranscript) : liveTranscript}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No transcript available yet. Capture audio or upload a file to see the transcription.</p>
            )}
          </div>
        </div>

        {/* Guidelines */}
        <div className="bg-[#e9f0ff] border border-blue-100 rounded-2xl p-6 md:p-8 space-y-6 lg:col-span-2">
          <div className="flex items-center gap-2 text-blue-600 text-lg font-semibold">
            📘 Capture Guidelines
          </div>
          <div className="grid gap-4 md:grid-cols-2 text-sm text-blue-800">
            <div className="flex items-start gap-3">
              <span className="text-xl">🗂️</span>
              <p><strong>Supported formats:</strong> WAV, MP3, M4A, FLAC</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">💾</span>
              <p><strong>Maximum file size:</strong> 10GB</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">⚡</span>
              <p>Files are automatically processed after capture</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">👀</span>
              <p>Check the Transcripts page to view processing status</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">⏱️</span>
              <p>Processing time depends on file length and complexity</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">📈</span>
              <p>Higher quality audio produces more accurate transcripts</p>
            </div>
          </div>
        </div>


      </div>
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
  onNavigate,
  onTranscriptStart,
  onTranscriptComplete,
  onTranscriptError,
}: {
  onNavigate?: (page: 'dashboard' | 'capture' | 'transcripts') => void
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
      try { mediaRef.current?.stop() } catch {}
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      setRecording(false)
      setSessionId(null)
    }
  }, [sessionId])

  const stop = useCallback(async () => {
    try {
      console.log('[LIVE] stop(): stopping recorder and mic…')
      try { mediaRef.current?.requestData?.() } catch {}
      mediaRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
    } catch {}
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
        setCallId(cid)
        console.log('[DEBUG] LiveMicPanel stop() - calling onTranscriptComplete with:', { textLength: txt.length, callId: cid })
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
    <div>
      <div className="flex items-center gap-3 mb-2">
        {!recording ? (
          <button onClick={start} className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700">● Record</button>
        ) : (
          <button onClick={stop} className="px-3 py-1.5 bg-gray-700 text-white rounded hover:bg-gray-800">■ Stop</button>
        )}
        {sessionId && (
          <span className="text-xs text-gray-600">Session: {sessionId.slice(0,8)}</span>
        )}
      </div>
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      <div className="text-sm text-gray-800 whitespace-pre-wrap min-h-[2rem]">
        {recording
          ? 'Listening…'
      : processingFinal
        ? 'Processing final transcript…'
        : callId
          ? 'Transcript ready — see Live Transcript panel or Transcripts tab.'
          : (sessionId ? 'No transcript available' : 'Press Record to start')}
      </div>
    </div>
  )
}
