import { useEffect, useState } from 'react'
import type { BrowserStatusInfo, PairingInfo } from '@shared/browser-types'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [pairing, setPairing] = useState<PairingInfo | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pair = async () => {
    setPairing(await window.api.pairBrowser())
  }

  const stateLabel = status?.paired
    ? `paired${status.port ? ` (port ${status.port})` : ''}`
    : status?.status === 'listening' || status?.status === 'idle'
      ? 'waiting for extension'
      : status?.status ?? 'unknown'

  return (
    <div className="dialog-backdrop">
      <div className="dialog browser-dialog">
        <div className="browser-hd">
          <h3>Browser Bridge</h3>
          <span className={`browser-pill ${status?.paired ? 'browser-pill-on' : 'browser-pill-off'}`}>
            ● {stateLabel}
          </span>
        </div>
        {status?.paired ? (
          <>
            <div className="browser-section">
              <p className="browser-section-label">Connection</p>
              <p className="browser-hint">Extension is paired and ready.</p>
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={pair}>New Pairing Code</button>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="browser-section">
              <p className="browser-section-label">Setup</p>
              <p className="browser-hint">
                Install the extension in Chrome, then pair it with a one-time code.
              </p>
              <div className="row">
                <button className="btn" onClick={() => void window.api.openBrowserInstallGuide()}>Open Install Guide</button>
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
              </div>
            </div>
            <div className="browser-section">
              <p className="browser-section-label">Pairing</p>
              {pairing ? (
                <div className="browser-pairing">
                  <span className="browser-code">{pairing.code}</span>
                  <span className="browser-hint">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span>
                </div>
              ) : (
                <div className="browser-pairing-cta">
                  <button className="btn primary" onClick={pair}>Pair With Code</button>
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
