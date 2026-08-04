import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MeowAgentManager } from '../../src/main/meow-agent-manager'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { SnapshotStore } from '../../src/main/agent/snapshot'
import type { SnapshotEntry } from '../../src/main/agent/snapshot'
import { SavedPermissions } from '../../src/main/agent/saved-permissions'
import type { SavedPermission } from '../../src/main/agent/saved-permissions'
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

async function makeManager(opts: StubLlmOptions & { configPath?: string } = {}) {
  const sessions: StoredSession[] = []
  const json: JsonStore<StoredSession> = {
    load: () => sessions,
    save: (next) => sessions.splice(0, sessions.length, ...next)
  }
  const store = new SessionStore(json)
  const snapshotEntries: SnapshotEntry[] = []
  const snapshots = new SnapshotStore({
    load: () => snapshotEntries,
    save: (next) => snapshotEntries.splice(0, snapshotEntries.length, ...next)
  })
  const permEntries: SavedPermission[] = []
  const savedPermissions = new SavedPermissions({
    load: () => permEntries,
    save: (next) => permEntries.splice(0, permEntries.length, ...next)
  })
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
    configPath: opts.configPath ?? '/nonexistent/meow.json',
    store,
    snapshots,
    savedPermissions,
    tools: createDefaultTools(),
    createLlm,
    env: { ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv
  })
  manager.setOnEvent(e => events.push(e))
  await manager.init([MEOW_AGENT, PTY_AGENT])
  return { manager, store, events, createLlm, savedPermissions }
}

describe('MeowAgentManager', () => {
  it('registers native agents and ignores pty agents', async () => {
    const { manager } = await makeManager()
    expect(manager.isNative('a1')).toBe(true)
    expect(manager.isNative('a2')).toBe(false)
  })

  it('send appends the user message and emits events', async () => {
    const { manager, store, events } = await makeManager()
    await manager.send('a1', 'hello')
    const messages = manager.listMessages('a1')
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].text).toBe('hello')
    expect(events.some(e => e.type === 'text-delta')).toBe(true)
    expect(events.some(e => e.type === 'done' && e.reason === 'complete')).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('listTranscript returns the full transcript including tool steps', async () => {
    const { manager } = await makeManager({
      partsQueue: [
        [
          { kind: 'text', text: 'reading...' },
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'x' } },
          { kind: 'finish' }
        ],
        [{ kind: 'text', text: 'done' }, { kind: 'finish' }]
      ]
    })
    manager.newSession('a1')
    await manager.send('a1', 'read x')
    const transcript = manager.listTranscript('a1')
    const kinds = transcript.map(t => t.kind)
    expect(kinds).toEqual(['message', 'message', 'tool', 'message'])
    const toolItem = transcript.find(t => t.kind === 'tool')
    expect(toolItem && toolItem.kind === 'tool' ? toolItem.tool.tool : '').toBe('read')
  })

  it('emits an error when no api key is configured', async () => {
    const { manager, events } = await makeManager()
    manager.newSession('a1')
    // rebuild manager without key
    const sessions: StoredSession[] = []
    const store = new SessionStore({ load: () => sessions, save: (n) => sessions.splice(0, sessions.length, ...n) })
    const snapEntries: SnapshotEntry[] = []
    const snapshots = new SnapshotStore({ load: () => snapEntries, save: (n) => snapEntries.splice(0, snapEntries.length, ...n) })
    const permEntries: SavedPermission[] = []
    const savedPermissions = new SavedPermissions({ load: () => permEntries, save: (n) => permEntries.splice(0, permEntries.length, ...n) })
    const evts: ChatEvent[] = []
    const m2 = new MeowAgentManager({
      configPath: '/nonexistent/meow.json',
      store,
      snapshots,
      savedPermissions,
      tools: createDefaultTools(),
      createLlm: () => ({ async *stream() { yield { kind: 'finish' } } }),
      env: {}
    })
    m2.setOnEvent(e => evts.push(e))
    await m2.init([MEOW_AGENT])
    await m2.send('a1', 'hi')
    expect(evts.some(e => e.type === 'error')).toBe(true)
    expect((evts.find(e => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>).message).toContain('[meow]')
  })

  it('stop aborts a running turn and emits done stopped', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const sendPromise = manager.send('a1', 'go')
    await new Promise(r => setTimeout(r, 20))
    expect(manager.isRunning('a1')).toBe(true)
    manager.stop('a1')
    await sendPromise
    expect(events.some(e => e.type === 'done' && e.reason === 'stopped')).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('respondPrompt allow lets a permission-ask tool run', async () => {
    const { manager: m2, events: evts } = await makeManager({
      partsQueue: [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'websearch', toolInput: { query: 'meow' } },
          { kind: 'finish' }
        ],
        [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
      ]
    })
    m2.newSession('a1')
    const sendPromise = m2.send('a1', 'search web')
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
    expect(result.call.error).toMatch(/TAVILY_API_KEY/)
  })

  it('newSession clears persisted messages', async () => {
    const { manager, store } = await makeManager()
    await manager.send('a1', 'x')
    manager.newSession('a1')
    expect(manager.listMessages('a1')).toEqual([])
    expect(store.get('a1')?.items).toEqual([])
  })

  it('getSettings returns the default providers', async () => {
    const { manager } = await makeManager()
    const s = manager.getSettings()
    expect(s.defaultProvider).toBe('anthropic')
    expect(s.providers.map(p => p.id)).toEqual(expect.arrayContaining(['anthropic', 'openai']))
  })

  it('saveSettings writes config and reloads with the new provider/key', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-'))
    try {
      const configPath = path.join(dir, 'meow.json')
      const { manager, createLlm } = await makeManager({ configPath })
      createLlm.mockClear()
      const saved = await manager.saveSettings({
        defaultProvider: 'deepseek',
        providers: [
          { id: 'deepseek', apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
        ]
      })
      expect(saved.defaultProvider).toBe('deepseek')
      const lastCall = createLlm.mock.calls[createLlm.mock.calls.length - 1]
      expect(lastCall[0]).toBe('deepseek')
      expect(lastCall[1]).toBe('sk-ds')
      expect(lastCall[2]).toBe('https://api.deepseek.com/v1')
      expect(manager.isNative('a1')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('plan mode denies a write tool call', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [
        [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'write', toolInput: { file_path: 'x', content: 'y' } }, { kind: 'finish' }],
        [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
      ]
    })
    manager.setMode('a1', 'plan')
    await manager.send('a1', 'write x')
    const result = events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.call.permission).toBe('denied')
    expect(result.call.error).toBe('permission denied')
  })

  it('always allow saves the permission for the next turn', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [
        [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'echo hi' } }, { kind: 'finish' }],
        [{ kind: 'text', text: 'done' }, { kind: 'finish' }],
        [{ kind: 'tool-call', toolCallId: 'tc2', toolName: 'bash', toolInput: { command: 'echo hi' } }, { kind: 'finish' }],
        [{ kind: 'text', text: 'done2' }, { kind: 'finish' }]
      ]
    })
    manager.newSession('a1')

    const first = manager.send('a1', 'run bash')
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        const p = events.find(e => e.type === 'prompt-request') as Extract<ChatEvent, { type: 'prompt-request' }> | undefined
        if (p) {
          clearInterval(t)
          manager.respondPrompt('a1', p.promptId, { allow: true, always: true })
          resolve()
        }
      }, 5)
    })
    await first
    expect(events.some(e => e.type === 'prompt-request')).toBe(true)

    events.length = 0
    await manager.send('a1', 'run bash again')
    expect(events.some(e => e.type === 'prompt-request')).toBe(false)
    const result = events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.call.permission).toBe('allowed')
  })
})
