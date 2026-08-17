import { useState } from 'react'
import type { AgentSettings } from '@shared/types'

interface Props {
  agents: AgentSettings[]
  onChange: (agents: AgentSettings[]) => void
}

export default function AgentsTab({ agents, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const updateAgent = (index: number, patch: Partial<AgentSettings>) => {
    onChange(agents.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const addAgent = () => {
    const name = newName.trim()
    if (!name || agents.some(a => a.name === name)) return
    onChange([
      ...agents,
      {
        name,
        systemPrompt: `You are ${name}, a coding agent running inside the Meow Coding desktop app. ` +
          'You help the user build and maintain their codebase. Read files before editing them, ' +
          'run tests after changes, and keep answers concise.'
      }
    ])
    setNewName('')
    setAdding(false)
  }

  const removeAgent = (index: number) => {
    const name = agents[index]?.name
    if (name === 'meow') return
    onChange(agents.filter((_, i) => i !== index))
  }

  return (
    <div className="settings-tab agents-tab">
      <p className="settings-hint">
        Agent system prompts. "meow" is the default native agent and cannot be removed.
      </p>
      {agents.map((a, i) => (
        <div className="settings-row agents-row" key={a.name}>
          <div className="agents-row-head">
            <span className="agent-name">{a.name}</span>
            <button className="btn small" disabled={a.name === 'meow'} onClick={() => removeAgent(i)}>
              Remove
            </button>
          </div>
          <textarea
            className="input agents-prompt"
            value={a.systemPrompt}
            onChange={e => updateAgent(i, { systemPrompt: e.target.value })}
          />
        </div>
      ))}
      {adding ? (
        <div className="agents-add">
          <input
            className="input"
            placeholder="agent name (e.g. reviewer)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button className="btn primary" disabled={!newName.trim()} onClick={addAgent}>Add</button>
          <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>+ Add agent</button>
      )}
    </div>
  )
}
