import React, { useState, useCallback, useEffect } from 'react'
import { Header } from '../Header'
import { Sidebar } from '../Sidebar'
import { Dashboard, Capture, Transcripts, Analytics, Settings } from '../../pages'
import { DictationOverlay } from '../../modules/dictation/dictationOverlay'

const Layout: React.FC = () => {
  console.log('[LAYOUT] Component rendering...')
  
  const [activePage, setActivePage] = useState<'dashboard' | 'capture' | 'transcripts' | 'analytics' | 'settings'>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  const handleUploadComplete = useCallback(() => {
    console.log('[LAYOUT] Capture completed, switching to dashboard')
    setActivePage('dashboard')
  }, [])

  useEffect(() => {
    const bridge = (window as any).transcriptaiUpdates
    if (!bridge || typeof bridge.onAvailable !== 'function') {
      console.warn('[LAYOUT] Update bridge is not available')
      return
    }

    const unsubscribe = bridge.onAvailable((manifest: any) => {
      console.log('[LAYOUT] Update manifest received', manifest)
      setUpdateInfo(manifest)
    })

    const current = bridge.getLatestManifest?.()
    if (current) {
      console.log('[LAYOUT] Using cached update manifest', current)
      setUpdateInfo(current)
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  const handleDismissUpdate = useCallback((version: string) => {
    console.log('[LAYOUT] Update dismissed for version', version)
    setDismissedVersion(version)
  }, [])

  const handleDownloadUpdate = useCallback(() => {
    console.log('[LAYOUT] Download update clicked')
    const bridge = (window as any).transcriptaiUpdates

    try {
      const result = bridge?.openDownload?.()
      return Promise.resolve(result).catch((error: unknown) => {
        console.error('[LAYOUT] Failed to open update download', error)
        throw error
      })
    } catch (error) {
      console.error('[LAYOUT] Download handler threw synchronously', error)
      return Promise.reject(error)
    }
  }, [])

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard onNavigate={setActivePage} />
      case 'capture':
        return <Capture onNavigate={setActivePage} />
      case 'transcripts':
        return <Transcripts />
      case 'analytics':
        return <Analytics />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activePage={activePage}
        onPageChange={setActivePage}
        onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        updateInfo={updateInfo}
        dismissedVersion={dismissedVersion}
        onDismissUpdate={handleDismissUpdate}
        onDownloadUpdate={handleDownloadUpdate}
      />
      <DictationOverlay />
      <div className="flex">
        <Sidebar 
          isOpen={sidebarOpen} 
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          activePage={activePage}
          onPageChange={setActivePage}
        />
        <main className="flex-1 p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default Layout
