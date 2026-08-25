import { useState } from 'react'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import Modal from './Modal'

interface Props {
  mcp: Record<string, McpServerConfig>
  status: McpServerStatus[]
  onChange: (mcp: Record<string, McpServerConfig>) => void
  onReconnect: () => Promise<McpServerStatus[]>
}

export default function McpTab({ mcp, status, onChange, onReconnect }: Props) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [testing, setTesting] = useState(false)

  const splitCommand = (value: string): Partial<McpServerConfig> => {
    const parts = value.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return {}
    return parts.length === 1
      ? { command: parts[0] }
      : { command: parts[0], args: parts.slice(1) }
  }

  const updateServer = (name: string, patch: Partial<McpServerConfig>) => {
    const next = { ...mcp }
    next[name] = { ...next[name], ...patch }
    onChange(next)
  }

  const openAdd = () => {
    setNewName('')
    setNewUrl('')
    setNewCommand('')
    setNewArgs('')
    setAdding(true)
  }

  const addServer = () => {
    const name = newName.trim()
    if (!name || mcp[name]) return
    const cfg: McpServerConfig = {}
    if (newUrl.trim()) cfg.url = newUrl.trim()
    Object.assign(cfg, splitCommand(newCommand))
    const args = newArgs.split(' ').map(a => a.trim()).filter(Boolean)
    if (args.length > 0) cfg.args = args
    onChange({ ...mcp, [name]: cfg })
    setAdding(false)
  }

  const removeServer = (name: string) => {
    const next = { ...mcp }
    delete next[name]
    onChange(next)
  }

  const statusFor = (name: string): McpServerStatus | undefined => status.find(s => s.name === name)

  const testConnections = async () => {
    if (testing) return
    setTesting(true)
    try {
      await onReconnect()
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-tab mcp-tab">
      <div className="mcp-head">
        <p className="settings-hint">
          MCP servers. Each server is a stdio command or an HTTP URL. Changes apply after Save.
        </p>
        <div className="mcp-head-actions">
          <button className="btn small" onClick={() => void testConnections()} disabled={testing || Object.keys(mcp).length === 0}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn primary small" onClick={openAdd}>+ Add server</button>
        </div>
      </div>
      {Object.keys(mcp).length > 0 && (
        <div className="mcp-grid">
          {Object.entries(mcp).map(([name, cfg]) => {
            const st = statusFor(name)
            return (
              <div className="mcp-row" key={name}>
                <div className="mcp-row-head">
                  <span className={`mcp-dot ${st?.status ?? 'error'}`} />
                  <span className="mcp-name">{name}</span>
                  {st && (
                    <span className="mcp-tools">
                      {st.status === 'connected' ? `${st.tools.length} tool(s)` : 'failed'}
                    </span>
                  )}
                  <button className="btn small" onClick={() => removeServer(name)}>Remove</button>
                </div>
                {st?.error && <div className="mcp-error">{st.error}</div>}
                <div className="mcp-fields">
                  <input
                    className="input"
                    placeholder="url (e.g. http://localhost:3000/mcp)"
                    value={cfg.url ?? ''}
                    onChange={e => updateServer(name, { url: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="command (e.g. npx @playwright/mcp)"
                    value={cfg.command ?? ''}
                    onChange={e => updateServer(name, splitCommand(e.target.value))}
                  />
                  <input
                    className="input"
                    placeholder="args (space separated)"
                    value={cfg.args?.join(' ') ?? ''}
                    onChange={e => updateServer(name, { args: e.target.value.split(' ').filter(Boolean) })}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {adding && (
        <Modal
          title="Add MCP server"
          onClose={() => setAdding(false)}
          onSubmit={addServer}
          submitLabel="Add"
          submitDisabled={!newName.trim()}
        >
          <div className="settings-field">
            <label className="label" htmlFor="mcp-name">Name</label>
            <input
              id="mcp-name"
              className="input"
              placeholder="server name (e.g. playwright)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label className="label" htmlFor="mcp-url">URL</label>
            <input
              id="mcp-url"
              className="input"
              placeholder="http://localhost:3000/mcp"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label className="label" htmlFor="mcp-command">Command</label>
            <input
              id="mcp-command"
              className="input"
              placeholder="e.g. npx @playwright/mcp"
              value={newCommand}
              onChange={e => setNewCommand(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label className="label" htmlFor="mcp-args">Args</label>
            <input
              id="mcp-args"
              className="input"
              placeholder="space separated (optional)"
              value={newArgs}
              onChange={e => setNewArgs(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
