import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SessionStore } from '../../src/main/agent/session'
import type { ChatMessage } from '../../src/shared/types'

function makeStore(file: string) {
  return new SessionStore(createJsonStore(file))
}

function userMessage(text: string, id?: string): ChatMessage {
  return { id: id ?? Math.random().toString(36).slice(2), role: 'user', text, createdAt: Date.now() }
}

describe('SessionStore.removeMessage', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-rm-'))
    file = path.join(dir, 'sessions.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('drops the matching user message and keeps the rest', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const keep = userMessage('keep me')
    const victim = userMessage('remove me')
    store.appendMessage(a.id, keep)
    store.appendMessage(a.id, victim)
    store.appendMessage(a.id, userMessage('also keep'))

    store.removeMessage(a.id, victim.id)

    const texts = store.transcript(a.id)
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message.text)
    expect(texts).toEqual(['keep me', 'also keep'])
  })

  it('is a no-op for an unknown message id', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const keep = userMessage('keep me')
    store.appendMessage(a.id, keep)

    store.removeMessage(a.id, 'nope')

    expect(store.transcript(a.id)).toHaveLength(1)
  })

  it('is a no-op for an unknown session', () => {
    const store = makeStore(file)
    expect(() => store.removeMessage('missing', 'x')).not.toThrow()
  })
})
