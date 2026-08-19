import { useState } from 'react'
import type { AgentSettings, MeowSettings, ModelRef, SubagentType } from '@shared/types'

const SUBMODEL_ROLES = ['research', 'general', 'reviewer'] as const

interface Props {
  agents: AgentSettings[]
  providers: MeowSettings['providers']
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
  onChangeAgents: (agents: AgentSettings[]) => void
  onChangeSubagentModels: (models?: Partial<Record<SubagentType, ModelRef>>) => void
}

export default function AgentsTab({ agents, providers, subagentModels, onChangeAgents, onChangeSubagentModels }: Props) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const setRole = (role: SubagentType, ref: ModelRef | undefined) => {
    const next = { ...(subagentModels ?? {}) }
    if (ref) next[role] = ref
    else delete next[role]
    onChangeSubagentModels(Object.keys(next).length > 0 ? next : undefined)
  }

  const updateAgent = (index: number, patch: Partial<AgentSettings>) => {
    onChangeAgents(agents.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const addAgent = () => {
    const name = newName.trim()
    if (!name || agents.some(a => a.name === name)) return
    onChangeAgents([
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
    onChangeAgents(agents.filter((_, i) => i !== index))
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
      <div>
        <p className="settings-hint">
          Models used when the main agent dispatches sub-agents. Leave a role empty to inherit the main agent model.
        </p>
        {SUBMODEL_ROLES.map(role => {
          const ref = subagentModels?.[role]
          const provider = providers.find(p => p.id === ref?.provider)
          return (
            <div className="settings-row agents-row" key={role}>
              <div className="agents-row-head">
                <span className="agent-name">{role}</span>
                <button className="btn small" onClick={() => setRole(role, undefined)}>Use main agent model</button>
              </div>
              <div className="submodel-fields">
                <select
                  className="input"
                  value={ref?.provider ?? ''}
                  onChange={e => setRole(role, e.target.value ? { provider: e.target.value, model: providers.find(p => p.id === e.target.value)?.models[0] ?? '' } : undefined)}
                >
                  <option value="">(inherit main agent model)</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
                <select
                  className="input"
                  value={ref?.model ?? ''}
                  disabled={!ref?.provider}
                  onChange={e => setRole(role, { provider: ref!.provider, model: e.target.value })}
                >
                  {(provider?.models ?? []).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
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
