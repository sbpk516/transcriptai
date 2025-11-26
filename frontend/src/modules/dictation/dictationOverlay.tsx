import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'

import { useDictationController } from './dictationController'
import { DictationPermissionPrompt } from './permissionPrompt'

function respondPermission(requestId: number | null, granted: boolean) {
  if (requestId === null) {
    return
  }
  const bridge = (window as unknown as { transcriptaiDictation?: any })?.transcriptaiDictation
  if (bridge && typeof bridge.respondPermission === 'function') {
    void bridge.respondPermission({ requestId, granted }).catch((error: unknown) => {
      console.warn('[DictationOverlay] respondPermission failed', error)
    })
  }
}

function cancelActivePress(reason: string) {
  const bridge = (window as unknown as { transcriptaiDictation?: any })?.transcriptaiDictation
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
        <div className="w-full max-w-sm rounded-lg bg-red-700/90 p-5 text-white shadow-lg">
          <h2 className="text-lg font-semibold">Dictation error</h2>
          <p className="mt-2 text-sm text-red-50">{state.error}</p>
        </div>
      )
    }

    return null
  }, [state])

  const notificationStyles: Record<string, string> = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-700',
  }

  const overlayNode = content ? (
    <div className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4">
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
            className={`pointer-events-auto rounded-lg border p-4 shadow-lg ${style}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 text-sm">{notification.message}</p>
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
    <div className="fixed bottom-4 left-1/2 z-[1100] w-[min(90%,32rem)] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-900">Dictation paused for safety</p>
          <p className="mt-1 text-sm text-amber-800">
            We detected repeated failures ({state.safeMode.fatalErrorCount}). Resolve the issue, then re-enable dictation.
            {state.safeMode.detail && (
              <span className="block">Recent error: {state.safeMode.detail}</span>
            )}
            {state.safeMode.lastErrorId && (
              <span className="block text-xs text-amber-700">Reference ID: {state.safeMode.lastErrorId}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:bg-amber-100"
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
