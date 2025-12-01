export interface UpdateManifest {
  latestVersion: string
  downloadUrl: string
  releaseNotes?: string[]
}

export interface UpdateBridge {
  onAvailable?: (cb: (manifest: UpdateManifest) => void) => (() => void) | void
  getLatestManifest?: () => UpdateManifest | null
  openDownload?: () => Promise<unknown> | unknown
}

