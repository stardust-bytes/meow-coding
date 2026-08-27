import { useState } from 'react'
import type { CatalogProviderSummary, MeowSettings, ProviderSettings } from '@shared/types'
import Modal from './Modal'

interface Props {
  settings: MeowSettings
  catalog: CatalogProviderSummary[]
  onChange: (patch: Partial<MeowSettings>) => void
  /** Notify the shell that a provider action persisted settings directly
   *  (connect/disconnect/setDefault call IPC that writes meow.json), so it
   *  can update lastPersistedRef and show the save pill instead of racing
   *  with the debounced auto-save. */
  onPersisted: (result: MeowSettings) => void
  /** Refresh the provider catalog + settings from main (called after
   *  connect/disconnect so model counts and the Connected badge update
   *  without closing/reopening the settings page). */
  onRefresh: () => void
}

type ConnectModal =
  | { kind: 'catalog'; id: string; name: string }
  | { kind: 'manual' }
  | { kind: 'edit'; id: string; name: string }
  | null

export default function ProvidersTab({ settings, catalog, onChange, onPersisted, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ConnectModal>(null)
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [manualModels, setManualModels] = useState('')
  const [providerType, setProviderType] = useState('')
  const [originalProviderType, setOriginalProviderType] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

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
    setManualModels('')
    setProviderType('')
    setOriginalProviderType('')
    setModal({ kind: 'catalog', id, name })
  }

  const openManual = () => {
    setProviderId('')
    setApiKey('')
    setBaseUrl('')
    setManualModels('')
    setProviderType('')
    setOriginalProviderType('')
    setModal({ kind: 'manual' })
  }

  const openEdit = (p: ProviderSettings) => {
    setProviderId(p.id)
    setApiKey('')
    setBaseUrl(p.baseUrl ?? '')
    setManualModels(p.models.join(', '))
    setProviderType(p.providerType ?? '')
    setOriginalProviderType(p.providerType ?? '')
    setModal({ kind: 'edit', id: p.id, name: p.id })
  }

  const connect = async () => {
    const id = providerId.trim()
    if (!id || saving) return
    const isEdit = modal?.kind === 'edit'
    // Connect requires a key; edit keeps the current key when left blank.
    if (!isEdit && !apiKey.trim()) return
    const modelList = manualModels.split(/[\s,]+/).map(m => m.trim()).filter(Boolean)
    // On edit: empty providerType means "keep current"; on new: empty means auto-detect (undefined).
    const pType = isEdit
      ? (providerType.trim() || originalProviderType.trim() || undefined)
      : (providerType.trim() || undefined)
    setStatus('')
    setSaving(true)
    try {
      const result = await window.api.connectProvider(id, apiKey.trim(), baseUrl.trim() || undefined, modelList, pType)
      setModal(null)
      onPersisted(result)
      onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
      onRefresh()
      if (isEdit) {
        setStatus(apiKey.trim()
          ? `Saved ${id}. API key updated.`
          : `Saved ${id}. API key kept.`)
      } else {
        const provider = result.providers.find(p => p.id === id)
        setStatus(provider && provider.models.length > 0
          ? `Connected ${id}. ${provider.models.length} model(s) synced.`
          : `Connected ${id}. Add models in the modal or they will sync when models.dev is reachable.`)
      }
    } catch (err) {
      setStatus(String(err))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async (id: string) => {
    if (saving) return
    setSaving(true)
    setStatus('')
    try {
      const result = await window.api.disconnectProvider(id)
      if (expandedId === id) {
        setExpandedId(null)
        setModels([])
      }
      onPersisted(result)
      onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
      setStatus(`Disconnected ${id}.`)
      onRefresh()
    } catch (err) {
      setStatus(String(err))
    } finally {
      setSaving(false)
    }
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

  const syncModels = async (id: string) => {
    setStatus('')
    try {
      const live = await window.api.fetchProviderModels(id)
      // Live-sync the stored list too, so the model picker sees it immediately.
      const p = connected.find(x => x.id === id)
      if (p) {
        const next = connected.map(c => (c.id === id ? { ...c, models: live.length > 0 ? live : c.models } : c))
        const result = await window.api.saveSettings({ ...settings, defaultProvider: settings.defaultProvider, providers: next })
        onPersisted(result)
        onChange({ providers: result.providers })
      }
      setStatus(live.length > 0 ? `Synced ${id}. ${live.length} model(s).` : `No models for ${id}. Add them manually in Edit.`)
      setModels(live)
    } catch (err) {
      setStatus(String(err))
    }
  }

  const setDefault = async (id: string) => {
    // Persist immediately (like connect/disconnect) instead of patching the
    // draft: onRefresh would re-fetch the unsaved value and clobber the change.
    const result = await window.api.saveSettings({ ...settings, defaultProvider: id })
    onPersisted(result)
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
              <button className="btn small" onClick={() => void syncModels(p.id)}>Sync models</button>
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
          submitLabel={saving ? 'Saving…' : modal.kind === 'edit' ? 'Save changes' : 'Connect'}
          submitDisabled={saving || !providerId.trim() || (modal.kind !== 'edit' && !apiKey.trim())}
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
              disabled={saving}
              onChange={e => setProviderId(e.target.value)}
            />
          )}
          <input
            className="input provider-key"
            type="password"
            placeholder={modal.kind === 'edit' ? 'api key (leave blank to keep current)' : 'api key'}
            value={apiKey}
            disabled={saving}
            onChange={e => setApiKey(e.target.value)}
          />
          <input
            className="input provider-baseurl"
            placeholder="baseUrl (optional, any OpenAI-compatible endpoint)"
            value={baseUrl}
            disabled={saving}
            onChange={e => setBaseUrl(e.target.value)}
          />
          <textarea
            className="input provider-models"
            rows={3}
            placeholder="models (comma or space separated, e.g. gpt-4o, claude-3-5-sonnet)"
            value={manualModels}
            disabled={saving}
            onChange={e => setManualModels(e.target.value)}
          />
          <select
            className="input provider-type"
            value={providerType}
            disabled={saving}
            onChange={e => setProviderType(e.target.value)}
          >
            <option value="">Auto-detect (default)</option>
            <option value="deepseek">DeepSeek (requires reasoning_content echo)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
          </select>
          <p className="settings-hint">
            Leave models blank to auto-sync from the endpoint's <code>/models</code> (or models.dev).
            Typing models here overrides the synced list — this is how you add any OpenAI-compatible API.
            Select a provider type if your API requires special handling (e.g. DeepSend reasoning_content).
          </p>
        </Modal>
      )}
    </div>
  )
}
