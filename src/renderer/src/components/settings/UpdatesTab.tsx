import { useEffect, useState } from 'react'
import type { UpdaterStatusEvent } from '@shared/types'

export default function UpdatesTab() {
  const [status, setStatus] = useState<UpdaterStatusEvent | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = window.api.onUpdaterStatus(setStatus)
    return off
  }, [])

  const check = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.checkForUpdates()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-tab updates-tab">
      <p className="settings-hint">
        Meow checks for updates from GitHub Releases on startup.
      </p>
      <div className="settings-actions">
        <button className="btn" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check for Updates'}
        </button>
      </div>
      {status?.type === 'checking' && (
        <div className="settings-status">Checking for updates…</div>
      )}
      {status?.type === 'up-to-date' && (
        <div className="settings-status settings-status-ok">
          You're on the latest version (v{status.currentVersion}).
        </div>
      )}
      {status?.type === 'update-available' && (
        <div className="settings-actions">
          <span className="settings-status settings-status-info">
            v{status.version} is available
          </span>
          <button className="btn" onClick={() => void window.api.installUpdate()}>
            Update &amp; Restart
          </button>
        </div>
      )}
      {status?.type === 'download-progress' && (
        <>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <div className="update-progress-label">{status.percent}%</div>
        </>
      )}
      {status?.type === 'downloaded' && (
        <div className="settings-actions">
          <span className="settings-status settings-status-info">
            Download complete — restart to install.
          </span>
          <button className="btn" onClick={() => void window.api.installUpdate()}>
            Restart now
          </button>
        </div>
      )}
      {status?.type === 'error' && <div className="settings-error">{status.message}</div>}
      {status?.type === 'not-supported' && (
        <div className="settings-error">{status.message}</div>
      )}
    </div>
  )
}
