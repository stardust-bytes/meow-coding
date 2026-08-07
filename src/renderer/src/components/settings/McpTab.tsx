import { useState } from 'react'
import type { McpServerConfig, McpServerStatus } from '@shared/types'

interface Props {
  mcp: Record<string, McpServerConfig>
  status: McpServerStatus[]
  onChange: (mcp: Record<string, McpServerConfig>) => void
}

export default function McpTab({ mcp, status, onChange }: Props) {
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')

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

  const addServer = () => {
    const name = newName.trim()
    if (!name || mcp[name]) return
    const cfg: McpServerConfig = {}
    if (newUrl.trim()) cfg.url = newUrl.trim()
    Object.assign(cfg, splitCommand(newCommand))
    const args = newArgs.split(' ').map(a => a.trim()).filter(Boolean)
    if (args.length > 0) cfg.args = args
    onChange({ ...mcp, [name]: cfg })
    setNewName('')
    setNewUrl('')
    setNewCommand('')
    setNewArgs('')
  }

  const removeServer = (name: string) => {
    const next = { ...mcp }
    delete next[name]
    onChange(next)
  }

  const statusFor = (name: string): McpServerStatus | undefined => status.find(s => s.name === name)

  return (
    <div className="settings-tab mcp-tab">
      <p className="settings-hint">
        MCP servers. Each server is a stdio command or an HTTP URL. Changes apply after Save.
      </p>
      {Object.entries(mcp).map(([name, cfg]) => {
        const st = statusFor(name)
        return (
          <div className="settings-row mcp-row" key={name}>
            <div className="mcp-row-head">
              <span className={`mcp-dot ${st?.status ?? 'error'}`} />
              <span className="mcp-name">{name}</span>
              {st && (
                <span className="mcp-tools">
                  {st.status === 'connected' ? `${st.tools.length} tool(s)` : 'failed'}
                </span>
              )}
              {st?.error && <span className="mcp-error">{st.error}</span>}
              <button className="btn small" onClick={() => removeServer(name)}>remove</button>
            </div>
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
      <div className="mcp-add">
        <input className="input" placeholder="server name" value={newName} onChange={e => setNewName(e.target.value)} />
        <input className="input" placeholder="url (optional)" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
        <input className="input" placeholder="command (optional)" value={newCommand} onChange={e => setNewCommand(e.target.value)} />
        <input className="input" placeholder="args (optional)" value={newArgs} onChange={e => setNewArgs(e.target.value)} />
        <button className="btn primary" disabled={!newName.trim()} onClick={addServer}>Add</button>
      </div>
    </div>
  )
}
