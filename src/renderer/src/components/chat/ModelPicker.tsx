import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelRef } from '@shared/types'

interface Props {
  agentId: string
}

export default function ModelPicker({ agentId }: Props) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ModelRef | null>(null)
  const [models, setModels] = useState<ModelRef[]>([])
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    void window.api.getAgentModel(agentId).then(setCurrent)
    void window.api.getProviderModels().then(setModels)
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
    const byProvider = new Map<string, string[]>()
    for (const m of models) {
      if (q && !m.model.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q)) continue
      const list = byProvider.get(m.provider) ?? []
      list.push(m.model)
      byProvider.set(m.provider, list)
    }
    return [...byProvider.entries()]
  }, [models, search])

  const label = current?.model ?? 'no model'

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className="model-trigger"
        title="switch model"
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
            {groups.length === 0 && <span className="model-empty">No providers configured</span>}
            {groups.map(([provider, list]) => (
              <div key={provider} className="model-group">
                <div className="model-group-head">{provider}</div>
                {list.map(m => (
                  <button
                    key={provider + '/' + m}
                    className={`model-item ${current?.provider === provider && current?.model === m ? 'active' : ''}`}
                    onClick={() => {
                      setOpen(false)
                      setCurrent({ provider, model: m })
                      void window.api.setAgentModel(agentId, provider, m)
                    }}
                  >
                    {m}
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
