import type { JsonStore } from '../json-store'
import type { ChatMessage, ToolCallData } from '../../shared/types'
import type { TranscriptItem } from './message'

export interface StoredSession {
  id: string
  projectPath: string
  items: TranscriptItem[]
  updatedAt: number
}

export class SessionStore {
  constructor(private store: JsonStore<StoredSession>) {}

  get(agentId: string): StoredSession | null {
    return this.store.load().find(s => s.id === agentId) ?? null
  }

  ensure(agentId: string, projectPath: string): StoredSession {
    const existing = this.get(agentId)
    if (existing) return existing
    const session: StoredSession = { id: agentId, projectPath, items: [], updatedAt: Date.now() }
    this.save(session)
    return session
  }

  appendMessage(agentId: string, message: ChatMessage): void {
    const session = this.ensure(agentId, this.get(agentId)?.projectPath ?? '')
    session.items.push({ kind: 'message', message })
    this.save(session)
  }

  appendTool(agentId: string, tool: ToolCallData): void {
    const session = this.ensure(agentId, this.get(agentId)?.projectPath ?? '')
    session.items.push({ kind: 'tool', tool })
    this.save(session)
  }

  clear(agentId: string): void {
    const session = this.get(agentId)
    if (!session) return
    session.items = []
    session.updatedAt = Date.now()
    this.save(session)
  }

  private save(session: StoredSession): void {
    const all = this.store.load()
    const next = all.filter(s => s.id !== session.id).concat(session)
    this.store.save(next)
  }
}
