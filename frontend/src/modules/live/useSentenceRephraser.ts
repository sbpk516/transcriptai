import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmCompleteResult, ProviderId } from '../../types/byok'
import type { SentenceState } from '../../types/rephrase'
import { buildRephraseMessages } from './rephrasePrompt'
import { splitSentences } from './sentenceSplitter'

const MAX_CONCURRENT = 3
const FLUSH_TIMEOUT_MS = 5_000

interface UseSentenceRephraserOptions {
  transcriptText: string
  provider: ProviderId | null
  enabled: boolean
}

interface UseSentenceRephraserApi {
  sentences: SentenceState[]
  flush: () => Promise<string>
  reset: () => void
}

async function callLlm(provider: ProviderId, raw: string): Promise<LlmCompleteResult> {
  const bridge = (typeof window !== 'undefined' ? window.transcriptaiLlm : null) || null
  if (!bridge) {
    return { ok: false, error: 'bridge_unavailable' }
  }
  return bridge.complete({
    provider,
    messages: buildRephraseMessages(raw),
    maxTokens: 256,
    temperature: 0.4,
  })
}

export function useSentenceRephraser({
  transcriptText,
  provider,
  enabled,
}: UseSentenceRephraserOptions): UseSentenceRephraserApi {
  const [sentences, setSentences] = useState<SentenceState[]>([])

  // Refs that we want to read inside async work without re-running effects.
  const sentencesRef = useRef<SentenceState[]>([])
  const inFlightRef = useRef(0)
  const queueRef = useRef<number[]>([])
  const seenCountRef = useRef(0)
  const providerRef = useRef<ProviderId | null>(provider)
  const enabledRef = useRef(enabled)

  useEffect(() => { providerRef.current = provider }, [provider])
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const updateSentence = useCallback((index: number, patch: Partial<SentenceState>) => {
    const existing = sentencesRef.current[index]
    if (!existing) return
    const updated: SentenceState = { ...existing, ...patch }
    const next = [...sentencesRef.current]
    next[index] = updated
    sentencesRef.current = next
    setSentences(next)
  }, [])

  const tryDispatch = useCallback(() => {
    while (inFlightRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const index = queueRef.current.shift()!
      const sentence = sentencesRef.current[index]
      if (!sentence) continue

      const provider = providerRef.current
      const isEnabled = enabledRef.current

      if (!isEnabled || !provider) {
        updateSentence(index, { polished: sentence.raw, status: 'skipped' })
        continue
      }

      inFlightRef.current += 1
      updateSentence(index, { status: 'polishing' })

      void (async () => {
        const result = await callLlm(provider, sentence.raw)
        if (result.ok) {
          const polished = (result.text || '').trim() || sentence.raw
          updateSentence(index, { polished, status: 'done' })
        } else {
          updateSentence(index, {
            polished: sentence.raw,
            status: 'error',
            errorCode: result.error,
          })
        }
        inFlightRef.current -= 1
        tryDispatch()
      })()
    }
  }, [updateSentence])

  // Whenever the transcript text changes, look for newly-completed sentences and queue them.
  useEffect(() => {
    const { sentences: split } = splitSentences(transcriptText)
    const startFrom = seenCountRef.current
    if (split.length <= startFrom) return

    const additions = split.slice(startFrom).map<SentenceState>((raw, offset) => ({
      index: startFrom + offset,
      raw,
      polished: null,
      status: 'pending',
    }))
    seenCountRef.current = split.length

    // Update both the ref and React state synchronously so tryDispatch can see them.
    const nextSentences = [...sentencesRef.current, ...additions]
    sentencesRef.current = nextSentences
    setSentences(nextSentences)
    additions.forEach(s => queueRef.current.push(s.index))
    tryDispatch()
  }, [transcriptText, tryDispatch])

  const flush = useCallback(async (): Promise<string> => {
    // Run any tail text past the last sentence boundary through one final rephrase.
    const { sentences: split, remainder } = splitSentences(transcriptText)
    const startFrom = seenCountRef.current
    const additions: SentenceState[] = []
    if (split.length > startFrom) {
      additions.push(
        ...split.slice(startFrom).map<SentenceState>((raw, offset) => ({
          index: startFrom + offset,
          raw,
          polished: null,
          status: 'pending',
        })),
      )
      seenCountRef.current = split.length
    }
    if (remainder.trim().length > 0) {
      additions.push({
        index: seenCountRef.current,
        raw: remainder.trim(),
        polished: null,
        status: 'pending',
      })
      seenCountRef.current += 1
    }
    if (additions.length > 0) {
      const nextSentences = [...sentencesRef.current, ...additions]
      sentencesRef.current = nextSentences
      setSentences(nextSentences)
      additions.forEach(s => queueRef.current.push(s.index))
      tryDispatch()
    }

    // Wait for all in-flight + queued work to settle, capped at FLUSH_TIMEOUT_MS.
    const deadline = Date.now() + FLUSH_TIMEOUT_MS
    while (inFlightRef.current > 0 || queueRef.current.length > 0) {
      if (Date.now() > deadline) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Compose the final polished transcript: prefer polished, fall back to raw.
    const final = sentencesRef.current
      .map(s => (s.polished ?? s.raw).trim())
      .filter(Boolean)
      .join(' ')
    return final
  }, [transcriptText, tryDispatch])

  const reset = useCallback(() => {
    setSentences([])
    sentencesRef.current = []
    inFlightRef.current = 0
    queueRef.current = []
    seenCountRef.current = 0
  }, [])

  return { sentences, flush, reset }
}
