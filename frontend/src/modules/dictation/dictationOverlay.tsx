import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'

import { useDictationController } from './dictationController'
import { DictationPermissionPrompt } from './permissionPrompt'

interface DictationBridge {
  respondPermission?: (payload: { requestId: number; granted: boolean }) => Promise<unknown> | void
  cancelActivePress?: (payload: { reason: string }) => Promise<unknown> | void
}

function respondPermission(requestId: number | null, granted: boolean) {
  if (requestId === null) {
    return
  }
  const bridge = (window as typeof window & { transcriptaiDictation?: DictationBridge })?.transcriptaiDictation
  if (bridge && typeof bridge.respondPermission === 'function') {
    void bridge.respondPermission({ requestId, granted }).catch((error: unknown) => {
      console.warn('[DictationOverlay] respondPermission failed', error)
    })
  }
}

function cancelActivePress(reason: string) {
  const bridge = (window as typeof window & { transcriptaiDictation?: DictationBridge })?.transcriptaiDictation
  if (bridge && typeof bridge.cancelActivePress === 'function') {
    void bridge.cancelActivePress({ reason }).catch((error: unknown) => {
      console.warn('[DictationOverlay] cancelActivePress failed', error)
    })
  }
}

const statusMessages: Record<string, string> = {
  recording: 'Listening… Release the shortcut to finish dictation.',
  processing: 'Processing your speech…',
  error: 'Dictation encountered an issue.',
}

export const DictationOverlay: React.FC = () => {
  const state = useDictationController()
  const target = typeof document !== 'undefined' ? document.body : null

  if (!target) {
    return null
  }

  const audioBarDelays = useMemo(() => Array.from({ length: 12 }, (_, idx) => idx * 0.08), [])

  const content = useMemo(() => {
    if (state.status === 'permission' && state.permission) {
      return (
        <DictationPermissionPrompt
          permission={state.permission}
          onAllow={() => respondPermission(state.permission?.requestId ?? null, true)}
          onDeny={() => {
            respondPermission(state.permission?.requestId ?? null, false)
            cancelActivePress('user_denied_permission')
          }}
          allowDisabled={state.permission?.requestId == null}
        />
      )
    }

    if (state.status === 'error' && state.error) {
      return (
        <div className="glass-surface w-full max-w-sm rounded-3xl border border-rose-500/40 bg-rose-500/10 p-6 text-white shadow-glow-pink">
          <h2 className="text-lg font-semibold">Dictation error</h2>
          <p className="mt-2 text-sm text-white/70">{state.error}</p>
        </div>
      )
    }

    if (state.status === 'recording' || state.status === 'processing') {
      const isRecording = state.status === 'recording'
      const tone = isRecording
        ? 'from-pink-500 via-red-500 to-orange-500'
        : 'from-cyan-400 via-blue-500 to-purple-500'
      const barColor = isRecording ? 'bg-pink-300' : 'bg-cyan-300'
      return (
        <div className="glass-surface w-full max-w-sm rounded-3xl border border-white/15 bg-white/5 p-6 text-white shadow-glow">
          <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br ${tone} ${isRecording ? 'animate-pulse' : ''}`}>
            <span className="text-3xl">🎙️</span>
          </div>
          <p className="text-center text-sm text-white/80">{statusMessages[state.status]}</p>
          <div className="mt-6 flex items-end justify-between gap-1">
            {audioBarDelays.map(delay => (
              <span
                key={`bar-${delay}`}
                className={`h-12 w-1 rounded-full ${barColor} animate-audio-bars`}
                style={{ animationDelay: `${delay}s` }}
              />
            ))}
          </div>
        </div>
      )
    }

    return null
  }, [audioBarDelays, state])

  const notificationStyles: Record<string, string> = {
    info: 'border-cyan-300/30 bg-white/10 text-white',
    warning: 'border-amber-300/40 bg-amber-500/10 text-amber-100',
    error: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
  }

  const overlayNode = content ? (
    <div className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
      <div className="pointer-events-auto" role="status" aria-live="assertive">
        {content}
      </div>
    </div>
  ) : null

  const notificationsNode = state.notifications.length > 0 ? (
    <div className="fixed bottom-4 right-4 z-[1100] flex w-full max-w-sm flex-col gap-3">
      {state.notifications.map(notification => {
        const style = notificationStyles[notification.severity] || notificationStyles.info
        return (
          <div
            key={notification.id}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-lg backdrop-blur-xl ${style}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 text-sm text-white/80">{notification.message}</p>
              </div>
              <button
                type="button"
                className="-m-1 rounded-md p-1 text-current opacity-70 transition hover:opacity-100"
                onClick={() => state.dismissNotification(notification.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  ) : null

  const safeModeNode = state.safeMode.engaged ? (
    <div className="fixed bottom-4 left-1/2 z-[1100] w-[min(90%,32rem)] -translate-x-1/2 rounded-3xl border border-amber-300/40 bg-amber-500/10 p-5 text-amber-100 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Dictation paused for safety</p>
          <p className="mt-1 text-sm text-amber-100">
            We detected repeated failures ({state.safeMode.fatalErrorCount}). Resolve the issue, then re-enable dictation.
            {state.safeMode.detail && (
              <span className="block text-amber-100/80">Recent error: {state.safeMode.detail}</span>
            )}
            {state.safeMode.lastErrorId && (
              <span className="block text-xs text-amber-200/80">Reference ID: {state.safeMode.lastErrorId}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-amber-400/60 bg-transparent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-400/10"
          onClick={() => { void state.exitSafeMode() }}
        >
          Re-enable dictation
        </button>
      </div>
    </div>
  ) : null

  if (!overlayNode && !notificationsNode && !safeModeNode) {
    return null
  }

  return createPortal(
    <>
      {overlayNode}
      {notificationsNode}
      {safeModeNode}
    </>,
    target,
  )
}

export default DictationOverlay
