import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionsState, ProviderAccount, ProviderId } from '@shared/types'
import Modal from '../settings/Modal'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  apikey: 'API Keys'
}

const AUTH_LABELS: Record<string, string> = {
  oauth: 'OAuth',
  'api-key': 'API key',
  imported: 'Imported',
  desktop: 'Desktop'
}

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

export default function ConnectionsTab() {
  const [state, setState] = useState<ConnectionsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [login, setLogin] = useState<{ provider: ProviderId; loginId: string } | null>(null)
  const [pasteCode, setPasteCode] = useState('')
  const [importProvider, setImportProvider] = useState<ProviderId | null>(null)
  const [importJson, setImportJson] = useState('')
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState({ label: '', apiKey: '', apiBaseUrl: '', apiKeyField: '', note: '' })

  const refresh = useCallback(async () => {
    setState(await window.api.listConnections())
  }, [])

  useEffect(() => {
    void refresh()
    const offChanged = window.api.onConnectionsChanged(() => void refresh())
    return offChanged
  }, [refresh])

  const startLogin = async (provider: ProviderId) => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.startConnectionLogin(provider)
      setLogin({ provider, loginId: result.loginId })
      setPasteCode('')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (!login) return
    setBusy(true)
    setError('')
    try {
      await window.api.submitConnectionCode(login.loginId, pasteCode.trim())
      setLogin(null)
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const submitCodex = async (loginId: string) => {
    setBusy(true)
    setError('')
    try {
      // Callback mode: the local server captures the code automatically. The
      // main-side waitForCallback resolves instantly if the callback already
      // arrived (cached), so this completes as soon as the browser redirects.
      await window.api.submitConnectionCode(loginId, '')
      setLogin(null)
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // Auto-complete Codex login when the modal opens — no manual "I finished"
  // click needed. Guard against double-fire (StrictMode).
  const codexAutoFired = useRef<string | null>(null)
  useEffect(() => {
    if (login?.provider === 'codex' && codexAutoFired.current !== login.loginId) {
      codexAutoFired.current = login.loginId
      void submitCodex(login.loginId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login])

  const switchAccount = async (provider: ProviderId, accountId: string) => {
    await window.api.switchConnectionAccount(provider, accountId)
    await refresh()
  }

  const removeAccount = async (accountId: string) => {
    await window.api.removeConnectionAccount(accountId)
    await refresh()
  }

  const doImport = async () => {
    if (!importProvider) return
    setBusy(true)
    setError('')
    try {
      await window.api.importConnectionAccount(importProvider, importJson)
      setImportProvider(null)
      setImportJson('')
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveApiKey = async () => {
    setBusy(true)
    setError('')
    try {
      await window.api.saveApiKeyAccount({
        label: apiKeyInput.label,
        apiKey: apiKeyInput.apiKey,
        apiBaseUrl: apiKeyInput.apiBaseUrl || undefined,
        apiKeyField: apiKeyInput.apiKeyField || undefined,
        note: apiKeyInput.note || undefined
      })
      setApiKeyOpen(false)
      setApiKeyInput({ label: '', apiKey: '', apiBaseUrl: '', apiKeyField: '', note: '' })
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <div className="settings-tab connections-tab">Loading…</div>

  return (
    <div className="settings-tab connections-tab">
      <p className="settings-hint">
        Manage authenticated accounts for the CLIs Meow spawns (Claude Code, Codex). Secrets are
        stored encrypted in the OS keychain. Switch the active account to route new agents through it.
      </p>

      {state.providers.filter(p => p.provider !== 'apikey').map(provider => (
        <div className="conn-provider" key={provider.provider}>
          <div className="conn-provider-head">
            <h4>{PROVIDER_LABELS[provider.provider]}</h4>
            <div className="conn-provider-actions">
              <button className="btn small" disabled={busy} onClick={() => void startLogin(provider.provider)}>
                Login
              </button>
              <button className="btn small" onClick={() => { setImportProvider(provider.provider); setImportJson('') }}>
                Import JSON
              </button>
              {provider.provider === 'claude' && (
                <button className="btn small" onClick={() => { setApiKeyOpen(true); setApiKeyInput({ ...apiKeyInput, apiKeyField: 'ANTHROPIC_API_KEY' }) }}>
                  Add API key
                </button>
              )}
            </div>
          </div>

          {provider.accounts.length === 0 && <p className="conn-empty">No accounts yet.</p>}
          {provider.accounts.map(account => (
            <div className={`conn-account${account.id === provider.activeAccountId ? ' active' : ''}`} key={account.id}>
              <div className="conn-account-main">
                <span className="conn-account-name">
                  {account.name}
                  {account.id === provider.activeAccountId && <span className="conn-active-badge">active</span>}
                </span>
                <span className="conn-account-meta">
                  {AUTH_LABELS[account.authMode] ?? account.authMode}
                  {account.profile?.planType ? ` · ${account.profile.planType}` : ''}
                </span>
                <QuotaBar account={account} />
              </div>
              <div className="conn-account-actions">
                {account.id !== provider.activeAccountId && (
                  <button className="btn small" onClick={() => void switchAccount(provider.provider, account.id)}>
                    Switch
                  </button>
                )}
                <button className="btn small danger" onClick={() => void removeAccount(account.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="conn-provider">
        <div className="conn-provider-head">
          <h4>API Keys (vault)</h4>
          <button className="btn small" onClick={() => { setApiKeyOpen(true); setApiKeyInput({ label: '', apiKey: '', apiBaseUrl: '', apiKeyField: '', note: '' }) }}>
            + Add key
          </button>
        </div>
        {state.providers.find(p => p.provider === 'apikey')?.accounts.map(account => (
          <div className="conn-account" key={account.id}>
            <div className="conn-account-main">
              <span className="conn-account-name">{account.name}</span>
              <span className="conn-account-meta">
                {account.apiKeyField ?? 'ANTHROPIC_API_KEY'}{account.apiBaseUrl ? ` · ${account.apiBaseUrl}` : ''}
              </span>
            </div>
            <div className="conn-account-actions">
              <button className="btn small" onClick={() => void testKey(account.id, setError)}>Test</button>
              <button className="btn small danger" onClick={() => void removeAccount(account.id)}>Remove</button>
            </div>
          </div>
        ))}
        {state.providers.find(p => p.provider === 'apikey')?.accounts.length === 0 && (
          <p className="conn-empty">No API keys stored.</p>
        )}
      </div>

      {error && <div className="settings-status">{error}</div>}

      {login && (
        <Modal title={`Login ${PROVIDER_LABELS[login.provider]}`} onClose={() => { setLogin(null); void window.api.cancelConnectionLogin(login.loginId) }}>
          {login.provider === 'codex' ? (
            <div>
              <p className="settings-hint">
                A browser tab should have opened. Complete the login there — the app will continue
                automatically when the browser redirects back to the local callback.
              </p>
              <div className="dialog-actions">
                <button className="btn" onClick={() => { setLogin(null); void window.api.cancelConnectionLogin(login.loginId) }}>Cancel</button>
                <button className="btn primary" disabled={busy} onClick={() => void submitCodex(login.loginId)}>
                  {busy ? 'Waiting for callback…' : 'I finished in the browser (retry)'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="settings-hint">
                Log in in the browser. After login you will be redirected to
                <code>platform.claude.com/oauth/code/callback?code=…</code> — paste the <b>whole URL</b>
                (or just the <code>code</code> value) below.
              </p>
              <input
                className="input"
                placeholder="Paste the callback URL or code"
                value={pasteCode}
                onChange={e => setPasteCode(e.target.value)}
              />
              <div className="dialog-actions">
                <button className="btn" onClick={() => { setLogin(null); void window.api.cancelConnectionLogin(login.loginId) }}>Cancel</button>
                <button className="btn primary" disabled={busy || !pasteCode.trim()} onClick={() => void submitCode()}>
                  {busy ? 'Exchanging…' : 'Complete login'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {importProvider && (
        <Modal title={`Import ${PROVIDER_LABELS[importProvider]} JSON`} onClose={() => setImportProvider(null)} onSubmit={() => void doImport()} submitLabel="Import" submitDisabled={!importJson.trim()}>
          <p className="settings-hint">
            Paste the exported credentials JSON (e.g. <code>.credentials.json</code> for Claude,{' '}
            <code>~/.codex/auth.json</code> for Codex).
          </p>
          <textarea className="input conn-import-json" rows={6} value={importJson} onChange={e => setImportJson(e.target.value)} />
        </Modal>
      )}

      {apiKeyOpen && (
        <Modal title="Add API key" onClose={() => setApiKeyOpen(false)} onSubmit={() => void saveApiKey()} submitLabel="Save" submitDisabled={!apiKeyInput.label.trim() || !apiKeyInput.apiKey.trim()}>
          <div className="conn-form">
            <label>Label <input className="input" value={apiKeyInput.label} onChange={e => setApiKeyInput({ ...apiKeyInput, label: e.target.value })} /></label>
            <label>API key <input className="input" type="password" value={apiKeyInput.apiKey} onChange={e => setApiKeyInput({ ...apiKeyInput, apiKey: e.target.value })} /></label>
            <label>Base URL (optional, for relays)
              <input className="input" placeholder="https://api.anthropic.com" value={apiKeyInput.apiBaseUrl} onChange={e => setApiKeyInput({ ...apiKeyInput, apiBaseUrl: e.target.value })} />
            </label>
            <label>Key env field
              <select className="input" value={apiKeyInput.apiKeyField} onChange={e => setApiKeyInput({ ...apiKeyInput, apiKeyField: e.target.value })}>
                <option value="ANTHROPIC_API_KEY">ANTHROPIC_API_KEY</option>
                <option value="ANTHROPIC_AUTH_TOKEN">ANTHROPIC_AUTH_TOKEN</option>
                <option value="OPENAI_API_KEY">OPENAI_API_KEY</option>
              </select>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}

async function testKey(accountId: string, setError: (e: string) => void): Promise<void> {
  try {
    const result = await window.api.testApiKeyAccount(accountId)
    setError(result.ok ? 'Key is valid.' : `Key test failed: ${result.error ?? 'unknown'}`)
  } catch (err) {
    setError(String(err))
  }
}
