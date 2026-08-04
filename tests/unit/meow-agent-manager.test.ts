import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MeowAgentManager } from '../../src/main/meow-agent-manager'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { AgentConfig, ChatEvent, PromptResponse } from '../../src/shared/types'

const MEOW_AGENT: AgentConfig = {
  id: 'a1', name: 'meow', templateId: 'meow', cwd: '/proj', kind: 'native'
}
const PTY_AGENT: AgentConfig = {
  id: 'a2', name: 'opencode', templateId: 'opencode', cwd: '/proj'
}

interface StubLlmOptions {
  hangUntilAbort?: boolean
  partsQueue?: LlmStreamPart[][]
}

function makeManager(opts: StubLlmOptions = {}) {
  const sessions: StoredSession[] = []
  const json: JsonStore<StoredSession> = {
    load: () => sessions,
    save: (next) => sessions.splice(0, sessions.length, ...next)
  }
  const store = new SessionStore(json)
  const events: ChatEvent[] = []
  let llmClient: LlmClient
  const llm = (): LlmClient => llmClient
  const createLlm = vi.fn((): LlmClient => {
    llmClient = {
      async *stream(request: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
        if (opts.hangUntilAbort) {
          await new Promise<void>(resolve => {
            if (request.signal?.aborted) return resolve()
            request.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          yield { kind: 'finish' }
          return
        }
        const parts = (opts.partsQueue ?? []).shift() ??
          [{ kind: 'text', text: 'hi' }, { kind: 'finish' }]
        for (const p of parts) yield p
      }
    }
    return llmClient
  })
  const manager = new MeowAgentManager({
    configPath: '/nonexistent/meow.json',
    store,
    tools: createDefaultTools(),
    createLlm,
    env: { ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv
  })
  manager.setOnEvent(e => events.push(e))
  manager.init([MEOW_AGENT, PTY_AGENT])
  return { manager, store, events, createLlm }
}

describe('MeowAgentManager', () => {
  it('registers native agents and ignores pty agents', () => {
    const { manager } = makeManager()
    expect(manager.isNative('a1')).toBe(true)
    expect(manager.isNative('a2')).toBe(false)
  })

  it('send appends the user message and emits events', async () => {
    const { manager, store, events } = makeManager()
    await manager.send('a1', 'hello')
    const messages = manager.listMessages('a1')
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].text).toBe('hello')
    expect(events.some(e => e.type === 'text-delta')).toBe(true)
    expect(events.some(e => e.type === 'done' && e.reason === 'complete')).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('emits an error when no api key is configured', async () => {
    const { manager, events } = makeManager()
    manager.newSession('a1')
    // rebuild manager without key
    const sessions: StoredSession[] = []
    const store = new SessionStore({ load: () => sessions, save: (n) => sessions.splice(0, sessions.length, ...n) })
    const evts: ChatEvent[] = []
    const m2 = new MeowAgentManager({
      configPath: '/nonexistent/meow.json',
      store,
      tools: createDefaultTools(),
      createLlm: () => ({ async *stream() { yield { kind: 'finish' } } }),
      env: {}
    })
    m2.setOnEvent(e => evts.push(e))
    m2.init([MEOW_AGENT])
    await m2.send('a1', 'hi')
    expect(evts.some(e => e.type === 'error')).toBe(true)
    expect((evts.find(e => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>).message).toContain('[meow]')
  })

  it('stop aborts a running turn and emits done stopped', async () => {
    const { manager, events } = makeManager({ hangUntilAbort: true })
    const sendPromise = manager.send('a1', 'go')
    await new Promise(r => setTimeout(r, 20))
    expect(manager.isRunning('a1')).toBe(true)
    manager.stop('a1')
    await sendPromise
    expect(events.some(e => e.type === 'done' && e.reason === 'stopped')).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('respondPrompt allow lets a permission-ask tool run', async () => {
    const { manager: m2, events: evts } = makeManager({
      partsQueue: [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'x.ts' } },
          { kind: 'finish' }
        ],
        [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
      ]
    })
    m2.newSession('a1')
    const sendPromise = m2.send('a1', 'read x.ts')
    // wait for prompt-request, then allow
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        const p = evts.find(e => e.type === 'prompt-request') as Extract<ChatEvent, { type: 'prompt-request' }> | undefined
        if (p) {
          clearInterval(t)
          m2.respondPrompt('a1', p.promptId, { allow: true } satisfies PromptResponse)
          resolve()
        }
      }, 5)
    })
    await sendPromise
    const result = evts.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result).toBeDefined()
    expect(result.call.permission).toBe('allowed')
    expect(result.call.error).toMatch(/not found/)
  })

  it('newSession clears persisted messages', async () => {
    const { manager, store } = makeManager()
    await manager.send('a1', 'x')
    manager.newSession('a1')
    expect(manager.listMessages('a1')).toEqual([])
    expect(store.get('a1')?.items).toEqual([])
  })
})
