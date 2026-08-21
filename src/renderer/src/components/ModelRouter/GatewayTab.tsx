import { useCallback, useEffect, useState } from 'react'
import type { GatewayStatus, RoutingStrategy } from '@shared/types'

const STRATEGIES: Array<{ id: RoutingStrategy; label: string }> = [
  { id: 'auto', label: 'Auto (quota → least used → plan)' },
  { id: 'random', label: 'Random' },
  { id: 'single', label: 'Single account (manual switch)' },
  { id: 'quota-high-first', label: 'Quota high first' },
  { id: 'quota-low-first', label: 'Quota low first' },
  { id: 'expiry-soon-first', label: 'Expiry soon first' }
]

export default function GatewayTab() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [draft, setDraft] = useState<GatewayStatus | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    const s = await window.api.getGatewayConfig()
    setStatus(s)
    setDraft(s)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => window.api.onGatewayChanged(s => { setStatus(s); setDraft(d => d ? { ...s, ...d } : s) }), [])

  const save = async (patch: Partial<GatewayStatus>) => {
    if (!draft) return
    setError('')
    try {
      const next = { ...draft, ...patch }
      const result = await window.api.saveGatewayConfig({
        enabled: next.enabled,
        port: Number(next.port) || 1480,
        apiKey: next.apiKey,
        routingStrategy: next.routingStrategy,
        coldownSeconds: Number(next.coldownSeconds) || 300,
        quotaReservePercent: Number(next.quotaReservePercent) || 10
      })
      setStatus(result)
      setDraft(result)
    } catch (err) {
      setError(String(err))
    }
  }

  if (!status || !draft) return <div className="mr-tab">Loading…</div>

  const endpoint = `http://127.0.0.1:${draft.port}/v1`

  const copyEndpoint = async () => {
    await navigator.clipboard.writeText(endpoint)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mr-tab gateway-tab">
      <div className="gateway-toggle-row">
        <label className="gateway-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => void save({ enabled: e.target.checked })}
          />
          <span className={draft.enabled ? 'mr-dot on' : 'mr-dot'} />
          Gateway {draft.enabled ? (status.running ? 'ON' : 'starting…') : 'OFF'}
        </label>
        <span className="gateway-status-hint">
          {status.running ? `running on port ${status.actualPort}` : 'not running'}
        </span>
      </div>

      {draft.enabled && !draft.apiKey && (
        <p className="gateway-warn">[meow] Đặt API key để bảo vệ gateway (bắt buộc).</p>
      )}

      <div className="gateway-field">
        <label>Gateway API key</label>
        <input
          className="input"
          type="password"
          value={draft.apiKey}
          placeholder="Enter a key clients must send as Bearer"
          onChange={e => void save({ apiKey: e.target.value })}
        />
      </div>

      <div className="gateway-field">
        <label>Port</label>
        <input
          className="input"
          type="number"
          value={draft.port}
          onChange={e => void save({ port: Number(e.target.value) || 1480 })}
        />
      </div>

      <div className="gateway-field">
        <label>Endpoint (agents / external tools point here)</label>
        <div className="gateway-endpoint">
          <code>{endpoint}</code>
          <button className="btn small" onClick={() => void copyEndpoint()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="gateway-field">
        <label>Routing strategy</label>
        <select className="input" value={draft.routingStrategy} onChange={e => void save({ routingStrategy: e.target.value as RoutingStrategy })}>
          {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {draft.routingStrategy === 'single' && (
          <p className="gateway-hint">Single account: gateway luôn dùng account active trong Accounts tab. Đổi thủ công bằng nút Switch.</p>
        )}
      </div>

      <div className="gateway-field-row">
        <div className="gateway-field">
          <label>Coldown (s) — account bị 429/5xx bị block tạm</label>
          <input className="input" type="number" value={draft.coldownSeconds} onChange={e => void save({ coldownSeconds: Number(e.target.value) || 300 })} />
        </div>
        <div className="gateway-field">
          <label>Quota reserve (%) — account gần hết quota xếp sau</label>
          <input className="input" type="number" value={draft.quotaReservePercent} onChange={e => void save({ quotaReservePercent: Number(e.target.value) || 10 })} />
        </div>
      </div>

      {error && <div className="settings-status">{error}</div>}

      <div className="gateway-master-toggle">
        <label className="gateway-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => void save({ enabled: e.target.checked })}
          />
          <span className="gateway-switch" aria-hidden="true" />
          <span className="gateway-master-label">
            {draft.enabled ? 'Gateway: ON' : 'Gateway: OFF'}
          </span>
        </label>
        <span className="gateway-status-hint">
          {draft.enabled && draft.apiKey
            ? (status.running ? `running on port ${status.actualPort}` : 'starting…')
            : (draft.enabled ? 'cần đặt API key ở trên' : '')}
        </span>
      </div>
    </div>
  )
}
