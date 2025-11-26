import axios from 'axios'
import type { AxiosError } from 'axios'

import { apiClient } from '@/services/api'
import {
  buildSnippetPayload,
  MAX_SNIPPET_BYTES,
  type DictationSnippetBuildParams,
  type DictationSnippetPayload,
} from './snippetPayload'

export { buildSnippetPayload, MAX_SNIPPET_BYTES }
export type { DictationSnippetBuildParams, DictationSnippetPayload }

export interface DictationSnippetUploadParams {
  base64Audio: string
  mimeType: string
  durationMs: number
  sizeBytes: number
  requestId: string
  attempt: number
  abortSignal?: AbortSignal
  timeoutTriggered?: boolean
  userCancelled?: boolean
}

export interface DictationSnippetUploadResult {
  ok: boolean
  transcript?: string
  confidence?: number
  status?: number
  error?: string
  retryable?: boolean
}

export type DictationSnippetUploader = (
  params: DictationSnippetUploadParams,
) => Promise<DictationSnippetUploadResult>

export interface DictationSnippetUploadOptions {
  maxAttempts?: number
  timeoutMs?: number
  onAttempt?: (attempt: number) => void
  externalAbortSignal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 120_000  // Increased to 120s to accommodate MLX model download/loading
const DEFAULT_MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 500

/**
 * Submit a dictation snippet to the backend transcription endpoint.
 */
export const submitDictationSnippet: DictationSnippetUploader = async ({
  base64Audio,
  mimeType,
  durationMs,
  sizeBytes,
  requestId,
  attempt,
  abortSignal,
  timeoutTriggered,
  userCancelled,
}: DictationSnippetUploadParams) => {
  try {
    const response = await apiClient.post(
      '/api/v1/dictation/transcribe',
      {
        audio_base64: base64Audio,
        media_type: mimeType,
        duration_ms: durationMs,
        size_bytes: sizeBytes,
        request_id: requestId,
        attempt,
      },
      {
        signal: abortSignal,
      },
    )

    const { text, confidence, duration_ms: processedDuration } = response.data || {}

    return {
      ok: true,
      transcript: typeof text === 'string' ? text : '',
      confidence: typeof confidence === 'number' ? confidence : 0,
      status: response.status,
      retryable: false,
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return handleAxiosError(error, timeoutTriggered, userCancelled)
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unknown error',
      retryable: true,
    }
  }
}

function handleAxiosError(
  error: AxiosError,
  timeoutTriggered?: boolean,
  userCancelled?: boolean,
): DictationSnippetUploadResult {
  if (userCancelled) {
    return {
      ok: false,
      error: 'request cancelled',
      retryable: false,
    }
  }

  if (timeoutTriggered) {
    return {
      ok: false,
      error: 'request timed out',
      retryable: true,
    }
  }

  if (error.code === 'ERR_CANCELED') {
    return {
      ok: false,
      error: 'request cancelled',
      retryable: false,
    }
  }

  const status = error.response?.status
  const detail = (error.response?.data as { detail?: string })?.detail
  const message = detail || error.message || 'dictation upload failed'

  return {
    ok: false,
    status,
    error: message,
    retryable: status === undefined || status >= 500,
  }
}

export async function submitDictationSnippetWithRetry(
  params: DictationSnippetUploadParams,
  options: DictationSnippetUploadOptions = {},
): Promise<DictationSnippetUploadResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let attempt = 1
  let lastResult: DictationSnippetUploadResult = {
    ok: false,
    error: 'upload not attempted',
    retryable: true,
  }

  while (attempt <= maxAttempts) {
    options.onAttempt?.(attempt)
    const controller = new AbortController()
    let timedOut = false
    let userCancelled = false

    const externalSignal = options.externalAbortSignal
    const handleExternalAbort = () => {
      userCancelled = true
      controller.abort()
    }
    if (externalSignal) {
      if (externalSignal.aborted) {
        handleExternalAbort()
      } else {
        externalSignal.addEventListener('abort', handleExternalAbort)
      }
    }
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const result = await submitDictationSnippet({
      ...params,
      attempt,
      abortSignal: controller.signal,
      timeoutTriggered: timedOut,
      userCancelled,
    })

    window.clearTimeout(timeoutId)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', handleExternalAbort)
    }

    if (result.ok) {
      return result
    }

    const wasTimeout = timedOut
    const shouldRetry = (result.retryable ?? false) || wasTimeout

    lastResult = {
      ...result,
      retryable: shouldRetry,
    }

    if (!shouldRetry || attempt >= maxAttempts) {
      return lastResult
    }

    const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1)
    await delay(backoff)
    attempt += 1
  }

  return lastResult
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}
