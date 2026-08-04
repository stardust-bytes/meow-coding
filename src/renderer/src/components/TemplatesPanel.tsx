import { useState } from 'react'
import type { Template } from '@shared/types'

interface Props {
  templates: Template[]
  onChange: (templates: Template[]) => void
}

export default function TemplatesPanel({ templates, onChange }: Props) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')

  const add = async () => {
    if (!name || !command) return
    const argsList = args.split(',').map(s => s.trim()).filter(Boolean)
    await window.api.saveTemplate({ id: '', name, command, args: argsList })
    setName('')
    setCommand('')
    setArgs('')
    onChange(await window.api.listTemplates())
  }

  const remove = async (id: string) => {
    await window.api.removeTemplate(id)
    onChange(await window.api.listTemplates())
  }

  return (
    <div className="templates-panel">
      <div className="panel-head">
        <span className="panel-title">Templates</span>
      </div>
      <div className="template-form">
        <input className="input" placeholder="name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="command" value={command} onChange={e => setCommand(e.target.value)} />
        <input className="input" placeholder="args (comma separated)" value={args} onChange={e => setArgs(e.target.value)} />
        <button className="btn" onClick={() => void add()} disabled={!name || !command}>add</button>
      </div>
      <ul className="template-list">
        {templates.map(t => (
          <li key={t.id}>
            <span>{t.name}</span>
            <code>{t.command} {t.args.join(' ')}</code>
            <button className="btn small" onClick={() => void remove(t.id)}>remove</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
