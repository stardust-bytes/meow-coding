import { useState } from 'react'
import type { NewAgentInput, Template } from '@shared/types'

interface Props {
  projectPath: string
  templates: Template[]
  onAdd: (input: NewAgentInput) => void
  onClose: () => void
}

export default function AddAgentDialog({ projectPath, templates, onAdd, onClose }: Props) {
  const [name, setName] = useState(templates[0]?.name ?? 'agent')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [cwd, setCwd] = useState(projectPath)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Add agent</h3>
        <label className="label">Template</label>
        <select className="input" value={templateId}
          onChange={e => {
            setTemplateId(e.target.value)
            const t = templates.find(x => x.id === e.target.value)
            if (t) setName(t.name)
          }}>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
        <label className="label">Working directory</label>
        <input className="input" value={cwd} onChange={e => setCwd(e.target.value)} />
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!name || !templateId || !cwd}
            onClick={() => onAdd({ name, templateId, cwd })}>
            add
          </button>
        </div>
      </div>
    </div>
  )
}
