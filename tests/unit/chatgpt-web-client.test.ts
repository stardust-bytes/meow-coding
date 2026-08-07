import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/chatgpt-web/browser-worker', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/chatgpt-web/browser-worker')>(
    '../../src/main/chatgpt-web/browser-worker'
  )
  return {
    ...actual,
    createChatGptWebPage: vi.fn(async () => ({}) as never),
    runChatGptWebTurn: vi.fn(async () => 'Sure.\n```tool_call\n{"name": "bash", "input": {"command": "ls"}}\n```')
  }
})

import { createChatGptWebLlmClient } from '../../src/main/chatgpt-web/client'
import { ChatGptWebSessionStore } from '../../src/main/chatgpt-web/session-store'

describe('createChatGptWebLlmClient', () => {
  it('streams text then tool-call then finish parts from the completed turn', async () => {
    const store = new ChatGptWebSessionStore('/tmp/does-not-matter')
    const client = createChatGptWebLlmClient(store)
    const parts = []
    for await (const part of client.stream({ model: 'high', system: 'sys', messages: [], tools: [] })) {
      parts.push(part)
    }
    expect(parts[0]).toEqual({ kind: 'text', text: 'Sure.' })
    expect(parts[1].kind).toBe('tool-call')
    expect(parts[1].toolName).toBe('bash')
    expect(parts[parts.length - 1].kind).toBe('finish')
  })

  it('yields an error part when the model id is not a known effort level', async () => {
    const store = new ChatGptWebSessionStore('/tmp/does-not-matter')
    const client = createChatGptWebLlmClient(store)
    const parts = []
    for await (const part of client.stream({ model: 'not-a-model', system: 'sys', messages: [], tools: [] })) {
      parts.push(part)
    }
    expect(parts).toEqual([{ kind: 'error', error: expect.stringContaining('not-a-model') }])
  })
})
