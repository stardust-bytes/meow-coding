import { useCallback, useEffect, useState } from 'react'
import type { ConnectionsState, ProviderAccount } from '@shared/types'

function QuotaBar({ account }: { account: ProviderAccount }) {
  const quota = account.quota
  if (quota?.used === undefined || quota?.limit === undefined || quota.limit <= 0) {
    return <span className="conn-quota-none">{account.quotaError ? 'quota error' : 'no quota data'}</span>
  }
  const ratio = Math.min(1, quota.used / quota.limit)
  const pct = Math.round(ratio * 100)
  const cls = ratio >= 0.9 ? 'conn-quota-high' : ratio >= 0.6 ? 'conn-quota-mid' : 'conn-quota-ok'
  return (
    <span className={`conn-quota ${cls}`} title={quota.planType ? `Plan: ${quota.planType}` : undefined}>
      {pct}%
      <span className="conn-quota-bar"><span style={{ width: `${pct}%` }} /></span>
    </span>
  )
}

const PROVIDER_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', apikey: 'API Keys' }

export default function QuotaTab() {
  const [state, setState] = useState<ConnectionsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setState(await window.api.listConnections())
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => window.api.onConnectionsChanged(() => void refresh()), [])

  const refreshQuota = async () => {
    setBusy(true)
    setError('')
    try {
      await window.api.refreshConnectionsQuota()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <div className="mr-tab">Loading…</div>

  const accounts = state.providers
    .filter(p => p.provider !== 'apikey')
    .flatMap(p => p.accounts.map(a => ({ provider: p.provider, account: a })))

  return (
    <div className="mr-tab quota-tab">
      <div className="quota-head">
        <span className="settings-hint">Usage/plan per account. Auto-refresh mỗi 45 phút.</span>
        <button className="btn small" disabled={busy} onClick={() => void refreshQuota()}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {accounts.length === 0 && <p className="conn-empty">No accounts yet.</p>}
      {accounts.map(({ provider, account }) => (
        <div className="conn-account" key={account.id}>
          <div className="conn-account-main">
            <span className="conn-account-name">
              {account.name}
              {account.id === state.providers.find(p => p.provider === provider)?.activeAccountId && (
                <span className="conn-active-badge">active</span>
              )}
            </span>
            <span className="conn-account-meta">
              {PROVIDER_LABELS[provider] ?? provider}
              {account.profile?.planType ? ` · ${account.profile.planType}` : ''}
            </span>
            <QuotaBar account={account} />
          </div>
        </div>
      ))}
      {error && <div className="settings-status">{error}</div>}
    </div>
  )
}
