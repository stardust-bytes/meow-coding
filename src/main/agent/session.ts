import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../json-store'
import type { ChatMessage, ChatTranscriptItem, SessionSummary, TodoItem, ToolCallData } from '../../shared/types'

export const DEFAULT_SESSION_TITLE = 'New session'

export interface StoredSession {
  id: string
  agentId: string
  projectPath: string
  title: string
  items: ChatTranscriptItem[]
  todos: TodoItem[]
  createdAt: number
  updatedAt: number
}

export type { SessionSummary }

type RawSession = Partial<StoredSession> & Record<string, unknown>

function titleFrom(text: string): string {
  const line = text.split('\n').find(l => l.trim().length > 0)
  let t = (line ?? '').trim().replace(/\s+/g, ' ')
  if (t.length > 60) t = t.slice(0, 59) + '…'
  return t || DEFAULT_SESSION_TITLE
}

function titleFromItems(items: ChatTranscriptItem[]): string {
  for (const item of items) {
    if (item.kind === 'message' && item.message.role === 'user' && item.message.text.trim()) {
      return titleFrom(item.message.text)
    }
  }
  return DEFAULT_SESSION_TITLE
}

function normalize(raw: RawSession): StoredSession {
  const items: ChatTranscriptItem[] = Array.isArray(raw.items) ? (raw.items as ChatTranscriptItem[]) : []
  const id = String(raw.id ?? randomUUID())
  return {
    id,
    agentId: String(raw.agentId ?? raw.id ?? ''),
    projectPath: String(raw.projectPath ?? ''),
    title: typeof raw.title === 'string' && raw.title ? raw.title : titleFromItems(items),
    items,
    todos: Array.isArray(raw.todos) ? (raw.todos as TodoItem[]) : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : (raw.updatedAt ?? Date.now()),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export class SessionStore {
  constructor(private store: JsonStore<StoredSession>) {}

  private loadSessions(): StoredSession[] {
    return (this.store.load() as unknown as RawSession[]).map(normalize)
  }

  private saveSessions(sessions: StoredSession[]): void {
    this.store.save(sessions)
  }

  list(agentId: string): SessionSummary[] {
    return this.loadSessions()
      .filter(s => s.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(s => ({
        id: s.id,
        agentId: s.agentId,
        title: s.title,
        messageCount: s.items.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }))
  }

  get(id: string): StoredSession | null {
    return this.loadSessions().find(s => s.id === id) ?? null
  }

  latest(agentId: string): StoredSession | null {
    const all = this.loadSessions()
      .filter(s => s.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return all[0] ?? null
  }

  create(agentId: string, projectPath: string): StoredSession {
    const session: StoredSession = {
      id: randomUUID(),
      agentId,
      projectPath,
      title: DEFAULT_SESSION_TITLE,
      items: [],
      todos: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.saveSessions([...this.loadSessions(), session])
    return session
  }

  transcript(id: string): ChatTranscriptItem[] {
    return this.get(id)?.items ?? []
  }

  todos(id: string): TodoItem[] {
    return this.get(id)?.todos ?? []
  }

  setTodos(id: string, todos: TodoItem[]): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    all[idx].todos = todos
    all[idx].updatedAt = Date.now()
    this.saveSessions(all)
  }

  appendMessage(id: string, message: ChatMessage): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const session = all[idx]
    session.items.push({ kind: 'message', message })
    if (session.title === DEFAULT_SESSION_TITLE && message.role === 'user' && message.text.trim()) {
      session.title = titleFrom(message.text)
    }
    session.updatedAt = Date.now()
    this.saveSessions(all)
  }

  appendTool(id: string, tool: ToolCallData): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const session = all[idx]
    session.items.push({ kind: 'tool', tool })
    session.updatedAt = Date.now()
    this.saveSessions(all)
  }

  setTitle(id: string, title: string): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    all[idx].title = title
    this.saveSessions(all)
  }

  touch(id: string): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    all[idx].updatedAt = Date.now()
    this.saveSessions(all)
  }

  delete(id: string): void {
    this.saveSessions(this.loadSessions().filter(s => s.id !== id))
  }
}
