import { useEffect, useState } from 'react'
import type { Command } from '@shared/types'

interface Props {
  projectPath?: string
}

export default function CommandsTab({ projectPath }: Props) {
  const [commands, setCommands] = useState<Command[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const refresh = () => {
    void window.api.listCommands(projectPath ?? '').then(setCommands)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  const add = async () => {
    setError('')
    setStatus('')
    try {
      await window.api.saveCommand({ name, description, template })
      setAdding(false)
      setName('')
      setDescription('')
      setTemplate('')
      setStatus('Command saved.')
      refresh()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = async (cmdName: string) => {
    setError('')
    try {
      await window.api.removeCommand(cmdName)
      refresh()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="settings-tab commands-tab">
      <p className="settings-hint">
        Slash commands expand into a prompt sent to the agent. Template variables: <code>$1</code>…<code>$N</code>,
        <code>$ARGUMENTS</code>, <code>@path</code> file refs, and <code>{'!`cmd`'}</code> shell output.
      </p>
      {commands.map(c => (
        <div className="permission-row" key={c.name}>
          <span className="permission-tool">/{c.name}</span>
          <span className="command-tab-desc">{c.description}</span>
          <button className="btn small" onClick={() => void remove(c.name)}>remove</button>
        </div>
      ))}
      {adding ? (
        <div className="commands-add">
          <input className="input" placeholder="name (e.g. lint)" value={name} onChange={e => setName(e.target.value)} />
          <input className="input" placeholder="description" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea
            className="input commands-template"
            placeholder="template — e.g. Run the linter and fix any errors ($1 = path)"
            value={template}
            onChange={e => setTemplate(e.target.value)}
          />
          <div className="commands-add-actions">
            <button className="btn primary" disabled={!name.trim() || !template.trim()} onClick={() => void add()}>Add</button>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>+ Add command</button>
      )}
      {status && <div className="settings-status">{status}</div>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
