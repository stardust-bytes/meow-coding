import { useEffect, useState } from 'react'
import type { MeowSettings, ProviderSettings } from '@shared/types'

interface Props {
  onClose: () => void
}

interface Preset {
  baseUrl?: string
  model: string
}

const PRESETS: Record<string, Preset | undefined> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  anthropic: { model: 'claude-sonnet-4-5' },
  custom: undefined
}

export default function SettingsDialog({ onClose }: Props) {
  const [providers, setProviders] = useState<ProviderSettings[]>([])
  const [defaultProvider, setDefaultProvider] = useState('')
  const [status, setStatus] = useState('')
  const [preset, setPreset] = useState('')

  useEffect(() => {
    void window.api.getSettings().then(s => {
      setProviders(s.providers)
      setDefaultProvider(s.defaultProvider)
    })
  }, [])

  const update = (index: number, patch: Partial<ProviderSettings>) => {
    setProviders(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const remove = (index: number) => {
    setProviders(prev => prev.filter((_, i) => i !== index))
  }

  const addPreset = () => {
    const conf = PRESETS[preset]
    const id = preset && preset !== 'custom' ? preset : `provider${providers.length + 1}`
    setProviders(prev => [...prev, { id, apiKey: '', baseUrl: conf?.baseUrl, model: conf?.model ?? '' }])
    if (!defaultProvider) setDefaultProvider(id)
    setPreset('')
  }

  const save = () => {
    const cleaned = providers
      .filter(p => p.id.trim() !== '' && p.model.trim() !== '')
      .map(p => ({
        id: p.id.trim(),
        apiKey: p.apiKey,
        baseUrl: p.baseUrl?.trim() || undefined,
        model: p.model.trim()
      }))
    if (cleaned.length === 0) {
      setStatus('Add at least one provider with an id and model.')
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
          Add providers (Anthropic, OpenAI, DeepSeek, local...). Empty api key falls back to the{' '}
          <code>{"{ID}_API_KEY"}</code> environment variable. Provider is OpenAI-compatible unless id is
          <code> anthropic</code>.
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
              value={p.model}
              placeholder="model (e.g. deepseek-chat)"
              onChange={e => update(i, { model: e.target.value })}
            />
            <input
              className="input"
              value={p.baseUrl ?? ''}
              placeholder="baseUrl (openai-compatible)"
              onChange={e => update(i, { baseUrl: e.target.value })}
            />
            <input
              className="input"
              type="password"
              value={p.apiKey}
              placeholder="api key"
              onChange={e => update(i, { apiKey: e.target.value })}
            />
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
        <div className="settings-actions">
          <select className="input" value={preset} onChange={e => setPreset(e.target.value)}>
            <option value="">Add provider…</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">Custom</option>
          </select>
          {preset && <button className="btn small" onClick={addPreset}>add</button>}
          <span className="spacer" />
          <button className="btn" onClick={save}>Save</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </div>
    </div>
  )
}
