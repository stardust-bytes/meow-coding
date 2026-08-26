import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../json-store'
import type { ChatMessage, ChatTranscriptItem, SessionSummary, TodoItem, ToolCallData, UsageSummary } from '../../shared/types'

export const DEFAULT_SESSION_TITLE = 'New session'

export interface StoredSession {
  id: string
  agentId: string
  projectPath: string
  title: string
  items: ChatTranscriptItem[]
  todos: TodoItem[]
  usage: UsageSummary
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
      return titleFrom(item.message.displayText ?? item.message.text)
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
    usage: raw.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : (raw.updatedAt ?? Date.now()),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export class SessionStore {
  // Guarantees strictly-increasing updatedAt so ordering by it is always
  // deterministic even when mutations happen within the same millisecond.
  private lastUpdatedAt = 0

  constructor(private store: JsonStore<StoredSession>) {}

  // Normalizing on every read walked every transcript item of every session —
  // the agent loop reads the transcript several times per step, so a long
  // session paid that cost repeatedly. Normalize once and keep the result.
  private sessions: StoredSession[] | null = null

  private loadSessions(): StoredSession[] {
    if (!this.sessions) {
      this.sessions = (this.store.load() as unknown as RawSession[]).map(normalize)
    }
    return this.sessions
  }

  private saveSessions(sessions: StoredSession[]): void {
    this.sessions = sessions
    this.store.save(sessions)
  }

  /** Forces any debounced write to disk — call before the app quits. */
  flush(): void {
    this.store.flush?.()
  }

  private nextUpdatedAt(): number {
    const now = Date.now()
    if (now > this.lastUpdatedAt) this.lastUpdatedAt = now
    else this.lastUpdatedAt += 1
    return this.lastUpdatedAt
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

  listAll(): StoredSession[] {
    return this.loadSessions()
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
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      createdAt: Date.now(),
      updatedAt: this.nextUpdatedAt()
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
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  replaceItems(id: string, items: ChatTranscriptItem[]): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    all[idx].items = items
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  // Removes a single user message (e.g. a steered message the user deleted
  // after it was injected into the running turn).
  removeMessage(id: string, messageId: string): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const after = all[idx].items.filter(
      it => !(it.kind === 'message' && it.message.id === messageId)
    )
    if (after.length === all[idx].items.length) return
    all[idx].items = after
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  // Cuts the transcript from the last user message onwards (used by undo) and
  // returns the removed items.
  truncateFromLastUser(id: string): ChatTranscriptItem[] {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return []
    const items = all[idx].items
    let cut = -1
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'message' && item.message.role === 'user') {
        cut = i
        break
      }
    }
    if (cut < 0) return []
    const removed = items.splice(cut)
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
    return removed
  }

  appendMessage(id: string, message: ChatMessage): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const session = all[idx]
    session.items.push({ kind: 'message', message })
    if (session.title === DEFAULT_SESSION_TITLE && message.role === 'user' && message.text.trim()) {
      session.title = titleFrom(message.displayText ?? message.text)
    }
    session.updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  appendTool(id: string, tool: ToolCallData): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const session = all[idx]
    session.items.push({ kind: 'tool', tool })
    session.updatedAt = this.nextUpdatedAt()
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
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  getUsage(id: string): UsageSummary {
    return this.get(id)?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  }

  addUsage(id: string, usage: UsageSummary): void {
    const all = this.loadSessions()
    const idx = all.findIndex(s => s.id === id)
    if (idx < 0) return
    const s = all[idx].usage
    all[idx].usage = {
      input: s.input + usage.input,
      output: s.output + usage.output,
      cacheRead: s.cacheRead + usage.cacheRead,
      cacheWrite: s.cacheWrite + usage.cacheWrite,
      cost: s.cost + usage.cost
    }
    all[idx].updatedAt = this.nextUpdatedAt()
    this.saveSessions(all)
  }

  delete(id: string): void {
    this.saveSessions(this.loadSessions().filter(s => s.id !== id))
  }

  deleteForAgent(agentId: string): void {
    this.saveSessions(this.loadSessions().filter(s => s.agentId !== agentId))
  }
}
