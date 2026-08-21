import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MeowAgentManager } from '../../src/main/meow-agent-manager'
import type { MeowAgentManagerDeps } from '../../src/main/meow-agent-manager'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import { ModelsCatalog } from '../../src/main/models-catalog'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { SnapshotStore } from '../../src/main/agent/snapshot'
import type { SnapshotEntry } from '../../src/main/agent/snapshot'
import { TruncationStore } from '../../src/main/agent/truncation'
import { CommandStore } from '../../src/main/agent/commands'
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

async function makeManager(opts: StubLlmOptions & {
  configPath?: string
  catalog?: ModelsCatalog
} = {}) {
  const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-cfg-'))
  const defaultCfg = path.join(cfgDir, 'meow.json')
  if (!opts.configPath) {
    writeFileSync(defaultCfg, JSON.stringify({
      provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
      model: 'test'
    }))
  }
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
  const llmCalls: string[][] = []
  const llmSystems: string[] = []
  const llmVariants: Array<Record<string, unknown> | undefined> = []
  const llmModels: string[] = []
  let llmClient: LlmClient
  const createLlm = vi.fn((): LlmClient => {
    llmClient = {
      async *stream(request: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
        llmCalls.push((request.tools ?? []).map(t => t.name))
        llmSystems.push(request.system)
        llmVariants.push(request.variantOptions)
        llmModels.push(request.model)
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
    configPath: opts.configPath ?? defaultCfg,
    store,
    snapshots,
    savedPermissions,
    tools: createDefaultTools(),
    createLlm,
    catalog: opts.catalog,
    truncation: new TruncationStore(path.join(cfgDir, 'truncation')),
    commands: new CommandStore(path.join(cfgDir, 'commands.json')),
    prices: { 'test/test-model': { input: 1, output: 2 } },
    env: { ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv
  })
  manager.setOnEvent(e => events.push(e))
  await manager.init([{ ...MEOW_AGENT }, { ...PTY_AGENT }])
  return { manager, store, events, createLlm, savedPermissions, llmCalls, llmSystems, llmVariants, llmModels }
}

describe('MeowAgentManager', () => {
  it('registers native agents and ignores pty agents', async () => {
    const { manager } = await makeManager()
    expect(manager.isNative('a1')).toBe(true)
    expect(manager.isNative('a2')).toBe(false)
  })

  it('tracks and restores background state per agent', async () => {
    const { manager } = await makeManager()
    expect(manager.isBackground('a1')).toBe(false)
    manager.setBackground('a1', true)
    expect(manager.isBackground('a1')).toBe(true)
    manager.setBackground('a1', false)
    expect(manager.isBackground('a1')).toBe(false)
  })

  it('seeds background state from the stored agent config on register', async () => {
    const { manager } = await makeManager()
    manager.addAgent({ ...MEOW_AGENT, id: 'a9', background: true })
    expect(manager.isBackground('a9')).toBe(true)
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

  it('emits turn-started when a turn begins, including queued drains', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const first = manager.send('a1', 'first')
    await new Promise(r => setTimeout(r, 20))
    expect(events.some(e => e.type === 'turn-started' && e.agentId === 'a1')).toBe(true)
    // Queue a second message; when the first is stopped the queue drains into a
    // new turn that also signals turn-started so the UI can restore Stop.
    void manager.send('a1', 'second')
    manager.stop('a1')
    await new Promise(r => setTimeout(r, 30))
    const started = events.filter(e => e.type === 'turn-started')
    expect(started.length).toBeGreaterThanOrEqual(2)
    expect(manager.isRunning('a1')).toBe(true)
    manager.stop('a1')
    await first
  })

  it('send() stores images on the user message', async () => {
    const { manager } = await makeManager()
    const img = { id: 'i1', name: 'a.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 }
    await manager.send('a1', 'look at this', [img])
    const messages = manager.listMessages('a1')
    expect(messages[0].text).toBe('look at this')
    expect(messages[0].images).toEqual([img])
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
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-err-'))
    const m2 = new MeowAgentManager({
      configPath: '/nonexistent/meow.json',
      store,
      snapshots,
      savedPermissions,
      tools: createDefaultTools(),
      createLlm: () => ({ async *stream() { yield { kind: 'finish' } } }),
      truncation: new TruncationStore(path.join(tmpDir, 'truncation2')),
      env: {}
    })
    m2.setOnEvent(e => evts.push(e))
    await m2.init([{ ...MEOW_AGENT }])
    await m2.send('a1', 'hi')
    rmSync(tmpDir, { recursive: true, force: true })
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

  it('queues messages sent while a turn is running and drains them serially', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'websearch', toolInput: { query: 'q' } },
          { kind: 'finish' }
        ],
        [{ kind: 'text', text: 'r1' }, { kind: 'finish' }],
        [{ kind: 'text', text: 'r2' }, { kind: 'finish' }]
      ]
    })
    manager.newSession('a1')
    const sendPromise = manager.send('a1', 'first')
    // Wait for the first turn to block on a permission prompt.
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        if (events.some(e => e.type === 'prompt-request')) {
          clearInterval(t)
          resolve()
        }
      }, 5)
    })
    expect(manager.isRunning('a1')).toBe(true)
    await manager.send('a1', 'second')
    await manager.send('a1', 'third')
    const q = manager.listQueued('a1')
    expect(q.map(m => m.text)).toEqual(['second', 'third'])
    expect(events.some(e => e.type === 'queue-updated' && e.queue.length === 2)).toBe(true)
    // Allow the permission prompt → first turn completes → queue drains serially.
    await manager.respondPrompt('a1', events.find(e => e.type === 'prompt-request')!.promptId, { allow: true })
    await sendPromise
    expect(manager.listQueued('a1')).toEqual([])
    const msgs = manager.listMessages('a1').filter(m => m.role === 'user').map(m => m.text)
    expect(msgs).toContain('second')
    expect(msgs).toContain('third')
  })

  it('removeQueued and editQueued update the queue', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const sendPromise = manager.send('a1', 'first')
    await new Promise(r => setTimeout(r, 20))
    await manager.send('a1', 'second')
    const q = manager.listQueued('a1')
    const second = q[0]
    manager.editQueued('a1', second.id, 'second-edited')
    expect(manager.listQueued('a1')[0].text).toBe('second-edited')
    manager.removeQueued('a1', second.id)
    expect(manager.listQueued('a1')).toEqual([])
    expect(events.some(e => e.type === 'queue-updated')).toBe(true)
    // Clear the queue so stop doesn't drain into a hanging turn.
    manager.stop('a1')
    await sendPromise
  })

  it('rejects queuing more than 5 messages', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const sendPromise = manager.send('a1', 'first')
    await new Promise(r => setTimeout(r, 20))
    for (let i = 0; i < 6; i++) await manager.send('a1', `msg ${i}`)
    expect(manager.listQueued('a1')).toHaveLength(5)
    expect(events.some(e => e.type === 'error')).toBe(true)
    // Clear the queue so stop doesn't drain into a hanging turn.
    for (const m of manager.listQueued('a1')) manager.removeQueued('a1', m.id)
    manager.stop('a1')
    await sendPromise
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

  it('newSession creates a new empty session and keeps history', async () => {
    const { manager, store } = await makeManager()
    await manager.send('a1', 'x')
    expect(manager.listSessions('a1')).toHaveLength(1)
    const oldId = manager.listSessions('a1')[0].id
    manager.newSession('a1')
    expect(manager.listMessages('a1')).toEqual([])
    expect(manager.listSessions('a1')).toHaveLength(2)
    expect(store.get(oldId)?.items.length).toBeGreaterThan(0)
  })

  it('removeAgent deletes the agent sessions', async () => {
    const { manager, store } = await makeManager()
    await manager.send('a1', 'hello')
    expect(manager.listSessions('a1')).toHaveLength(1)
    manager.removeAgent('a1')
    expect(manager.isNative('a1')).toBe(false)
    expect(manager.listSessions('a1')).toHaveLength(0)
    // store no longer holds the orphaned session
    expect(store.list('a1')).toHaveLength(0)
  })

  it('undo removes the last turn transcript and redo restores it', async () => {
    const { manager, store } = await makeManager()
    // Seed a snapshot turn so undo has history to pop.
    const file = path.join(tmpdir(), 'meow-undo-f.txt')
    writeFileSync(file, 'original')
    const snapshots = (manager as unknown as { deps: { snapshots: import('../../src/main/agent/snapshot').SnapshotStore } }).deps.snapshots
    snapshots.beginTurn('a1')
    snapshots.snapshot('a1', file, 'original')
    snapshots.commitTurn('a1')

    await manager.send('a1', 'first')
    expect(manager.listMessages('a1').map(m => m.role)).toEqual(['user', 'assistant'])
    expect(manager.undo('a1')).toBe(true)
    expect(manager.listMessages('a1')).toEqual([])
    expect(readFileSync(file, 'utf-8')).toBe('original')
    expect(manager.redo('a1')).toBe(true)
    expect(manager.listMessages('a1').map(m => m.role)).toEqual(['user', 'assistant'])
    // redo re-inserts the turn, so another undo works
    expect(manager.redo('a1')).toBe(false)
    expect(manager.undo('a1')).toBe(true)
    rmSync(file, { force: true })
  })

  it('undo returns false when there is no snapshot history', async () => {
    const { manager } = await makeManager()
    manager.newSession('a1')
    expect(manager.undo('a1')).toBe(false)
  })

  it('renameSession updates the title', async () => {
    const { manager } = await makeManager()
    const s = manager.listSessions('a1')[0] ?? manager.newSession('a1')
    const renamed = manager.renameSession('a1', s.id, 'My custom title')
    expect(renamed?.title).toBe('My custom title')
    expect(manager.listSessions('a1')[0].title).toBe('My custom title')
  })

  it('getSettings has no built-in provider presets', async () => {
    const { manager } = await makeManager()
    const s = manager.getSettings()
    expect(s.providers.map(p => p.id)).not.toContain('anthropic')
    expect(s.providers.map(p => p.id)).not.toContain('openai')
    expect(s.providers[0].models).toEqual(['test-model'])
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
          { id: 'deepseek', apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] }
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
    expect(result.call.error).toMatch(/not permitted in the current mode/)
  })

  it('setMode rebuilds the runner system prompt with a plan note', async () => {
    const { manager, llmSystems } = await makeManager({
      partsQueue: [[{ kind: 'text', text: 'a' }, { kind: 'finish' }], [{ kind: 'text', text: 'b' }, { kind: 'finish' }]]
    })
    await manager.send('a1', 'first')
    expect(llmSystems[0]).not.toMatch(/PLAN MODE/)
    manager.setMode('a1', 'plan')
    await manager.send('a1', 'second')
    expect(llmSystems[1]).toMatch(/PLAN MODE/)
  })

  it('setMode while a turn is running applies the new mode to the next turn', async () => {
    const { manager, llmSystems } = await makeManager({
      partsQueue: [
        [{ kind: 'text', text: 'a' }, { kind: 'finish' }],
        [{ kind: 'text', text: 'b' }, { kind: 'finish' }]
      ]
    })
    // send() starts the turn synchronously (running set before any await), so
    // setMode below runs mid-turn — the common "switch mode during chat" case.
    const first = manager.send('a1', 'first')
    expect(manager.isRunning('a1')).toBe(true)
    manager.setMode('a1', 'plan')
    await first
    expect(llmSystems[0]).not.toMatch(/PLAN MODE/)
    await manager.send('a1', 'second')
    expect(llmSystems[1]).toMatch(/PLAN MODE/)
  })

  it('setVariant passes a clamped variant descriptor to the llm stream', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-var-stream-'))
    try {
      const cfgPath = path.join(dir, 'meow.json')
      writeFileSync(cfgPath, JSON.stringify({
        provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
        model: 'test'
      }))
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          test: {
            name: 'Test',
            npm: '@ai-sdk/openai-compatible',
            models: {
              'test-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] }
            }
          }
        }) }) as unknown as Response)
      const { manager, llmVariants } = await makeManager({ configPath: cfgPath, catalog })
      await manager.send('a1', 'first')
      expect(llmVariants[0]).toBeUndefined()
      manager.setVariant('a1', 'high')
      await manager.send('a1', 'second')
      expect(llmVariants[1]).toEqual({ openaiCompatible: { reasoningEffort: 'high' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setVariant clamps an out-of-allow value to undefined', async () => {
    const { manager } = await makeManager()
    await manager.send('a1', 'first')
    manager.setVariant('a1', 'xhigh')
    const stored = manager.getVariant('a1')
    expect(stored).toBeUndefined()
  })

  it('setVariant keeps an allow-listed value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-var-'))
    try {
      const cfgPath = path.join(dir, 'meow.json')
      writeFileSync(cfgPath, JSON.stringify({
        provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
        model: 'test'
      }))
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          test: {
            name: 'Test',
            npm: '@ai-sdk/openai-compatible',
            models: {
              'test-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }] }
            }
          }
        }) }) as unknown as Response)
      const { manager } = await makeManager({ configPath: cfgPath, catalog })
      await manager.send('a1', 'first')
      manager.setVariant('a1', 'low')
      expect(manager.getVariant('a1')).toBe('low')
      manager.setVariant('a1', 'max')
      expect(manager.getVariant('a1')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('connectProvider syncs models and baseUrl from the catalog', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-conn-'))
    try {
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', models: { 'deepseek-chat': {}, 'deepseek-reasoner': {} } }
        }) }) as unknown as Response)
      const { manager } = await makeManager({ configPath: path.join(dir, 'meow.json'), catalog })
      const settings = await manager.connectProvider('deepseek', 'sk-ds')
      expect(settings.providers).toHaveLength(1)
      expect(settings.providers[0]).toMatchObject({
        id: 'deepseek', apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com',
        models: ['deepseek-chat', 'deepseek-reasoner']
      })
      expect(settings.defaultProvider).toBe('deepseek')
      const catalogList = await manager.listProviderCatalog()
      expect(catalogList.find(c => c.id === 'deepseek')).toMatchObject({ id: 'deepseek', modelCount: 2 })
      expect(catalogList.find(c => c.id === 'openai')).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('disconnectProvider removes a provider and fixes the default', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-conn-'))
    try {
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', models: { a: {} } },
          openai: { name: 'OpenAI', api: 'https://api.openai.com/v1', models: { b: {} } }
        }) }) as unknown as Response)
      const { manager } = await makeManager({ configPath: path.join(dir, 'meow.json'), catalog })
      await manager.connectProvider('deepseek', 'sk-ds')
      await manager.connectProvider('openai', 'sk-oa')
      const settings = await manager.disconnectProvider('deepseek')
      expect(settings.providers.map(p => p.id)).toEqual(['openai'])
      expect(settings.defaultProvider).toBe('openai')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes multiple allow tool calls in a turn in parallel', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a' } },
          { kind: 'tool-call', toolCallId: 'tc2', toolName: 'read', toolInput: { file_path: 'b' } },
          { kind: 'finish' }
        ],
        [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
      ]
    })
    await manager.send('a1', 'read two files')
    const results = events.filter(e => e.type === 'tool-result')
    expect(results).toHaveLength(2)
    expect(results.map(r => r.call.tool)).toEqual(['read', 'read'])
  })

  it('plan mode hides write tools from the model', async () => {
    const { manager, llmCalls } = await makeManager({
      partsQueue: [[{ kind: 'text', text: 'hi' }, { kind: 'finish' }]]
    })
    manager.setMode('a1', 'plan')
    await manager.send('a1', 'hi')
    const names = llmCalls[0] ?? []
    expect(names).toContain('read')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('apply-patch')
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

  it('plan mode still prompts for bash even with a saved always-allow', async () => {
    const { manager, events, savedPermissions } = await makeManager({
      partsQueue: [
        [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'echo hi' } }, { kind: 'finish' }]
      ]
    })
    savedPermissions.save('/proj', 'bash')
    manager.setMode('a1', 'plan')

    const run = manager.send('a1', 'run bash')
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        if (events.some(e => e.type === 'prompt-request')) {
          clearInterval(t)
          resolve()
        }
      }, 5)
    })
    expect(events.some(e => e.type === 'prompt-request')).toBe(true)
    manager.stop('a1')
    await run
    const result = events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.call.permission).toBe('denied')
  })

  it('lists built-in commands and runs one via the runner', async () => {
    const { manager, events } = await makeManager()
    const list = manager.listCommands('/proj')
    expect(list.map(c => c.name)).toContain('init')
    const p = manager.runCommand('a1', 'init', '')
    await new Promise(r => setTimeout(r, 20))
    // command sends a message to the agent → running then done
    expect(manager.isRunning('a1')).toBe(false)
    await p
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('stores the raw slash input as displayText while the resolved prompt reaches the LLM', async () => {
    const { manager, events } = await makeManager()
    await manager.runCommand('a1', 'init', 'custom arg')
    const echo = events.find(e => e.type === 'user-message') as Extract<ChatEvent, { type: 'user-message' }>
    expect(echo.message.displayText).toBe('/init custom arg')
    expect(echo.message.text).toContain('Create an AGENTS.md file for this project')
    // The resolved prompt is what gets persisted and later sent to the model.
    const stored = manager.listMessages('a1').find(m => m.role === 'user')
    expect(stored?.text).toBe(echo.message.text)
  })

  it('sp-brainstorming bubble shows the raw slash input, not the resolved template', async () => {
    const { manager, events } = await makeManager()
    expect(manager.listCommands('/proj').map(c => c.name)).toContain('sp-brainstorming')
    await manager.runCommand('a1', 'sp-brainstorming', 'tôi test')
    const echo = events.find(e => e.type === 'user-message') as Extract<ChatEvent, { type: 'user-message' }>
    expect(echo.message.displayText).toBe('/sp-brainstorming tôi test')
    expect(echo.message.text).toContain('Use the Superpowers skill `brainstorming`')
    expect(echo.message.text).toContain('User request:')
    expect(echo.message.text).toContain('tôi test')
    // Renderer shows displayText ?? text → the raw slash input.
    expect(echo.message.displayText ?? echo.message.text).toBe('/sp-brainstorming tôi test')
  })

  it('queues displayText alongside the resolved text when a turn is running', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const run = manager.send('a1', 'first')
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        if (events.some(e => e.type === 'turn-started')) {
          clearInterval(t)
          resolve()
        }
      }, 5)
    })
    manager.send('a1', 'Create an AGENTS.md file for this project', undefined, '/init queued')
    const queued = manager.listQueued('a1')
    expect(queued[0]?.displayText).toBe('/init queued')
    expect(queued[0]?.text).toContain('Create an AGENTS.md')
    // Stopping turn 1 drains the queue into a new hanging turn; stop again to release it.
    manager.stop('a1')
    await new Promise(r => setTimeout(r, 30))
    manager.stop('a1')
    await run
  })

  it('runs /new as a system command that creates a new session without calling the LLM', async () => {
    const { manager, events, createLlm } = await makeManager()
    expect(manager.listCommands('/proj').map(c => c.name)).toContain('new')
    const before = manager.listSessions('a1')[0]?.id
    createLlm.mockClear()
    await manager.runCommand('a1', 'new', '')
    const after = manager.listSessions('a1')[0]?.id
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    expect(events.some(e => e.type === 'session-created')).toBe(true)
    expect(createLlm).not.toHaveBeenCalled()
    expect(events.some(e => e.type === 'done')).toBe(false)
  })

  it('reports cost in the done event and accumulates session usage', async () => {
    const { manager, events, store } = await makeManager({
      partsQueue: [[{ kind: 'text', text: 'hi' }, { kind: 'finish', tokens: { input: 1000, output: 500, total: 1500 } }]]
    })
    manager.newSession('a1')
    await manager.send('a1', 'hello')
    const done = events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.cost).toBeGreaterThan(0)
    const sessionId = manager.listSessions('a1')[0].id
    const usage = store.get(sessionId)?.usage
    expect(usage?.input).toBe(1000)
    expect(usage?.cost).toBeCloseTo(done.cost ?? 0, 10)
  })

  it('getContextInfo reports the config limit and the auto-compact threshold', async () => {
    const { manager } = await makeManager()
    const info = manager.getContextInfo('a1')
    // config mặc định: maxContextTokens 128000, compaction.auto true, buffer 20000
    expect(info.limit).toBe(128000)
    expect(info.compactThreshold).toBe(108000)
    expect(info.sessionCost).toBe(0)
  })

  it('getContextInfo returns nulls for an unknown agent', async () => {
    const { manager } = await makeManager()
    expect(manager.getContextInfo('nope')).toEqual({ limit: null, compactThreshold: null, sessionCost: 0 })
  })

  it('emits a usage event with the accumulated session cost', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [[
        { kind: 'text', text: 'hi' },
        { kind: 'finish', tokens: { input: 1_000_000, output: 1_000_000, total: 2_000_000, cacheRead: 500_000 } }
      ]]
    })
    await manager.send('a1', 'hello')
    const usage = events.find(e => e.type === 'usage')
    expect(usage).toBeDefined()
    expect(usage?.type === 'usage' && usage.tokens.total).toBe(2_000_000)
    // giá test: input 1 $/M, output 2 $/M → 1 + 2 = 3 (cacheRead không có giá → 0)
    expect(usage?.type === 'usage' && usage.sessionCost).toBeCloseTo(3, 10)
    // "in" hiển thị gộp cache-read để khớp prompt_tokens của provider dashboard
    expect(usage?.type === 'usage' && usage.sessionTokens.input).toBe(1_500_000)
    expect(usage?.type === 'usage' && usage.sessionTokens.output).toBe(1_000_000)
  })

  it('getStats aggregates usage across sessions', async () => {
    const { manager } = await makeManager({
      partsQueue: [
        [{ kind: 'text', text: 'a' }, { kind: 'finish', tokens: { input: 500, output: 300, total: 800, cacheRead: 200 } }],
        [{ kind: 'text', text: 'b' }, { kind: 'finish', tokens: { input: 200, output: 100, total: 300 } }]
      ]
    })
    await manager.send('a1', 'first')
    manager.newSession('a1')
    await manager.send('a1', 'second')
    const stats = manager.getStats()
    // totalTokens gồm cache-read (500+300+200) + (200+100) = 1300
    expect(stats.totalTokens).toBe(1300)
    expect(stats.totalCost).toBeGreaterThan(0)
    expect(stats.perModel['test-model']).toBeDefined()
    expect(stats.perModel['test-model'].tokens).toBe(1300)
    expect(stats.perSession).toHaveLength(2)
  })

  it('task tool resolves a configured subagent model to a dedicated llm', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-subagent-'))
    try {
      const configPath = path.join(dir, 'meow.json')
      writeFileSync(configPath, JSON.stringify({
        provider: {
          test: { apiKey: 'sk-test', models: ['test-model'] },
          p1: { apiKey: 'sk-p1', models: ['m1', 'm2'] }
        },
        model: 'test',
        subagentModels: { research: { provider: 'p1', model: 'm2' } }
      }))
      const { manager, llmModels, createLlm } = await makeManager({
        configPath,
        partsQueue: [
          [
            { kind: 'tool-call', toolCallId: 'tc1', toolName: 'task', toolInput: { prompt: 'research x', subagent_type: 'research' } },
            { kind: 'finish' }
          ],
          [{ kind: 'text', text: 'sub result' }, { kind: 'finish' }],
          [{ kind: 'text', text: 'done' }, { kind: 'finish' }]
        ]
      })
      manager.newSession('a1')
      await manager.send('a1', 'research x')
      // The subagent ran on a dedicated p1 client using the configured m2 model.
      expect(createLlm.mock.calls.some(c => c[0] === 'p1' && c[1] === 'sk-p1')).toBe(true)
      expect(llmModels).toContain('m2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('task tool falls back to the main model when the subagent provider has no api key', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-subagent-'))
    try {
      const configPath = path.join(dir, 'meow.json')
      writeFileSync(configPath, JSON.stringify({
        provider: {
          test: { apiKey: 'sk-test', models: ['test-model'] },
          p1: { apiKeyEnv: 'MEOW_UNSET_KEY', models: ['m1', 'm2'] }
        },
        model: 'test',
        subagentModels: { research: { provider: 'p1', model: 'm2' } }
      }))
      const { manager, llmModels, createLlm } = await makeManager({
        configPath,
        partsQueue: [
          [
            { kind: 'tool-call', toolCallId: 'tc1', toolName: 'task', toolInput: { prompt: 'research x', subagent_type: 'research' } },
            { kind: 'finish' }
          ],
          [{ kind: 'text', text: 'sub result' }, { kind: 'finish' }],
          [{ kind: 'text', text: 'done' }, { kind: 'finish' }]
        ]
      })
      manager.newSession('a1')
      await manager.send('a1', 'research x')
      // No dedicated subagent client: the task tool inherits the main model/llm.
      expect(createLlm.mock.calls.some(c => c[0] === 'p1')).toBe(false)
      expect(llmModels.every(m => m === 'test-model')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
