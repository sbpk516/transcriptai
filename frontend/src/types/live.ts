export type LiveStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'saving' | 'saved' | 'error'

export interface LivePartialEvent {
  type: 'partial'
  call_id: string
  chunk_index: number
  text: string
}

export interface LiveCompleteEvent {
  type: 'complete'
  call_id: string
  final_text_length: number
}

export interface LivePingEvent {
  type: 'ping'
  ts: string
}

export type LiveServerEvent = LivePartialEvent | LiveCompleteEvent | LivePingEvent

export interface LiveStreamHandlers {
  onPartial?: (evt: LivePartialEvent) => void
  onComplete?: (evt: LiveCompleteEvent) => void
  onError?: (err: unknown) => void
  onOpen?: () => void
}

export interface LiveRecorderState {
  status: LiveStatus
  sessionId: string | null
  callId: string | null
  error: string | null
  durationMs: number
}

export interface LiveRecorderApi extends LiveRecorderState {
  start: () => Promise<void>
  stop: () => Promise<{ callId: string | null; finalText: string } | null>
  reset: () => void
}
