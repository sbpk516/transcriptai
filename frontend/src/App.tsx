import React, { useEffect } from 'react'
import { Layout } from './components/Layout'

function App() {
  const appRenderStartTime = performance.now()
  const appRenderStartTimestamp = new Date().toISOString()
  console.log('[WEB_APP] phase=app_component_render_start timestamp=' + appRenderStartTimestamp)
  
  useEffect(() => {
    const appMountElapsed = performance.now() - appRenderStartTime
    console.log('[WEB_APP] phase=app_component_mounted elapsed=' + appMountElapsed.toFixed(2) + 'ms')
  }, [])
  
  const layoutRenderStartTime = performance.now()
  const result = <Layout />
  const layoutRenderElapsed = performance.now() - layoutRenderStartTime
  const appRenderElapsed = performance.now() - appRenderStartTime
  console.log('[WEB_APP] phase=layout_render elapsed=' + layoutRenderElapsed.toFixed(2) + 'ms')
  console.log('[WEB_APP] phase=app_component_render_complete elapsed=' + appRenderElapsed.toFixed(2) + 'ms')
  
  return result
}

export default App
