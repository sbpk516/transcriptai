import React, { useEffect, useState } from 'react'

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
            return <div className="text-sm text-blue-600">Downloading...</div>
        }
        if (model.status === 'error') {
            return <div className="text-sm text-red-500">{model.message || 'Download failed'}</div>
        }
        if (model.status === 'downloaded') {
            return <div className="text-sm text-gray-500">Downloaded{model.version ? ` (${model.version})` : ''}</div>
        }
        if (model.status === 'needs_update') {
            return <div className="text-sm text-amber-600">Update available</div>
        }
        return null
    }

    return (
        <div className="p-4 space-y-4">
            <h2 className="text-xl font-bold">Speech Recognition Models</h2>
            {error && <div className="text-red-500">{error}</div>}

            <div className="grid gap-4">
                {models.map(model => (
                    <div key={model.name} className="flex items-center justify-between p-4 border rounded bg-white shadow-sm">
                        <div>
                            <div className="font-medium text-lg capitalize">{model.name}</div>
                            <div className="text-sm text-gray-500">
                                Size: ~{model.size_mb} MB
                                {model.is_active && <span className="ml-2 text-green-600 font-bold">(Active)</span>}
                            </div>
                            {renderStatus(model)}
                        </div>

                        <div className="flex gap-2">
                            {model.status === 'downloading' ? (
                                <button
                                    disabled
                                    className="px-4 py-2 bg-blue-100 text-blue-800 rounded opacity-70 cursor-not-allowed"
                                >
                                    Downloading...
                                </button>
                            ) : !model.is_downloaded || model.status === 'needs_update' || model.status === 'error' ? (
                                <button
                                    onClick={() => handleDownload(model.name)}
                                    disabled={model.is_active && !(model.status === 'error' || model.status === 'needs_update')}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                    Download
                                </button>
                            ) : model.is_active ? (
                                <button
                                    disabled
                                    className="px-4 py-2 rounded bg-green-100 text-green-800 cursor-default"
                                >
                                    Selected
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleSelect(model.name)}
                                    disabled={loading}
                                    className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
                                >
                                    Select
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="text-sm text-gray-500 mt-4">
                Note: Larger models are more accurate but slower. 'Tiny' is recommended for speed.
            </div>
        </div>
    )
}
