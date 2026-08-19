import { useCallback, useEffect, useState } from 'react'
import type { RemoteStatus } from '@shared/remote-types'

interface Pairing {
  code: string
  expiresAt: number
}

export default function RemoteTab() {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const applyStatus = useCallback((s: RemoteStatus) => {
    setStatus(s)
    if (s.relayUrl !== undefined) setRelayUrl(s.relayUrl ?? '')
    if (!s.enabled || s.pairingExpiresAt === undefined) {
      setPairing(null)
    } else if (s.pairingCode) {
      setPairing({ code: s.pairingCode, expiresAt: s.pairingExpiresAt })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api
      .getRemoteStatus()
      .then(s => {
        if (cancelled) return
        applyStatus(s)
      })
      .catch(err => {
        if (!cancelled) setError(String(err))
      })
    const unsub = window.api.onRemoteStatus(applyStatus)
    return () => {
      cancelled = true
      unsub()
    }
  }, [applyStatus])

  useEffect(() => {
    if (!pairing) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [pairing])

  const toggle = async () => {
    if (!status) return
    setBusy(true)
    setError('')
    try {
      await window.api.setRemoteEnabled(!status.enabled)
      applyStatus(await window.api.getRemoteStatus())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveRelayUrl = async () => {
    const url = relayUrl.trim()
    if (!url) return
    setBusy(true)
    setError('')
    try {
      await window.api.setRemoteRelayUrl(url)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const startPairing = async () => {
    setBusy(true)
    setError('')
    try {
      const p = await window.api.startRemotePairing()
      if (p) {
        setPairing(p)
        setNow(Date.now())
      } else {
        setError('Pairing failed — the relay connection is not active.')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    setError('')
    try {
      await window.api.revokeRemoteToken()
      setPairing(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="settings-tab remote-tab">Loading…</div>

  const secondsLeft = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0

  return (
    <div className="settings-tab remote-tab">
      <div className="chatgpt-web-row">
        <span>Allow remote control</span>
        <button className="btn" disabled={busy} onClick={() => void toggle()}>
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="settings-field">
        <label className="label">Relay URL</label>
        <input
          className="input"
          type="text"
          placeholder="wss://relay.example.com"
          value={relayUrl}
          onChange={e => setRelayUrl(e.target.value)}
          onBlur={() => void saveRelayUrl()}
        />
        <p className="settings-hint">WebSocket relay the mobile app uses to reach this device.</p>
      </div>

      {status.enabled && (
        <>
          <div className="chatgpt-web-row">
            <span>Pair a mobile device</span>
            <button className="btn primary" disabled={busy || !status.connected} onClick={() => void startPairing()}>
              Start pairing
            </button>
          </div>
          {!status.connected && (
            <p className="settings-hint">Pairing requires an active relay connection.</p>
          )}
          {pairing && (
            <div className="settings-row">
              <span>
                Pairing code: <code className="remote-code">{pairing.code}</code>
              </span>
              <span>
                {secondsLeft > 0 ? `Expires in ${secondsLeft}s` : 'Code expired — start a new pairing'}
              </span>
            </div>
          )}
          <div className="chatgpt-web-row">
            <span>Trusted devices</span>
            <button className="btn" disabled={busy || !status.paired} onClick={() => void revoke()}>
              Revoke trusted devices
            </button>
          </div>
        </>
      )}

      <div className="settings-row">
        <span>
          Relay: {status.connected ? 'connected' : 'disconnected'} · Device:{' '}
          {status.paired ? 'paired' : 'not paired'}
          {status.mobileOnline !== undefined && (
            <span> · Mobile: {status.mobileOnline ? 'online' : 'offline'}</span>
          )}
        </span>
        <span>Device ID: {status.deviceId || 'unknown'}</span>
      </div>

      {status.error && <div className="settings-error">{status.error}</div>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
