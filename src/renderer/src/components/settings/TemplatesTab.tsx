import { useState } from 'react'
import type { Template } from '@shared/types'

interface Props {
  templates: Template[]
  onChange: (templates: Template[]) => void
}

export default function TemplatesTab({ templates, onChange }: Props) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [error, setError] = useState('')

  const add = async () => {
    if (!name || !command) return
    setError('')
    try {
      await window.api.saveTemplate({ id: '', name, command, args: args.split(',').map(s => s.trim()).filter(Boolean) })
      setName('')
      setCommand('')
      setArgs('')
      onChange(await window.api.listTemplates())
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await window.api.removeTemplate(id)
      onChange(await window.api.listTemplates())
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="settings-tab templates-tab">
      <p className="settings-hint">
        Agent launch templates: pick a name and the command (+ args) used to spawn the agent.
      </p>
      <div className="template-form">
        <input className="input" placeholder="name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="command" value={command} onChange={e => setCommand(e.target.value)} />
        <input className="input" placeholder="args (comma separated)" value={args} onChange={e => setArgs(e.target.value)} />
        <button className="btn" onClick={() => void add()} disabled={!name || !command}>Add</button>
      </div>
      {error && <div className="settings-error">{error}</div>}
      <ul className="template-list">
        {templates.map(t => (
          <li key={t.id}>
            <span>{t.name}</span>
            <code>{t.command} {t.args.join(' ')}</code>
            <button className="btn small" onClick={() => void remove(t.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
