import { describe, expect, it, beforeEach } from 'vitest'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import type { ChatMessage } from '../../src/shared/types'

function makeStore() {
  const items: StoredSession[] = []
  const json: JsonStore<StoredSession> = {
    load: () => items,
    save: (next: StoredSession[]) => {
      items.splice(0, items.length, ...next)
    }
  }
  return { store: new SessionStore(json), items }
}

function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role, text, createdAt: Date.now() }
}

describe('SessionStore', () => {
  let m: ReturnType<typeof makeStore>

  beforeEach(() => {
    m = makeStore()
  })

  it('returns null for an unknown session', () => {
    expect(m.store.get('a1')).toBeNull()
  })

  it('ensures a session is created and persisted', () => {
    const s = m.store.ensure('a1', '/proj')
    expect(s.id).toBe('a1')
    expect(s.projectPath).toBe('/proj')
    expect(s.items).toEqual([])
    expect(m.store.get('a1')?.id).toBe('a1')
  })

  it('appends messages and tools preserving order', () => {
    const s = m.store.ensure('a1', '/proj')
    const m1 = msg('user', 'hi')
    const m2 = msg('assistant', 'hello')
    m.store.appendMessage('a1', m1)
    m.store.appendMessage('a1', m2)
    m.store.appendTool('a1', { id: 'c1', tool: 'read', input: {}, permission: 'allowed', output: 'x' })
    const loaded = m.store.get('a1')!
    expect(loaded.items.map(i => i.kind)).toEqual(['message', 'message', 'tool'])
    expect(loaded.items[0].kind === 'message' && loaded.items[0].message.text).toBe('hi')
    expect(loaded.items[2].kind === 'tool' && loaded.items[2].tool.output).toBe('x')
  })

  it('does not duplicate the session on repeated ensure', () => {
    m.store.ensure('a1', '/proj')
    m.store.ensure('a1', '/proj')
    expect(m.items).toHaveLength(1)
  })

  it('clears items of a session', () => {
    m.store.ensure('a1', '/proj')
    m.store.appendMessage('a1', msg('user', 'x'))
    m.store.clear('a1')
    expect(m.store.get('a1')?.items).toEqual([])
    expect(m.store.get('a1')).not.toBeNull()
  })
})
