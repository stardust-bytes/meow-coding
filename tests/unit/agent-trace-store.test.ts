import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TraceStore } from '../../src/main/agent/trace-store'

describe('TraceStore', () => {
  let dir: string
  let store: TraceStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-trace-'))
    store = new TraceStore(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function turnStarted(sessionId: string, agentId: string): { type: 'turn-started'; agentId: string; sessionId: string; turn: number } {
    return { type: 'turn-started', agentId, sessionId, turn: 1 }
  }

  it('buffers appends and flushes them in order', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s1', turnStarted('s1', 'a1'))

    // Buffered: the file must not exist until we flush.
    const filePath = path.join(dir, 's1.jsonl')
    expect(existsSync(filePath)).toBe(false)

    await store.flush('s1')

    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim())
    expect(lines).toHaveLength(2)
    const events = lines.map(l => JSON.parse(l))
    expect(events[0].seq).toBe(1)
    expect(events[1].seq).toBe(2)
    expect(events[0].ts).toBeLessThanOrEqual(events[1].ts)
  })

  it('read awaits pending flush so appends are always visible', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s1', turnStarted('s1', 'a1'))

    const events = await store.read('s1')
    expect(events).toHaveLength(2)
    expect(events[0].seq).toBe(1)
    expect(events[1].seq).toBe(2)
  })

  it('flushAll writes every buffered session', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s2', turnStarted('s2', 'a2'))

    await store.flushAll()

    expect(readFileSync(path.join(dir, 's1.jsonl'), 'utf-8').split('\n').filter(l => l.trim())).toHaveLength(1)
    expect(readFileSync(path.join(dir, 's2.jsonl'), 'utf-8').split('\n').filter(l => l.trim())).toHaveLength(1)
  })

  it('reads events in order and skips corrupt lines', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    appendFileSync(path.join(dir, 's1.jsonl'), '{invalid\n')
    store.append('s1', turnStarted('s1', 'a1'))

    const events = await store.read('s1')
    expect(events).toHaveLength(2)
    expect(events[0].seq).toBe(1)
    expect(events[1].seq).toBe(2)
    expect(events[0].type).toBe('turn-started')
    expect(events[1].type).toBe('turn-started')
  })

  it('deletes the session file and read returns empty', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    await store.flush('s1')
    const filePath = path.join(dir, 's1.jsonl')
    expect(existsSync(filePath)).toBe(true)

    store.delete('s1')
    // delete chains the file removal onto the write queue; wait a tick.
    await new Promise(r => setTimeout(r, 0))

    expect(existsSync(filePath)).toBe(false)
    expect(await store.read('s1')).toEqual([])
  })

  it('lists per-session summaries for an agent and ignores other agents', async () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s1', { type: 'error', agentId: 'a1', sessionId: 's1', message: 'boom' })
    store.append('s2', turnStarted('s2', 'a2'))

    const summaries = await store.listForAgent('a1')

    expect(summaries).toHaveLength(1)
    expect(summaries[0].sessionId).toBe('s1')
    expect(summaries[0].eventCount).toBe(2)
    const s1Events = await store.read('s1')
    expect(summaries[0].firstTs).toBe(s1Events[0].ts)
    expect(summaries[0].lastTs).toBe(s1Events[1].ts)
  })
})
