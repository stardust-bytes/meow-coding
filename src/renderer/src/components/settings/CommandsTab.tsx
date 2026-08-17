import { useEffect, useState } from 'react'
import type { Command } from '@shared/types'
import Modal from './Modal'

interface Props {
  projectPath?: string
}

type ModalState = { mode: 'add' } | { mode: 'edit'; command: Command } | null

export default function CommandsTab({ projectPath }: Props) {
  const [commands, setCommands] = useState<Command[]>([])
  const [modal, setModal] = useState<ModalState>(null)
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

  const openAdd = () => {
    setName('')
    setDescription('')
    setTemplate('')
    setModal({ mode: 'add' })
  }

  const openEdit = (command: Command) => {
    setName(command.name)
    setDescription(command.description)
    setTemplate(command.template)
    setModal({ mode: 'edit', command })
  }

  const save = async () => {
    if (!modal) return
    setError('')
    setStatus('')
    try {
      await window.api.saveCommand({ name, description, template })
      setModal(null)
      setStatus(`Command "${name}" saved.`)
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
          <button className="btn small" onClick={() => openEdit(c)}>Edit</button>
          <button className="btn small" onClick={() => void remove(c.name)}>Remove</button>
        </div>
      ))}
      <button className="btn" onClick={openAdd}>+ Add command</button>
      {status && <div className="settings-status">{status}</div>}
      {error && <div className="settings-error">{error}</div>}

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? `Edit /${modal.command.name}` : 'Add command'}
          onClose={() => setModal(null)}
          onSubmit={() => void save()}
          submitLabel={modal.mode === 'edit' ? 'Save' : 'Add'}
          submitDisabled={!name.trim() || !template.trim()}
        >
          <input
            className="input"
            placeholder="name (e.g. lint)"
            value={name}
            disabled={modal.mode === 'edit'}
            onChange={e => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <textarea
            className="input commands-template"
            placeholder="template — e.g. Run the linter and fix any errors ($1 = path)"
            value={template}
            onChange={e => setTemplate(e.target.value)}
          />
        </Modal>
      )}
    </div>
  )
}
