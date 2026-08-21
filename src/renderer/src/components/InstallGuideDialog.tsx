import { useEffect, useState } from 'react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'

interface Props {
  guide: BrowserInstallGuideEvent | null
  onClose: () => void
}

export default function InstallGuideDialog({ guide, onClose }: Props) {
  const [extensionDir, setExtensionDir] = useState<string | null>(guide?.extensionDir ?? null)

  useEffect(() => {
    if (guide) setExtensionDir(guide.extensionDir)
  }, [guide])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop">
      <div className="dialog browser-dialog">
        <h3>Install Meow Browser Bridge</h3>
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        <ol className="browser-guide">
          <li>Click <strong>Open chrome://extensions</strong> — Chrome opens the extensions page.</li>
          <li>Enable <strong>Developer mode</strong> (top-right corner).</li>
          <li>Click <strong>Load unpacked</strong> and select the folder:
            <code className="browser-guide-dir">{extensionDir}</code>
          </li>
          <li>Back in Meow, open the Browser dialog and click <strong>Pair With Code</strong>, then enter the code in the extension popup.</li>
        </ol>
        <p className="browser-hint">
          The extension only connects to Meow on this machine (127.0.0.1) and requires a pairing code.
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => void window.api.openBrowserChromeExtensions()}>Open chrome://extensions</button>
          <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
        </div>
      </div>
    </div>
  )
}
