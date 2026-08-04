import { useCallback, useEffect, useState } from 'react'
import type { CatalogProviderSummary, McpServerStatus, ProviderSettings } from '@shared/types'

interface Props {
  onClose: () => void
}

export default function ProvidersDialog({ onClose }: Props) {
  const [connected, setConnected] = useState<ProviderSettings[]>([])
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [mcp, setMcp] = useState<McpServerStatus[]>([])
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

  const refresh = useCallback(async () => {
    const settings = await window.api.getSettings()
    setConnected(settings.providers)
    setCatalog(await window.api.listProviderCatalog())
    setMcp(await window.api.getMcpStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = catalog.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  )

  const connect = async (id: string) => {
    setStatus('')
    const models = await window.api.connectProvider(id, apiKey.trim(), baseUrl.trim() || undefined)
    setConnectingId(null)
    setApiKey('')
    setBaseUrl('')
    await refresh()
    const provider = models.providers.find(p => p.id === id)
    setStatus(provider && provider.models.length > 0
      ? `Connected ${id}. ${provider.models.length} model(s) synced.`
      : `Connected ${id}. Models will sync when models.dev is reachable.`)
  }

  const connectManual = async () => {
    const id = manualId.trim()
    if (!id) return
    setStatus('')
    const models = await window.api.connectProvider(id, manualApiKey.trim(), manualBaseUrl.trim() || undefined)
    setManualOpen(false)
    setManualId('')
    setManualApiKey('')
    setManualBaseUrl('')
    await refresh()
    const provider = models.providers.find(p => p.id === id)
    setStatus(provider && provider.models.length > 0
      ? `Connected ${id}. ${provider.models.length} model(s) synced.`
      : `Connected ${id}. Models will sync when models.dev is reachable.`)
  }

  const disconnect = async (id: string) => {
    await window.api.disconnectProvider(id)
    if (expandedId === id) {
      setExpandedId(null)
      setModels([])
    }
    await refresh()
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

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog providers-dialog" onClick={e => e.stopPropagation()}>
        <h3>Providers</h3>
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
                </button>
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

        <div className="mcp-status">
          <h4>MCP servers</h4>
          {mcp.length === 0 && (
            <p className="settings-hint">
              No MCP servers configured. Add them to <code>meow.json</code> (e.g. a Playwright MCP server).
            </p>
          )}
          {mcp.map(s => (
            <div key={s.name} className="mcp-row">
              <span className={`mcp-dot ${s.status}`} />
              <span className="mcp-name">{s.name}</span>
              <span className="mcp-tools">
                {s.status === 'connected' ? `${s.tools.length} tool(s)` : 'failed'}
              </span>
              {s.error && <span className="mcp-error">{s.error}</span>}
            </div>
          ))}
        </div>

        {status && <div className="settings-status">{status}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
