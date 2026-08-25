import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelRef } from '@shared/types'

interface Props {
  agentId: string
}

interface Group {
  key: string
  label: string
  models: ModelRef[]
}

export default function ModelPicker({ agentId }: Props) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ModelRef | null>(null)
  const [models, setModels] = useState<ModelRef[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    void window.api.getAgentModel(agentId).then(setCurrent)
    Promise.all([
      window.api.getProviderModels(),
      window.api.getConnectionModels().catch(() => [])
    ]).then(([providerModels, connectionModels]) => {
      setModels([...providerModels, ...connectionModels])
      setError('')
    }).catch(err => {
      setError(String(err))
    })
  }, [agentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byKey = new Map<string, Group>()
    for (const m of models) {
      if (q && !m.model.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q)) continue
      // Account-scoped models (e.g. Codex) group under the owning account label.
      const key = m.accountId ? `${m.provider}:${m.accountId}` : m.provider
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.models.some(x => x.model === m.model && x.accountId === m.accountId)) existing.models.push(m)
      } else {
        byKey.set(key, {
          key,
          label: m.accountId && m.accountLabel ? `${m.accountLabel} (${m.provider})` : m.provider,
          models: [m]
        })
      }
    }
    return [...byKey.values()]
  }, [models, search])

  const label = current?.model ?? 'no model'

  const pick = (m: ModelRef) => {
    setOpen(false)
    setCurrent(m)
    void window.api.setAgentModel(agentId, m)
    window.dispatchEvent(new CustomEvent('meow:model-changed', { detail: { agentId } }))
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className="model-trigger"
        title="Switch model"
        onClick={() => { refresh(); setSearch(''); setOpen(v => !v) }}
      >
        <span className="model-label">{label}</span>
        <span className="model-caret">▾</span>
      </button>
      {open && (
        <div className="model-menu">
          <input
            className="input model-search"
            placeholder="Search model..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="model-list">
            {groups.length === 0 && !error && <span className="model-empty">No providers configured</span>}
            {error && <span className="model-error">{error}</span>}
            {groups.map(group => (
              <div key={group.key} className="model-group">
                <div className="model-group-head">{group.label}</div>
                {group.models.map(m => (
                  <button
                    key={group.key + '/' + m.model}
                    className={`model-item ${current?.provider === m.provider && current?.model === m.model && current?.accountId === m.accountId ? 'active' : ''}`}
                    onClick={() => pick(m)}
                  >
                    {m.model}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
