import { useCallback, useEffect, useState } from 'react'
import type { GatewayRequestLog } from '@shared/types'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export default function LogsTab() {
  const [logs, setLogs] = useState<GatewayRequestLog[]>([])
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setLogs(await window.api.listGatewayLogs(200))
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const clear = async () => {
    try {
      await window.api.clearGatewayLogs()
      setLogs([])
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="mr-tab logs-tab">
      <div className="quota-head">
        <span className="settings-hint">Request logs từ local gateway (chỉ metadata, không chứa token/body).</span>
        <div className="conn-provider-actions">
          <button className="btn small" onClick={() => void refresh()}>Refresh</button>
          <button className="btn small danger" onClick={() => void clear()}>Clear</button>
        </div>
      </div>
      {logs.length === 0 && <p className="conn-empty">No gateway requests yet.</p>}
      <table className="logs-table">
        <thead>
          <tr>
            <th>Time</th><th>Account</th><th>Model</th><th>Status</th><th>Tokens</th><th>ms</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={i} title={l.error ?? ''}>
              <td>{fmtTime(l.ts)}</td>
              <td>{l.accountId ? l.accountId.slice(0, 8) : '—'}</td>
              <td>{l.model ?? '—'}</td>
              <td className={l.status >= 400 ? 'log-status-err' : 'log-status-ok'}>{l.status}</td>
              <td>{l.tokensIn + l.tokensOut}</td>
              <td>{l.durationMs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="settings-status">{error}</div>}
    </div>
  )
}
