import type {
  LiveCompleteEvent,
  LivePartialEvent,
  LiveStreamHandlers,
} from '@/types/live'

function resolveBackendOrigin(): string {
  if (typeof window === 'undefined') return ''
  const electronPort = (window as any)?.api?.backend?.port
  if (electronPort) return `http://127.0.0.1:${electronPort}`
  if (window.location?.protocol === 'file:') {
    // Packaged bundle without port hint — fall back to default API base.
    return 'http://127.0.0.1:8001'
  }
  // Vite dev: relative URL goes through the proxy.
  return ''
}

/**
 * Subscribes to /api/v1/live/events/{sessionId} via EventSource, parsing
 * `partial` and `complete` events and dispatching to the provided handlers.
 *
 * MVP: a single auto-reconnect attempt on transport error. The backend's ring
 * buffer replays buffered events on reconnect, so brief drops do not lose data.
 */
export class LiveStreamClient {
  private source: EventSource | null = null
  private handlers: LiveStreamHandlers = {}
  private sessionId: string | null = null
  private reconnectUsed = false
  private closed = false

  connect(sessionId: string, handlers: LiveStreamHandlers): void {
    this.disconnect()
    this.sessionId = sessionId
    this.handlers = handlers
    this.reconnectUsed = false
    this.closed = false
    this.openSource()
  }

  disconnect(): void {
    this.closed = true
    if (this.source) {
      try { this.source.close() } catch { /* noop */ }
      this.source = null
    }
  }

  private openSource(): void {
    if (!this.sessionId) return
    const origin = resolveBackendOrigin()
    const url = `${origin}/api/v1/live/events/${encodeURIComponent(this.sessionId)}`
    const source = new EventSource(url)
    this.source = source

    source.onopen = () => {
      this.handlers.onOpen?.()
    }

    source.addEventListener('partial', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as LivePartialEvent
        this.handlers.onPartial?.(data)
      } catch (err) {
        console.warn('[LiveStreamClient] failed to parse partial event', err)
      }
    })

    source.addEventListener('complete', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as LiveCompleteEvent
        this.handlers.onComplete?.(data)
      } catch (err) {
        console.warn('[LiveStreamClient] failed to parse complete event', err)
      } finally {
        this.disconnect()
      }
    })

    source.addEventListener('ping', () => {
      // No-op: heartbeat. Keeps proxies from idling the connection out.
    })

    source.onerror = (err) => {
      if (this.closed) return
      this.handlers.onError?.(err)
      // EventSource auto-reconnects on its own on transient errors. We close and
      // re-open once if the browser hasn't recovered, which gives the bus a chance
      // to replay buffered events. After that, give up and let the caller retry.
      if (!this.reconnectUsed && source.readyState === EventSource.CLOSED) {
        this.reconnectUsed = true
        if (this.source === source) this.source = null
        try { source.close() } catch { /* noop */ }
        setTimeout(() => {
          if (!this.closed) this.openSource()
        }, 500)
      }
    }
  }
}
