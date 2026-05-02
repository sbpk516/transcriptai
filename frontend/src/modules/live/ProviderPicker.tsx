import React, { useEffect, useState } from 'react'
import type { ProviderId, ProviderInfo } from '../../types/byok'

const STORAGE_KEY = 'transcriptai.live.provider'

interface ProviderPickerProps {
  value: ProviderId | null
  onChange: (id: ProviderId | null) => void
}

export const ProviderPicker: React.FC<ProviderPickerProps> = ({ value, onChange }) => {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const bridge = (typeof window !== 'undefined' ? window.transcriptaiByok : null) || null
    if (!bridge) {
      setLoading(false)
      return
    }
    void bridge.listProviders().then(result => {
      if (cancelled) return
      setLoading(false)
      if (result.ok && result.providers) {
        const withKeys = result.providers.filter(p => p.hasKey)
        setProviders(withKeys)

        // If caller has not picked, restore last choice from localStorage.
        if (value === null && withKeys.length > 0) {
          let stored: string | null = null
          try { stored = window.localStorage?.getItem(STORAGE_KEY) ?? null } catch { /* noop */ }
          const matched = stored && withKeys.find(p => p.id === stored)
          onChange(matched ? matched.id : withKeys[0].id)
        }
      } else {
        setError(result.error || 'Failed to load providers')
      }
    }).catch(err => {
      if (cancelled) return
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Failed to load providers')
    })
    return () => { cancelled = true }
  }, [onChange, value])

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as ProviderId | ''
    if (!next) {
      onChange(null)
      try { window.localStorage?.removeItem(STORAGE_KEY) } catch { /* noop */ }
      return
    }
    onChange(next)
    try { window.localStorage?.setItem(STORAGE_KEY, next) } catch { /* noop */ }
  }

  if (loading) {
    return (
      <div className="text-xs text-white/40">Loading providers…</div>
    )
  }

  if (providers.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
        Save an API key in Settings to enable live polishing. Recording still works without it.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="live-provider" className="text-xs uppercase tracking-[0.2em] text-white/50">
        Polish via
      </label>
      <select
        id="live-provider"
        value={value ?? ''}
        onChange={handleChange}
        className="rounded-2xl border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
      >
        {providers.map(p => (
          <option key={p.id} value={p.id} className="bg-slate-900">
            {p.label} · {p.defaultModel}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  )
}

export default ProviderPicker
