import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MeowAgentManager } from '../../src/main/meow-agent-manager'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import { SnapshotStore } from '../../src/main/agent/snapshot'
import type { SnapshotEntry } from '../../src/main/agent/snapshot'
import { TruncationStore } from '../../src/main/agent/truncation'
import { SavedPermissions } from '../../src/main/agent/saved-permissions'
import type { SavedPermission } from '../../src/main/agent/saved-permissions'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import type { TraceStore } from '../../src/main/agent/trace-store'
import type { TraceEvent } from '../../src/shared/types'
import type { AgentConfig } from '../../src/shared/types'

const MEOW_AGENT: AgentConfig = {
  id: 'a1', name: 'meow', templateId: 'meow', cwd: '/proj', kind: 'native'
}

interface FakeTrace {
  appends: Array<{ sessionId: string } & Record<string, unknown>>
  deleted: string[]
}

function makeTrace(): FakeTrace & Pick<TraceStore, 'append' | 'delete' | 'flush'> {
  const trace: FakeTrace = { appends: [], deleted: [] }
  return {
    ...trace,
    append(sessionId: string, event: Omit<TraceEvent, 'seq' | 'ts'>): void {
      trace.appends.push({ sessionId, ...event })
    },
    delete(sessionId: string): void {
      trace.deleted.push(sessionId)
    },
    async flush(_sessionId: string): Promise<void> {}
  }
}

async function makeManager(opts: { trace?: boolean } = {}) {
  const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-trace-mgr-'))
  writeFileSync(path.join(cfgDir, 'meow.json'), JSON.stringify({
    provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
    model: 'test',
    ...(opts.trace === false ? {} : { trace: { enabled: true } })
  }))
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
  const trace = makeTrace()
  const manager = new MeowAgentManager({
    configPath: path.join(cfgDir, 'meow.json'),
    store,
    trace: trace as unknown as TraceStore,
    snapshots,
    savedPermissions,
    tools: createDefaultTools(),
    createLlm: () => ({ async *stream() { yield { kind: 'finish' } } }),
    truncation: new TruncationStore(path.join(cfgDir, 'truncation')),
    env: {}
  })
  return { manager, store, trace, cfgDir }
}

describe('MeowAgentManager trace wiring', () => {
  it('skips trace writes when trace is disabled (default)', async () => {
    const { manager, trace } = await makeManager({ trace: false })
    manager.addAgent(MEOW_AGENT)
    manager.newSession('a1')
    manager.setOnEvent(() => {})

    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({ type: 'turn-started', agentId: 'a1' } as never)
    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({ type: 'done', agentId: 'a1', reason: 'complete' } as never)

    expect(trace.appends).toHaveLength(0)
    expect(manager.isTraceEnabled()).toBe(false)
  })

  it('writes trace events for chat events with turn attribution', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    const sessionId = manager.newSession('a1').id
    manager.setOnEvent(() => {})

    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({ type: 'turn-started', agentId: 'a1' } as never)
    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({
      type: 'tool-start', agentId: 'a1', call: { id: 'tc1', tool: 'read', input: { file_path: 'x' }, permission: 'pending' }
    } as never)
    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({
      type: 'tool-result', agentId: 'a1', call: { id: 'tc1', tool: 'read', input: { file_path: 'x' }, output: 'content', permission: 'allowed' }
    } as never)
    ;(manager as unknown as { onEvent: (e: never) => void }).onEvent({ type: 'done', agentId: 'a1', reason: 'complete' } as never)

    expect(trace.appends.length).toBe(4)
    expect(trace.appends.every(a => a.sessionId === sessionId)).toBe(true)
    expect(trace.appends.every(a => a.agentId === 'a1')).toBe(true)
    expect(trace.appends.map(a => a.type)).toEqual(['turn-started', 'tool-start', 'tool-result', 'done'])
    // turn-started stamps turn 1; direct emission below bypasses send()'s
    // nextTurn(), so follow-up events read the (still-1) counter.
    expect(trace.appends.find(a => a.type === 'turn-started')?.turn).toBe(1)
    // Per spec, done/error carry no turn; turn-bearing kinds must have one.
    const turnKinds = trace.appends.filter(a => a.type !== 'done' && a.type !== 'error')
    expect(turnKinds.every(a => typeof a.turn === 'number')).toBe(true)
    const toolResult = trace.appends.find(a => a.type === 'tool-result')
    expect(typeof toolResult?.durationMs).toBe('number')
    expect((toolResult?.durationMs as number) ?? -1).toBeGreaterThanOrEqual(0)
  })

  it('increments the turn counter on each real turn', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    manager.newSession('a1')
    manager.setOnEvent(() => {})
    // The stub LLM streams text + finish, so each send() is one complete turn.
    await manager.send('a1', 'first')
    await manager.send('a1', 'second')
    const turns = trace.appends.filter(a => a.type === 'turn-started').map(a => a.turn)
    expect(turns).toEqual([1, 2])
  })

  it('coalesces text deltas into a single full assistant message before a tool call', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    manager.newSession('a1')
    manager.setOnEvent(() => {})
    const emit = (e: never) => (manager as unknown as { onEvent: (e: never) => void }).onEvent(e)

    emit({ type: 'turn-started', agentId: 'a1' } as never)
    emit({ type: 'text-delta', agentId: 'a1', delta: 'Let me ' } as never)
    emit({ type: 'text-delta', agentId: 'a1', delta: 'check the file.' } as never)
    emit({
      type: 'tool-start', agentId: 'a1', call: { id: 'tc1', tool: 'read', input: { file_path: 'x' }, permission: 'pending' }
    } as never)

    const messages = trace.appends.filter(a => a.type === 'message')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('Let me check the file.')
    const idxStart = trace.appends.findIndex(a => a.type === 'tool-start')
    const idxMsg = trace.appends.findIndex(a => a.type === 'message')
    expect(idxMsg).toBeLessThan(idxStart)
  })

  it('coalesces reasoning and text deltas into one message with both', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    manager.newSession('a1')
    manager.setOnEvent(() => {})
    const emit = (e: never) => (manager as unknown as { onEvent: (e: never) => void }).onEvent(e)

    emit({ type: 'turn-started', agentId: 'a1' } as never)
    emit({ type: 'reasoning-delta', agentId: 'a1', delta: 'think...' } as never)
    emit({ type: 'text-delta', agentId: 'a1', delta: 'Answer here.' } as never)
    emit({ type: 'done', agentId: 'a1', reason: 'complete' } as never)

    const messages = trace.appends.filter(a => a.type === 'message')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('Answer here.')
    expect(messages[0].reasoning).toBe('think...')
  })

  it('deletes trace files when a session is deleted', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    const sessionId = manager.newSession('a1').id
    manager.deleteSession('a1', sessionId)
    expect(trace.deleted).toContain(sessionId)
  })

  it('deletes trace files for all sessions when an agent is removed', async () => {
    const { manager, trace } = await makeManager()
    manager.addAgent(MEOW_AGENT)
    const s1 = manager.newSession('a1').id
    const s2 = manager.newSession('a1').id
    manager.removeAgent('a1')
    expect(trace.deleted).toContain(s1)
    expect(trace.deleted).toContain(s2)
  })
})
