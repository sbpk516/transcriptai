export type TextInsertionOutcome =
  | { ok: true; method: 'input' | 'contenteditable' | 'bridge' | 'clipboard' }
  | { ok: false; reason: 'no_target' | 'target_mismatch' | 'bridge_failed' | 'clipboard_failed' }

export type EditableTargetSnapshot =
  | {
      element: HTMLInputElement | HTMLTextAreaElement
      kind: 'input'
    }
  | {
      element: HTMLElement
      kind: 'contenteditable'
    }

export interface InsertDictationOptions {
  expectedTarget?: EditableTargetSnapshot | null
  allowBridge?: boolean
  allowClipboard?: boolean
}

type TextInsertionFailureReason = Extract<TextInsertionOutcome, { ok: false }>['reason']

function classifyActiveElement(active: HTMLElement | null): EditableTargetSnapshot | null {
  if (!active) {
    return null
  }

  const tagName = typeof (active as { tagName?: unknown }).tagName === 'string'
    ? ((active as { tagName: string }).tagName || '').toUpperCase()
    : ''

  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    const input = active as HTMLInputElement | HTMLTextAreaElement
    if (input.readOnly || input.disabled) {
      return null
    }
    return { element: input, kind: 'input' }
  }

  if (active.isContentEditable) {
    return { element: active, kind: 'contenteditable' }
  }

  return null
}

export function snapshotActiveEditable(): EditableTargetSnapshot | null {
  if (typeof document === 'undefined') {
    return null
  }
  const active = document.activeElement as HTMLElement | null
  return classifyActiveElement(active)
}

function insertIntoInput(element: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? element.value.length
  const value = element.value ?? ''
  const nextValue = value.slice(0, start) + text + value.slice(end)
  element.value = nextValue
  const caret = start + text.length
  element.selectionStart = caret
  element.selectionEnd = caret
  element.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

function insertIntoContentEditable(element: HTMLElement, text: string): boolean {
  element.focus({ preventScroll: true })
  return document.execCommand('insertText', false, text)
}

async function attemptClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export async function insertDictationText(
  text: string,
  options: InsertDictationOptions = {},
): Promise<TextInsertionOutcome> {
  if (!text) {
    return { ok: false, reason: 'no_target' }
  }

  const expectedTargetProvided = Object.prototype.hasOwnProperty.call(options, 'expectedTarget')
  const expectedTarget = options.expectedTarget
  const allowBridge = options.allowBridge !== false
  const allowClipboard = options.allowClipboard !== false

  const activeSnapshot = snapshotActiveEditable()
  let lastFailureReason: TextInsertionFailureReason = 'no_target'

  if (expectedTargetProvided) {
    if (!expectedTarget) {
      return { ok: false, reason: 'target_mismatch' }
    }
    if (!activeSnapshot || activeSnapshot.element !== expectedTarget.element) {
      return { ok: false, reason: 'target_mismatch' }
    }
  }

  if (activeSnapshot) {
    if (activeSnapshot.kind === 'input') {
      insertIntoInput(activeSnapshot.element, text)
      return { ok: true, method: 'input' }
    }
    if (activeSnapshot.kind === 'contenteditable') {
      if (insertIntoContentEditable(activeSnapshot.element, text)) {
        return { ok: true, method: 'contenteditable' }
      }
    }
  }

  if (allowBridge) {
    const bridge = (window as unknown as { transcriptaiDictation?: any })?.transcriptaiDictation
    if (bridge && typeof bridge.typeText === 'function') {
      try {
        const result = await bridge.typeText({ text })
        if (result?.ok) {
          return { ok: true, method: 'bridge' }
        }
        lastFailureReason = 'bridge_failed'
      } catch (error) {
        console.warn('[Dictation] bridge typeText failed', error)
        lastFailureReason = 'bridge_failed'
      }
    }
  }

  if (allowClipboard) {
    lastFailureReason = 'clipboard_failed'
    try {
      const success = await attemptClipboard(text)
      if (success) {
        return { ok: true, method: 'clipboard' }
      }
    } catch (error) {
      console.warn('[Dictation] clipboard fallback failed', error)
      return { ok: false, reason: 'clipboard_failed' }
    }
  }

  return { ok: false, reason: lastFailureReason }
}
