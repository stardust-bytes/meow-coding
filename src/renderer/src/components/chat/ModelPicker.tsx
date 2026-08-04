import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelRef } from '@shared/types'

interface Props {
  agentId: string
}

export default function ModelPicker({ agentId }: Props) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ModelRef | null>(null)
  const [models, setModels] = useState<ModelRef[]>([])
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

  const label = current ? `${current.provider}/${current.model}` : 'no model'

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className="model-trigger"
        title="switch model"
        onClick={() => { refresh(); setOpen(v => !v) }}
      >
        <span className="model-label">{label}</span>
        <span className="model-caret">▾</span>
      </button>
      {open && (
        <div className="model-menu">
          {models.length === 0 && <span className="model-empty">No providers configured</span>}
          {models.map(m => (
            <button
              key={m.provider + '/' + m.model}
              className={`model-item ${current?.provider === m.provider && current?.model === m.model ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                setCurrent(m)
                void window.api.setAgentModel(agentId, m.provider, m.model)
              }}
            >
              {m.provider}/{m.model}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
