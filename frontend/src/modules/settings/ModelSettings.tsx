import React, { useEffect, useState } from 'react'
import { Button } from '../../components/Shared'

interface ModelInfo {
    name: string
    is_downloaded: boolean
    is_active: boolean
    size_mb: number
    status: 'idle' | 'downloading' | 'downloaded' | 'error' | 'needs_update'
    progress?: number | null
    message?: string | null
    version?: string | null
    updated_at?: string | null
    backend?: string | null
    management_supported?: boolean | null
    runtime_model?: string | null
}

export const ModelSettings: React.FC = () => {
    const [models, setModels] = useState<ModelInfo[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const getBackendUrl = () => {
        const port = (window as any).api?.backend?.port || 8001
        return `http://localhost:${port}/api/v1`
    }

    const fetchModels = async () => {
        try {
            const baseUrl = getBackendUrl()
            const res = await fetch(`${baseUrl}/models`)
            if (!res.ok) throw new Error('Failed to fetch models')
            const data = await res.json()
            setModels(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        }
    }

    useEffect(() => {
        fetchModels()
    }, [])

    const hasActiveDownload = models.some(m => m.status === 'downloading')
    const unmanagedModel = models.find(m => m.management_supported === false)

    useEffect(() => {
        // Poll with backoff: faster when a download is active, slower otherwise
        const intervalMs = hasActiveDownload ? 2000 : 8000
        const id = setInterval(fetchModels, intervalMs)
        return () => clearInterval(id)
    }, [hasActiveDownload])

    const handleDownload = async (name: string) => {
        try {
            const baseUrl = getBackendUrl()
            const res = await fetch(`${baseUrl}/models/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            })
            if (!res.ok && res.status !== 409) {
                const msg = await res.text()
                throw new Error(msg || 'Download failed')
            }
            // Refresh to get latest status
            fetchModels()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start download')
        }
    }

    const handleSelect = async (name: string) => {
        setLoading(true)
        try {
            const baseUrl = getBackendUrl()
            const res = await fetch(`${baseUrl}/models/select`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            })
            if (!res.ok) {
                const msg = await res.text()
                throw new Error(msg || 'Selection failed')
            }
            await fetchModels()
        } catch (err) {
            setError('Failed to select model')
        } finally {
            setLoading(false)
        }
    }

    const renderStatus = (model: ModelInfo) => {
        if (model.status === 'downloading') {
            return <div className="text-sm text-white/70">Downloading…</div>
        }
        if (model.status === 'error') {
            return <div className="text-sm text-rose-300">{model.message || 'Download failed'}</div>
        }
        if (model.status === 'downloaded') {
            return <div className="text-sm text-white/50">Downloaded{model.version ? ` (${model.version})` : ''}</div>
        }
        if (model.status === 'needs_update') {
            return <div className="text-sm text-amber-200">Update available</div>
        }
        return null
    }

    return (
        <div className="space-y-5 text-white">
            <h2 className="gradient-heading text-2xl font-semibold">Speech recognition models</h2>
            {error && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div>}

            <div className="space-y-4">
                {unmanagedModel ? (
                    <div className="glass-surface flex flex-col gap-3 rounded-2xl border border-white/10 px-4 py-4 shadow-glow">
                        <div className="text-lg font-semibold text-white">Current model</div>
                        <div className="text-sm text-white/70">
                            {unmanagedModel.runtime_model || unmanagedModel.name}
                            {unmanagedModel.backend && (
                                <span className="ml-2 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white/70">
                                    {unmanagedModel.backend}
                                </span>
                            )}
                        </div>
                        {unmanagedModel.message && <div className="text-sm text-white/50">{unmanagedModel.message}</div>}
                    </div>
                ) : (
                    models.map(model => (
                        <div
                            key={model.name}
                            className="glass-surface flex flex-col gap-4 rounded-2xl border border-white/10 px-4 py-4 shadow-glow md:flex-row md:items-center md:justify-between"
                        >
                            <div>
                                <div className="text-lg font-semibold capitalize text-white">{model.name}</div>
                                <div className="text-sm text-white/60">
                                    Size: ~{model.size_mb} MB
                                    {model.is_active && (
                                        <span className="ml-2 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-200">
                                            Active
                                        </span>
                                    )}
                                </div>
                                {renderStatus(model)}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {model.status === 'downloading' ? (
                                    <span className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm uppercase tracking-wide text-white/70">
                                        Downloading…
                                    </span>
                                ) : !model.is_downloaded || model.status === 'needs_update' || model.status === 'error' ? (
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => handleDownload(model.name)}
                                        disabled={model.is_active && !(model.status === 'error' || model.status === 'needs_update')}
                                    >
                                        Download
                                    </Button>
                                ) : model.is_active ? (
                                    <span className="rounded-2xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-emerald-100">
                                        Selected
                                    </span>
                                ) : (
                                    <Button variant="secondary" size="sm" onClick={() => handleSelect(model.name)} disabled={loading}>
                                        Select
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {!unmanagedModel && (
                <p className="text-sm text-white/60">
                    Note: larger models are more accurate but slower. <strong>Tiny</strong> is recommended for speed.
                </p>
            )}
        </div>
    )
}
