import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card } from '../components/Shared'
import { DEFAULT_SHORTCUT, validateShortcut } from './SettingsValidation'
import { ModelSettings } from '../modules/settings/ModelSettings'

type DictationSettings = {
  enabled: boolean
  shortcut: string
}

type MacPermissions = {
  platform: string
  supported: boolean
  accessibility?: string
  microphone?: string
  error?: string
}

// default shortcut is declared in SettingsValidation to keep tests/runtime aligned

import type { ShortcutValidation } from './SettingsValidation'

function normalizeSettings(candidate: unknown): DictationSettings {
  const source = (candidate && typeof candidate === 'object' ? candidate : {}) as Partial<DictationSettings>
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : false,
    shortcut: typeof source.shortcut === 'string' && source.shortcut.trim() ? source.shortcut.trim() : DEFAULT_SHORTCUT,
  }
}

const Settings: React.FC = () => {
  const dictationBridge = useMemo(() => (
    (window as unknown as { transcriptaiDictation?: any })?.transcriptaiDictation || null
  ), [])

  const [dictationSettings, setDictationSettings] = useState<DictationSettings | null>(null)
  const [draftShortcut, setDraftShortcut] = useState('')
  const [isShortcutDirty, setIsShortcutDirty] = useState(false)
  const [validation, setValidation] = useState<ShortcutValidation>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [macPermissions, setMacPermissions] = useState<MacPermissions | null>(null)
  const [permissionsLoading, setPermissionsLoading] = useState(false)

  const handleSettingsUpdate = useCallback((incoming: unknown) => {
    const normalized = normalizeSettings(incoming)
    setDictationSettings(normalized)
    if (!isShortcutDirty) {
      setDraftShortcut(normalized.shortcut)
      setValidation(null)
    }
  }, [isShortcutDirty])

  useEffect(() => {
    if (!dictationBridge) {
      setLoading(false)
      setError('Dictation settings are only available in the desktop app.')
      return undefined
    }

    let unsubscribe: (() => void) | undefined
    setLoading(true)
    setError(null)

    dictationBridge.getSettings?.()
      .then((settings: unknown) => {
        handleSettingsUpdate(settings)
        setLoading(false)
      })
      .catch((fetchError: unknown) => {
        console.error('[Settings] Failed to load dictation settings', fetchError)
        setError('Unable to load dictation settings. Try reloading the app.')
        setLoading(false)
      })

    if (typeof dictationBridge.onSettingsUpdated === 'function') {
      unsubscribe = dictationBridge.onSettingsUpdated((settings: unknown) => {
        handleSettingsUpdate(settings)
      })
    }

    return () => {
      try {
        unsubscribe?.()
      } catch (unsubscribeError) {
        console.error('[Settings] Failed to unsubscribe dictation settings listener', unsubscribeError)
      }
    }
  }, [dictationBridge, handleSettingsUpdate])

  const fetchMacPermissions = useCallback(async () => {
    if (!dictationBridge?.getMacPermissions) {
      return
    }
    try {
      const result = await dictationBridge.getMacPermissions()
      setMacPermissions(result)
    } catch (fetchError) {
      console.error('[Settings] Failed to fetch Mac permissions', fetchError)
    }
  }, [dictationBridge])

  useEffect(() => {
    fetchMacPermissions()
  }, [fetchMacPermissions])

  const requestMacPermissions = useCallback(async () => {
    if (!dictationBridge?.requestMacPermissions) {
      return
    }
    setPermissionsLoading(true)
    try {
      await dictationBridge.requestMacPermissions()
      await fetchMacPermissions()
    } catch (requestError) {
      console.error('[Settings] Failed to request Mac permissions', requestError)
    } finally {
      setPermissionsLoading(false)
    }
  }, [dictationBridge, fetchMacPermissions])

  const applyShortcut = useCallback(async () => {
    if (!dictationBridge || !dictationSettings) {
      return
    }

    const result = validateShortcut(draftShortcut)
    setValidation(result.validation)
    if (!result.isValid) {
      return
    }

    if (result.normalized === dictationSettings.shortcut) {
      setIsShortcutDirty(false)
      return
    }

    try {
      setSaving(true)
      setError(null)
      await dictationBridge.updateSettings?.({ shortcut: result.normalized })
      setIsShortcutDirty(false)
      setValidation(result.validation)
    } catch (updateError: unknown) {
      console.error('[Settings] Failed to update dictation shortcut', updateError)
      setError('Could not update shortcut. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [dictationBridge, dictationSettings, draftShortcut])

  const toggleDictation = useCallback(async () => {
    if (!dictationBridge || !dictationSettings) {
      return
    }
    const nextEnabled = !dictationSettings.enabled
    try {
      setSaving(true)
      setError(null)
      setDictationSettings(prev => (prev ? { ...prev, enabled: nextEnabled } : prev))
      await dictationBridge.updateSettings?.({ enabled: nextEnabled })
    } catch (toggleError: unknown) {
      console.error('[Settings] Failed to toggle dictation', toggleError)
      setDictationSettings(prev => (prev ? { ...prev, enabled: !nextEnabled } : prev))
      setError('Unable to update dictation toggle. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [dictationBridge, dictationSettings])

const shortcutValidationMessage = useMemo(() => {
  if (!validation) {
    return null
  }
  const baseCls = validation.level === 'error'
    ? 'text-rose-300'
    : validation.level === 'warning'
      ? 'text-amber-200'
      : 'text-white/70'
  return (
    <p className={`mt-2 text-sm ${baseCls}`}>{validation.message}</p>
  )
}, [validation])

return (
  <div className="space-y-8">
    <Card title="Settings" subtitle="Configure desktop preferences and AI profiles." icon="⚙️" />

    <Card title="Press-and-Hold Dictation" subtitle="Toggle the desktop dictation bridge and shortcut." icon="🎛️">
        {loading && (
        <div className="text-sm text-white/70">Loading dictation settings…</div>
        )}

        {!loading && error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        )}

        {!loading && !error && dictationSettings && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-base font-semibold text-white">Enable press-and-hold dictation</p>
                <p className="text-sm text-white/70">Hold the shortcut, speak, release to insert transcription instantly.</p>
              </div>
              <button
                type="button"
                className={`relative inline-flex h-8 w-16 flex-shrink-0 cursor-pointer rounded-full border transition-all duration-300 ${
                  dictationSettings.enabled ? 'border-emerald-300 bg-emerald-400/30 shadow-glow-green' : 'border-white/20 bg-white/5'
                } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                role="switch"
                aria-checked={dictationSettings.enabled}
                onClick={toggleDictation}
                disabled={saving}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition duration-200 ${
                    dictationSettings.enabled ? 'translate-x-8' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="rounded-2xl border border-cyan-300/30 bg-cyan-500/5 p-4 text-sm text-white/80">
              <p className="font-semibold text-white">First time using dictation?</p>
              <p className="mt-1 text-white/70">
                macOS asks for microphone and accessibility permission. Grant both so TranscriptAI can listen globally. Once accepted, holding the shortcut starts dictation instantly.
              </p>
            </div>

            {macPermissions?.platform === 'darwin' && macPermissions?.supported && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-white">macOS Permissions</p>
                  <button
                    type="button"
                    onClick={fetchMacPermissions}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    title="Refresh permission status"
                  >
                    ↻ Refresh
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">Accessibility</span>
                    <span className={`text-sm font-medium ${
                      macPermissions.accessibility === 'authorized'
                        ? 'text-emerald-400'
                        : macPermissions.accessibility === 'denied'
                          ? 'text-rose-400'
                          : 'text-amber-400'
                    }`}>
                      {macPermissions.accessibility === 'authorized' ? '✓ Granted' :
                       macPermissions.accessibility === 'denied' ? '✗ Denied' :
                       macPermissions.accessibility === 'not determined' ? '○ Not Set' :
                       macPermissions.accessibility || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">Microphone</span>
                    <span className={`text-sm font-medium ${
                      macPermissions.microphone === 'authorized'
                        ? 'text-emerald-400'
                        : macPermissions.microphone === 'denied'
                          ? 'text-rose-400'
                          : 'text-amber-400'
                    }`}>
                      {macPermissions.microphone === 'authorized' ? '✓ Granted' :
                       macPermissions.microphone === 'denied' ? '✗ Denied' :
                       macPermissions.microphone === 'not determined' ? '○ Not Set' :
                       macPermissions.microphone || 'Unknown'}
                    </span>
                  </div>
                </div>
                {(macPermissions.accessibility !== 'authorized' || macPermissions.microphone !== 'authorized') && (
                  <div className="mt-4">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={requestMacPermissions}
                      disabled={permissionsLoading}
                    >
                      {permissionsLoading ? 'Requesting...' : 'Request Permissions'}
                    </Button>
                    <p className="mt-2 text-xs text-white/50">
                      If permissions are denied, open System Settings → Privacy &amp; Security to grant access manually.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label htmlFor="dictation-shortcut" className="block text-sm font-medium text-white/80">
                Dictation shortcut
              </label>
              <div className="mt-1 flex gap-3">
                <input
                  id="dictation-shortcut"
                  type="text"
                  className="block w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  value={draftShortcut}
                  onChange={event => {
                    setDraftShortcut(event.target.value)
                    setIsShortcutDirty(true)
                  }}
                  onBlur={() => {
                    if (isShortcutDirty) {
                      const result = validateShortcut(draftShortcut)
                      setValidation(result.validation)
                    }
                  }}
                  placeholder={DEFAULT_SHORTCUT}
                  disabled={saving}
                />
                <Button variant="primary" size="sm" onClick={applyShortcut} disabled={saving || !isShortcutDirty}>
                  Save Shortcut
                </Button>
              </div>
              {shortcutValidationMessage}
              {!validation && (
                <p className="mt-2 text-xs text-white/60">
                  Avoid system-reserved shortcuts (Cmd+Q, Alt+F4). Use a modifier + key, or combine two modifiers (for example, Command+Option).
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
              <p className="font-semibold text-white">Troubleshooting</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-white/70">
                <li>Make sure the shortcut stays unique. If dictation doesn&apos;t start, try a different combination.</li>
                <li>On macOS, confirm TranscriptAI is allowed in System Settings → Privacy &amp; Security → Accessibility and Microphone.</li>
                <li>Reopen this window after changing permissions to refresh status.</li>
              </ul>
            </div>
          </div>
        )}
      </Card>

    <Card title="AI Models" subtitle="Select the engines that power capture." icon="🧠">
        <div className="space-y-4">
        <p className="text-sm text-white/70">
            Manage the speech recognition models used for dictation. Larger models are more accurate but require more resources.
          </p>
          <ModelSettings />
        </div>
      </Card>
    </div>
  )
}

export default Settings
