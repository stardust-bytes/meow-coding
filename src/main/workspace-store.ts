import { randomUUID } from 'node:crypto'
import type { AgentConfig, NewAgentInput, Workspace, WorkspaceSummary } from '../shared/types'
import type { JsonStore } from './json-store'

export class WorkspaceStore {
  constructor(private store: JsonStore<Workspace>) {}

  list(): WorkspaceSummary[] {
    return this.store.load().map(w => ({
      projectPath: w.projectPath,
      name: w.name,
      agentCount: w.agents.length
    }))
  }

  get(projectPath: string): Workspace | undefined {
    return this.store.load().find(w => w.projectPath === projectPath)
  }

  add(projectPath: string, name: string): Workspace {
    const all = this.store.load()
    let ws = all.find(w => w.projectPath === projectPath)
    if (!ws) {
      ws = { projectPath, name, agents: [] }
      all.push(ws)
      this.store.save(all)
    }
    return ws
  }

  remove(projectPath: string): void {
    this.store.save(this.store.load().filter(w => w.projectPath !== projectPath))
  }

  addAgent(projectPath: string, input: NewAgentInput): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    const agent: AgentConfig = { id: randomUUID(), ...input }
    ws.agents.push(agent)
    this.store.save(all)
    return ws
  }

  removeAgent(projectPath: string, agentId: string): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    ws.agents = ws.agents.filter(a => a.id !== agentId)
    this.store.save(all)
    return ws
  }

  updateAgent(projectPath: string, agentId: string, patch: Partial<AgentConfig>): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    const agent = ws.agents.find(a => a.id === agentId)
    if (agent) Object.assign(agent, patch)
    this.store.save(all)
    return ws
  }
}
