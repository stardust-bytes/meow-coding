import { useEffect, useState } from 'react'
import type { McpServerStatus, MeowSettings, ProviderSettings } from '@shared/types'

interface Props {
  onClose: () => void
}

function modelsToText(models: string[]): string {
  return models.join(', ')
}

function textToModels(text: string): string[] {
  return text.split(',').map(s => s.trim()).filter(Boolean)
}

export default function SettingsDialog({ onClose }: Props) {
  const [providers, setProviders] = useState<ProviderSettings[]>([])
  const [defaultProvider, setDefaultProvider] = useState('')
  const [mcp, setMcp] = useState<McpServerStatus[]>([])
  const [status, setStatus] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')

  useEffect(() => {
    void window.api.getSettings().then(s => {
      setProviders(s.providers)
      setDefaultProvider(s.defaultProvider)
    })
    void window.api.getMcpStatus().then(setMcp)
  }, [])

  const update = (index: number, patch: Partial<ProviderSettings>) => {
    setProviders(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const remove = (index: number) => {
    setProviders(prev => prev.filter((_, i) => i !== index))
  }

  const add = () => {
    const id = `provider${providers.length + 1}`
    setProviders(prev => [...prev, { id, apiKey: '', baseUrl: '', models: [] }])
    if (!defaultProvider) setDefaultProvider(id)
  }

  const fetchModels = async (index: number) => {
    const id = providers[index].id.trim()
    if (!id || fetching) return
    setFetching(true)
    setFetchMsg('')
    try {
      const models = await window.api.fetchProviderModels(id)
      if (models.length > 0) update(index, { models })
      setFetchMsg(`${id}: ${models.length > 0 ? `${models.length} model(s) synced from models.dev` : 'not found or offline'}`)
    } finally {
      setFetching(false)
    }
  }

  const save = () => {
    const cleaned = providers
      .filter(p => p.id.trim() !== '' && p.models.length > 0)
      .map(p => ({
        id: p.id.trim(),
        apiKey: p.apiKey,
        baseUrl: p.baseUrl?.trim() || undefined,
        models: p.models
      }))
    if (cleaned.length === 0) {
      setStatus('Add at least one provider with an id and at least one model.')
      return
    }
    const def = cleaned.some(p => p.id === defaultProvider)
      ? defaultProvider
      : cleaned[0].id
    const settings: MeowSettings = { providers: cleaned, defaultProvider: def }
    void window.api.saveSettings(settings).then(() => {
      setStatus('Saved.')
      onClose()
    })
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={e => e.stopPropagation()}>
        <h3>AI Providers</h3>
        <p className="settings-hint">
          Add your own providers: each provider has an id, an API key (optional baseUrl for
          OpenAI-compatible endpoints) and a list of models. Empty api key falls back to the{' '}
          <code>{"{ID}_API_KEY"}</code> environment variable.
        </p>
        {providers.map((p, i) => (
          <div className="provider-row" key={p.id + i}>
            <input
              className="input provider-id"
              value={p.id}
              placeholder="id"
              onChange={e => update(i, { id: e.target.value })}
            />
            <input
              className="input"
              type="password"
              value={p.apiKey}
              placeholder="api key"
              onChange={e => update(i, { apiKey: e.target.value })}
            />
            <input
              className="input"
              value={p.baseUrl ?? ''}
              placeholder="baseUrl (openai-compatible)"
              onChange={e => update(i, { baseUrl: e.target.value })}
            />
            <input
              className="input provider-models"
              value={modelsToText(p.models)}
              placeholder="models (comma separated)"
              onChange={e => update(i, { models: textToModels(e.target.value) })}
            />
            <button className="btn small" disabled={!p.id.trim() || fetching} onClick={() => void fetchModels(i)}>
              fetch
            </button>
            <label className="provider-default">
              <input
                type="radio"
                checked={defaultProvider === p.id}
                onChange={() => setDefaultProvider(p.id)}
              />
              default
            </label>
            <button className="btn small" onClick={() => remove(i)}>remove</button>
          </div>
        ))}
        <div className="mcp-status">
          <h4>MCP servers</h4>
          {fetchMsg && <p className="settings-hint settings-fetch-msg">{fetchMsg}</p>}
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
        <div className="settings-actions">
          <button className="btn" onClick={add}>+ Add provider</button>
          <span className="spacer" />
          <button className="btn" onClick={save}>Save</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </div>
    </div>
  )
}
