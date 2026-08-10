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
    ? 'Paired'
    : status?.status === 'listening' || status?.status === 'idle'
      ? 'Waiting for extension'
      : status?.status ?? 'Unknown'

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Browser Bridge</h3>
        <p className="browser-status">Status: <strong>{stateLabel}</strong> {status?.port ? `(port ${status.port})` : ''}</p>
        {status?.paired ? (
          <div className="browser-row">
            <p className="browser-hint">Extension is paired and ready.</p>
            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>close</button>
              <button className="btn" onClick={pair}>new pairing code</button>
            </div>
          </div>
        ) : (
          <div className="browser-row">
            <p className="browser-hint">
              Install the Meow Browser Bridge extension in Chrome and enter the pairing code in the
              extension popup.
            </p>
            <div className="dialog-actions">
              <button className="btn" onClick={() => void window.api.openBrowserInstallGuide()}>open install guide</button>
              <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>extension folder</button>
            </div>
            {pairing ? (
              <div className="browser-pairing">
                <span className="browser-code">{pairing.code}</span>
                <span className="browser-hint">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span>
              </div>
            ) : (
              <button className="btn primary" onClick={pair}>pair with code</button>
            )}
            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
