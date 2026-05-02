import React, { useCallback, useEffect, useState } from 'react'
import { Button, Card } from '../../components/Shared'
import type {
  BYOKBridge,
  BYOKTestResult,
  ProviderId,
  ProviderInfo,
} from '../../types/byok'

type RowState = {
  draft: string
  saving: boolean
  testing: boolean
  removing: boolean
  testResult: BYOKTestResult | null
  saveError: string | null
}

const EMPTY_ROW: RowState = {
  draft: '',
  saving: false,
  testing: false,
  removing: false,
  testResult: null,
  saveError: null,
}

function getBridge(): BYOKBridge | null {
  return (typeof window !== 'undefined' ? window.transcriptaiByok : null) || null
}

function describeError(code: string | undefined): string {
  switch (code) {
    case 'no_key':
      return 'No key saved'
    case 'invalid':
      return 'Key rejected by provider'
    case 'network_error':
      return 'Network error'
    case 'rate_limited':
      return 'Rate limited — wait and retry'
    case 'timeout':
      return 'Timed out (15 s)'
    case 'model_not_found':
      return 'Default model unavailable for this key'
    case 'out_of_credits':
      return 'Key valid, but account has no credits'
    case 'encryption_unavailable':
      return 'Keychain encryption is not available on this Mac'
    case 'empty_key':
      return 'Key is empty'
    case 'invalid_key':
      return 'Invalid key format'
    case 'completion_failed':
      return 'Provider call failed'
    case 'unknown_provider':
      return 'Unknown provider'
    case 'write_failed':
      return 'Failed to write key file'
    default:
      return code ? `Error: ${code}` : 'Error'
  }
}

function StatusPill({ provider, row }: { provider: ProviderInfo; row: RowState }) {
  if (row.testing) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-300">
        Testing…
      </span>
    )
  }
  if (row.testResult) {
    if (row.testResult.ok) {
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">
          ✓ saved · valid {typeof row.testResult.latencyMs === 'number' ? `(${row.testResult.latencyMs} ms)` : ''}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-rose-400/10 px-2 py-1 text-xs text-rose-300">
        ✗ {describeError(row.testResult.error)}
      </span>
    )
  }
  if (provider.hasKey) {
    return (
      <span className="inline-flex items-center rounded-full bg-cyan-400/10 px-2 py-1 text-xs text-cyan-300">
        saved
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-1 text-xs text-white/50">
      not set
    </span>
  )
}

export const SettingsByok: React.FC = () => {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean>(true)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean>(true)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) {
      setBridgeAvailable(false)
      return
    }
    try {
      const result = await bridge.listProviders()
      if (result.ok && result.providers) {
        setProviders(result.providers)
        setEncryptionAvailable(result.encryptionAvailable !== false)
        setGlobalError(null)
      } else {
        setGlobalError(describeError(result.error))
      }
    } catch (error) {
      console.error('[SettingsByok] listProviders failed', error)
      setGlobalError('Failed to load BYOK providers')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const updateRow = useCallback((id: ProviderId, patch: Partial<RowState>) => {
    setRowState(prev => ({
      ...prev,
      [id]: { ...(prev[id] || EMPTY_ROW), ...patch },
    }))
  }, [])

  const handleSave = useCallback(
    async (id: ProviderId) => {
      const bridge = getBridge()
      if (!bridge) return
      const draft = (rowState[id]?.draft || '').trim()
      if (!draft) {
        updateRow(id, { saveError: describeError('empty_key') })
        return
      }
      updateRow(id, { saving: true, saveError: null, testResult: null })
      try {
        const result = await bridge.setKey(id, draft)
        if (result.ok) {
          updateRow(id, { saving: false, draft: '', saveError: null })
          await refresh()
        } else {
          updateRow(id, { saving: false, saveError: describeError(result.error) })
        }
      } catch (error) {
        console.error('[SettingsByok] setKey failed', error)
        updateRow(id, { saving: false, saveError: 'Save failed' })
      }
    },
    [rowState, updateRow, refresh],
  )

  const handleTest = useCallback(
    async (id: ProviderId) => {
      const bridge = getBridge()
      if (!bridge) return
      updateRow(id, { testing: true, testResult: null })
      try {
        const result = await bridge.testKey(id)
        updateRow(id, { testing: false, testResult: result })
      } catch (error) {
        console.error('[SettingsByok] testKey failed', error)
        updateRow(id, { testing: false, testResult: { ok: false, error: 'completion_failed' } })
      }
    },
    [updateRow],
  )

  const handleRemove = useCallback(
    async (id: ProviderId) => {
      const bridge = getBridge()
      if (!bridge) return
      updateRow(id, { removing: true })
      try {
        const result = await bridge.deleteKey(id)
        if (result.ok) {
          updateRow(id, { removing: false, testResult: null, saveError: null, draft: '' })
          await refresh()
        } else {
          updateRow(id, { removing: false, saveError: describeError(result.error) })
        }
      } catch (error) {
        console.error('[SettingsByok] deleteKey failed', error)
        updateRow(id, { removing: false, saveError: 'Remove failed' })
      }
    },
    [updateRow, refresh],
  )

  if (!bridgeAvailable) {
    return null
  }

  return (
    <Card title="API Keys" subtitle="Bring your own LLM provider keys for Live Mode and other AI features." icon="🔑">
      <div className="space-y-5">
        {!encryptionAvailable && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            macOS Keychain encryption is unavailable on this device. Keys cannot be stored securely. Saving is disabled.
          </div>
        )}
        {globalError && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-200">
            {globalError}
          </div>
        )}

        <p className="text-xs text-white/60">
          Keys are stored encrypted via macOS Keychain and never leave this device. Each key is used only by its corresponding provider.
        </p>

        {providers.map(provider => {
          const row: RowState = rowState[provider.id] || EMPTY_ROW
          const disableMutations = !encryptionAvailable

          return (
            <div
              key={provider.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">{provider.label}</div>
                  <div className="text-xs text-white/40">Default model: {provider.defaultModel}</div>
                </div>
                <StatusPill provider={provider} row={row} />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="password"
                  className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
                  placeholder={provider.hasKey ? 'Replace existing key…' : 'Paste your API key'}
                  value={row.draft}
                  onChange={event => updateRow(provider.id, { draft: event.target.value, saveError: null })}
                  disabled={row.saving || disableMutations}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSave(provider.id)}
                    disabled={row.saving || disableMutations || row.draft.trim().length === 0}
                  >
                    {row.saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTest(provider.id)}
                    disabled={row.testing || !provider.hasKey || disableMutations}
                  >
                    {row.testing ? 'Testing…' : 'Test'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRemove(provider.id)}
                    disabled={row.removing || !provider.hasKey || disableMutations}
                  >
                    {row.removing ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
              </div>

              {row.saveError && (
                <p className="text-xs text-rose-300">{row.saveError}</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default SettingsByok
