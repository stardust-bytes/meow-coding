import { useState } from 'react'
import type { CatalogProviderSummary, MeowSettings } from '@shared/types'

interface Props {
  settings: MeowSettings
  catalog: CatalogProviderSummary[]
  onChange: (patch: Partial<MeowSettings>) => void
  onRefresh: () => void
}

export default function ProvidersTab({ settings, catalog, onChange, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualId, setManualId] = useState('')
  const [manualApiKey, setManualApiKey] = useState('')
  const [manualBaseUrl, setManualBaseUrl] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')

  const connected = settings.providers

  const filtered = catalog.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  )

  const connect = async (id: string) => {
    setStatus('')
    const result = await window.api.connectProvider(id, apiKey.trim(), baseUrl.trim() || undefined)
    setConnectingId(null)
    setApiKey('')
    setBaseUrl('')
    onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
    const provider = result.providers.find(p => p.id === id)
    setStatus(provider && provider.models.length > 0
      ? `Connected ${id}. ${provider.models.length} model(s) synced.`
      : `Connected ${id}. Models will sync when models.dev is reachable.`)
  }

  const connectManual = async () => {
    const id = manualId.trim()
    if (!id) return
    setStatus('')
    const result = await window.api.connectProvider(id, manualApiKey.trim(), manualBaseUrl.trim() || undefined)
    setManualOpen(false)
    setManualId('')
    setManualApiKey('')
    setManualBaseUrl('')
    onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
    const provider = result.providers.find(p => p.id === id)
    setStatus(provider && provider.models.length > 0
      ? `Connected ${id}. ${provider.models.length} model(s) synced.`
      : `Connected ${id}. Models will sync when models.dev is reachable.`)
  }

  const disconnect = async (id: string) => {
    const result = await window.api.disconnectProvider(id)
    if (expandedId === id) {
      setExpandedId(null)
      setModels([])
    }
    onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
  }

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
    onChange({ defaultProvider: id })
    await onRefresh()
  }

  return (
    <div className="settings-tab providers-tab">
      <div className="provider-actions">
        <button className="btn" onClick={() => setManualOpen(v => !v)}>+ Connect provider</button>
      </div>
      {manualOpen && (
        <div className="provider-manual">
          <input
            className="input provider-manual-id"
            placeholder="provider id (e.g. deepseek)"
            value={manualId}
            onChange={e => setManualId(e.target.value)}
          />
          <input
            className="input provider-manual-key"
            type="password"
            placeholder="api key"
            value={manualApiKey}
            onChange={e => setManualApiKey(e.target.value)}
          />
          <input
            className="input provider-manual-baseurl"
            placeholder="baseUrl (optional)"
            value={manualBaseUrl}
            onChange={e => setManualBaseUrl(e.target.value)}
          />
          <button className="btn primary" disabled={!manualId.trim() || !manualApiKey.trim()} onClick={() => void connectManual()}>
            Connect
          </button>
        </div>
      )}
      <p className="settings-hint">
        Find a provider below and enter your API key, or use "+ Connect provider". Models are synced
        automatically from models.dev.
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
                  <span className="provider-catalog-connected">connected</span>
                ) : connectingId === c.id ? (
                  <span className="provider-connect-form">
                    <input
                      className="input provider-key"
                      type="password"
                      placeholder="api key"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                    />
                    <input
                      className="input provider-baseurl"
                      placeholder="baseUrl (optional)"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                    />
                    <button className="btn small" disabled={!apiKey.trim()} onClick={() => void connect(c.id)}>
                      connect
                    </button>
                  </span>
                ) : (
                  <button className="btn small" onClick={() => { setConnectingId(c.id); setApiKey(''); setBaseUrl('') }}>
                    connect
                  </button>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <p className="settings-hint">No providers match.</p>}
        </div>
      </div>

      <div className="provider-connected">
        <h4>Connected</h4>
        {connected.map(p => (
          <div key={p.id}>
            <div className="provider-connected-row">
              <button className="provider-connected-toggle" onClick={() => void viewModels(p.id)}>
                <span className="mcp-dot connected" />
                <span className="provider-connected-name">{p.id}</span>
                <span className="provider-connected-meta">{p.models.length} models</span>
                {settings.defaultProvider === p.id && (
                  <span className="provider-default">default</span>
                )}
              </button>
              <button className="btn small" onClick={() => void setDefault(p.id)}>default</button>
              <button className="btn small" onClick={() => void disconnect(p.id)}>remove</button>
            </div>
            {expandedId === p.id && (
              <div className="provider-models">
                {models.length === 0
                  ? <span className="settings-hint">No models found.</span>
                  : models.map(m => <code key={m}>{m}</code>)}
              </div>
            )}
          </div>
        ))}
        {connected.length === 0 && <p className="settings-hint">No providers connected yet.</p>}
      </div>

      {status && <div className="settings-status">{status}</div>}
    </div>
  )
}
