import { useCallback, useEffect, useState } from 'react'
import type { CatalogProviderSummary, ConnectionAccount, MeowSettings, ProviderSettings } from '@shared/types'
import Modal from './Modal'

interface Props {
  settings: MeowSettings
  catalog: CatalogProviderSummary[]
  onChange: (patch: Partial<MeowSettings>) => void
}

type ConnectModal =
  | { kind: 'catalog'; id: string; name: string }
  | { kind: 'manual' }
  | { kind: 'edit'; id: string; name: string }
  | null

export default function ProvidersTab({ settings, catalog, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ConnectModal>(null)
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [connections, setConnections] = useState<ConnectionAccount[]>([])
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexError, setCodexError] = useState('')

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await window.api.listConnections())
    } catch (err) {
      setCodexError(String(err))
    }
  }, [])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  const connectCodex = async () => {
    setCodexBusy(true)
    setCodexError('')
    try {
      await window.api.connectCodex()
      await loadConnections()
    } catch (err) {
      setCodexError(String(err))
    } finally {
      setCodexBusy(false)
    }
  }

  const setActiveCodex = async (id: string) => {
    setCodexError('')
    try {
      await window.api.setActiveConnection(id)
      await loadConnections()
    } catch (err) {
      setCodexError(String(err))
    }
  }

  const disconnectCodex = async (id: string) => {
    setCodexError('')
    try {
      setConnections(await window.api.disconnectConnection(id))
    } catch (err) {
      setCodexError(String(err))
    }
  }

  const connected = settings.providers

  const filtered = catalog.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  )

  const openCatalog = (id: string, name: string) => {
    setProviderId(id)
    setApiKey('')
    setBaseUrl('')
    setModal({ kind: 'catalog', id, name })
  }

  const openManual = () => {
    setProviderId('')
    setApiKey('')
    setBaseUrl('')
    setModal({ kind: 'manual' })
  }

  const openEdit = (p: ProviderSettings) => {
    setProviderId(p.id)
    setApiKey('')
    setBaseUrl(p.baseUrl ?? '')
    setModal({ kind: 'edit', id: p.id, name: p.id })
  }

  const connect = async () => {
    const id = providerId.trim()
    if (!id) return
    const isEdit = modal?.kind === 'edit'
    // Connect requires a key; edit keeps the current key when left blank.
    if (!isEdit && !apiKey.trim()) return
    setStatus('')
    const result = await window.api.connectProvider(id, apiKey.trim(), baseUrl.trim() || undefined)
    setModal(null)
    onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
    if (isEdit) {
      setStatus(apiKey.trim()
        ? `Saved ${id}. API key updated.`
        : `Saved ${id}. API key kept.`)
    } else {
      const provider = result.providers.find(p => p.id === id)
      setStatus(provider && provider.models.length > 0
        ? `Connected ${id}. ${provider.models.length} model(s) synced.`
        : `Connected ${id}. Models will sync when models.dev is reachable.`)
    }
  }

  const disconnect = async (id: string) => {
    const result = await window.api.disconnectProvider(id)
    if (expandedId === id) {
      setExpandedId(null)
      setModels([])
    }
    onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
    setStatus(`Disconnected ${id}.`)
  }

  const maskKey = (key: string): string =>
    key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`

  const viewModels = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setModels([])
      return
    }
    setExpandedId(id)
    setModels(await window.api.fetchProviderModels(id))
  }

  const setDefault = async (id: string) => {
    // Persist immediately (like connect/disconnect) instead of patching the
    // draft: onRefresh would re-fetch the unsaved value and clobber the change.
    await window.api.saveSettings({ ...settings, defaultProvider: id })
    onChange({ defaultProvider: id })
  }

  return (
    <div className="settings-tab providers-tab">
      <div className="provider-actions">
        <button className="btn" onClick={openManual}>+ Connect provider</button>
      </div>
      <p className="settings-hint">
        Find a provider below and enter your API key, or use "+ Connect provider". Models are synced
        automatically from models.dev. API keys are stored encrypted in the OS keychain.
      </p>

      <div className="provider-connect">
        <input
          className="input provider-search"
          placeholder="Search providers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="provider-catalog">
          {filtered.map(c => {
            const isConnected = connected.some(p => p.id === c.id)
            return (
              <div className="provider-catalog-row" key={c.id}>
                <span className="provider-catalog-name">
                  {c.name} <code>{c.id}</code>
                </span>
                <span className="provider-catalog-meta">{c.modelCount} models</span>
                {isConnected ? (
                  <span className="provider-catalog-connected">Connected</span>
                ) : (
                  <button className="btn small" onClick={() => openCatalog(c.id, c.name)}>
                    Connect
                  </button>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <p className="settings-hint">No providers match.</p>}
        </div>
      </div>

      <div className="provider-codex">
        <h4>Codex (ChatGPT OAuth)</h4>
        <p className="settings-hint">
          Connect ChatGPT/Codex accounts to chat with Codex models. Account credentials are stored
          encrypted in the OS keychain and chat is routed through a local account-scoped proxy.
        </p>
        {connections.length === 0 ? (
          <button className="btn" onClick={() => void connectCodex()} disabled={codexBusy}>
            {codexBusy ? 'Connecting…' : 'Connect Codex'}
          </button>
        ) : (
          <ul className="codex-account-list">
            {connections.map(a => (
              <li key={a.id} className="codex-account-row">
                <span className="codex-account-identity">
                  <span className="provider-connected-name">{a.displayName}</span>
                  {a.email && <span className="codex-account-email">{a.email}</span>}
                  <span className={`codex-status codex-status-${a.status}${a.active ? ' codex-status-active' : ''}`} title={a.error ?? ''}>
                    {a.active ? 'active' : a.status}
                  </span>
                </span>
                <span className="codex-account-actions">
                  {a.status === 'ready' && !a.active && (
                    <button className="btn small" onClick={() => void setActiveCodex(a.id)}>set active</button>
                  )}
                  {(a.status === 'error' || a.status === 'expired') && (
                    <button className="btn small" onClick={() => void connectCodex()} title={a.error ?? ''}>
                      reconnect
                    </button>
                  )}
                  <button className="btn small" onClick={() => void disconnectCodex(a.id)}>Disconnect</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {codexError && <p className="settings-error">{codexError}</p>}
      </div>

      <div className="provider-connected">
        <h4>Connected</h4>
        {connected.map(p => (
          <div key={p.id}>
            <div className="provider-connected-row">
              <button className="provider-connected-toggle" onClick={() => void viewModels(p.id)}>
                <span className="mcp-dot connected" />
                <span className="provider-connected-name">{p.id}</span>
              </button>
              {p.keyRef
                ? <span className="provider-connected-secure" title="Key stored encrypted in OS keychain">🔒 key vaulted</span>
                : p.apiKey
                  ? <span className="provider-connected-secure" title="Key stored in settings (not encrypted)">key {maskKey(p.apiKey)}</span>
                  : null}
              {p.baseUrl && <span className="provider-connected-baseurl">{p.baseUrl}</span>}
              <button className="btn small" onClick={() => openEdit(p)}>Edit</button>
              <button className="btn small" onClick={() => void setDefault(p.id)}>
                {settings.defaultProvider === p.id ? 'default' : 'set default'}
              </button>
              <button className="btn small" onClick={() => void disconnect(p.id)}>Disconnect</button>
            </div>
            {expandedId === p.id && (
              <div className="provider-models">
                {models.length > 0 ? models.map(m => <code key={m}>{m}</code>) : <span className="settings-hint">Loading models…</span>}
              </div>
            )}
          </div>
        ))}
        {connected.length === 0 && <p className="settings-hint">No providers connected yet.</p>}
      </div>

      {status && <div className="settings-status">{status}</div>}

      {modal && (
        <Modal
          title={modal.kind === 'catalog' ? `Connect ${modal.name}` : modal.kind === 'edit' ? `Edit ${modal.name}` : 'Connect provider'}
          onClose={() => setModal(null)}
          onSubmit={() => void connect()}
          submitLabel={modal.kind === 'edit' ? 'Save changes' : 'Connect'}
          submitDisabled={!providerId.trim() || (modal.kind !== 'edit' && !apiKey.trim())}
        >
          {modal.kind === 'catalog' ? (
            <p className="settings-hint">
              Provider <code>{modal.id}</code> — enter your API key below. It will be stored encrypted
              in the OS keychain.
            </p>
          ) : modal.kind === 'edit' ? (
            <>
              <input className="input" value={providerId} disabled />
              <p className="settings-hint">
                Leave the API key blank to keep the current key. It is stored encrypted in the OS
                keychain and never shown again.
              </p>
            </>
          ) : (
            <input
              className="input"
              placeholder="provider id (e.g. deepseek)"
              value={providerId}
              onChange={e => setProviderId(e.target.value)}
            />
          )}
          <input
            className="input provider-key"
            type="password"
            placeholder={modal.kind === 'edit' ? 'api key (leave blank to keep current)' : 'api key'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <input
            className="input provider-baseurl"
            placeholder="baseUrl (optional)"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
          />
        </Modal>
      )}
    </div>
  )
}
