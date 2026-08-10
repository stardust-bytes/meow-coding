import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SessionStore } from '../../src/main/agent/session'
import type { ChatMessage } from '../../src/shared/types'

function makeStore(file: string) {
  return new SessionStore(createJsonStore(file))
}

function userMessage(text: string): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role: 'user', text, createdAt: Date.now() }
}

describe('SessionStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-'))
    file = path.join(dir, 'sessions.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a session with a unique id and a default title', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/proj')
    const b = store.create('agent1', '/proj')
    expect(a.id).toBeTruthy()
    expect(b.id).not.toBe(a.id)
    expect(a.agentId).toBe('agent1')
    expect(a.title).toBe('New session')
    expect(store.get(a.id)?.projectPath).toBe('/proj')
  })

  it('lists sessions for an agent sorted by updatedAt desc', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    const c = store.create('agent2', '/p')
    store.touch(a.id)
    const list = store.list('agent1')
    expect(list.map(s => s.id)).toEqual([a.id, b.id])
    expect(list.every(s => s.agentId === 'agent1')).toBe(true)
    expect(list[0].messageCount).toBe(0)
    // other agent isolated
    expect(store.list('agent2').map(s => s.id)).toEqual([c.id])
  })

  it('auto-titles from the first user message and keeps later titles', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, userMessage('  Fix the\n  login bug now  '))
    expect(store.get(s.id)?.title).toBe('Fix the')
    // later user message does not overwrite
    store.appendMessage(s.id, userMessage('second message'))
    expect(store.get(s.id)?.title).toBe('Fix the')
  })

  it('truncates long titles to 60 chars', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    const long = 'x'.repeat(120)
    store.appendMessage(s.id, userMessage(long))
    expect(store.get(s.id)?.title).toHaveLength(60)
    expect(store.get(s.id)?.title.endsWith('…')).toBe(true)
  })

  it('tracks message count and updates updatedAt on append', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, userMessage('hi'))
    store.appendMessage(s.id, { ...userMessage('yo'), role: 'assistant' })
    expect(store.list('agent1')[0].messageCount).toBe(2)
  })

  it('returns latest session for an agent', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    store.touch(a.id)
    expect(store.latest('agent1')?.id).toBe(a.id)
    store.touch(b.id)
    expect(store.latest('agent1')?.id).toBe(b.id)
  })

  it('touch guarantees the touched session is strictly latest within the same millisecond', () => {
    const realNow = Date.now
    Date.now = () => 1000
    try {
      const store = makeStore(file)
      const a = store.create('agent1', '/p')
      const b = store.create('agent1', '/p')
      store.touch(a.id)
      expect(store.latest('agent1')?.id).toBe(a.id)
      store.touch(b.id)
      expect(store.latest('agent1')?.id).toBe(b.id)
    } finally {
      Date.now = realNow
    }
  })

  it('deletes a session and keeps others', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    store.delete(a.id)
    expect(store.get(a.id)).toBeNull()
    expect(store.list('agent1').map(s => s.id)).toEqual([b.id])
  })

  it('deletes all sessions for an agent and keeps others', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    const c = store.create('agent2', '/p')
    store.deleteForAgent('agent1')
    expect(store.list('agent1')).toEqual([])
    expect(store.list('agent2').map(s => s.id)).toEqual([c.id])
    expect(store.get(a.id)).toBeNull()
    expect(store.get(b.id)).toBeNull()
  })

  it('gets and sets todos per session', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    expect(store.todos(a.id)).toEqual([])
    store.setTodos(a.id, [
      { content: 'fix login', status: 'in_progress' },
      { content: 'run tests', status: 'pending', priority: 'high' }
    ])
    expect(store.todos(a.id)).toHaveLength(2)
    expect(store.todos(a.id)[0]).toEqual({ content: 'fix login', status: 'in_progress' })
    expect(store.todos(a.id)[1]).toEqual({ content: 'run tests', status: 'pending', priority: 'high' })
    const other = store.create('agent1', '/p')
    expect(store.todos(other.id)).toEqual([])
  })

  it('replaces the transcript items for a session', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    store.appendMessage(a.id, userMessage('hi'))
    expect(store.transcript(a.id)).toHaveLength(1)
    store.replaceItems(a.id, [])
    expect(store.transcript(a.id)).toHaveLength(0)
    store.replaceItems(a.id, [
      { kind: 'message', message: userMessage('compacted') }
    ])
    expect(store.transcript(a.id)[0].kind).toBe('message')
  })

  it('migrates legacy entries (id = agentId, no title/createdAt)', () => {
    writeFileSync(file, JSON.stringify([
      { id: 'legacy1', projectPath: '/p', items: [
        { kind: 'message', message: { id: 'm', role: 'user', text: 'Hello world', createdAt: 1 } }
      ], updatedAt: 100 }
    ]))
    const store = makeStore(file)
    const s = store.get('legacy1')
    expect(s).not.toBeNull()
    expect(s?.agentId).toBe('legacy1')
    expect(s?.title).toBe('Hello world')
    expect(s?.createdAt).toBe(100)
    expect(store.list('legacy1')[0].messageCount).toBe(1)
  })
})
