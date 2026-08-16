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

  it('appends JSONL lines with auto-incremented seq and non-decreasing ts', () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s1', turnStarted('s1', 'a1'))

    const filePath = path.join(dir, 's1.jsonl')
    expect(existsSync(filePath)).toBe(true)
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim())
    expect(lines).toHaveLength(2)

    const events = lines.map(l => JSON.parse(l))
    expect(events[0].seq).toBe(1)
    expect(events[1].seq).toBe(2)
    expect(events[0].ts).toBeLessThanOrEqual(events[1].ts)
  })

  it('reads events in order and skips corrupt lines', () => {
    store.append('s1', turnStarted('s1', 'a1'))
    appendFileSync(path.join(dir, 's1.jsonl'), '{invalid\n')
    store.append('s1', turnStarted('s1', 'a1'))

    const events = store.read('s1')
    expect(events).toHaveLength(2)
    expect(events[0].seq).toBe(1)
    expect(events[1].seq).toBe(2)
    expect(events[0].type).toBe('turn-started')
    expect(events[1].type).toBe('turn-started')
  })

  it('deletes the session file and read returns empty', () => {
    store.append('s1', turnStarted('s1', 'a1'))
    const filePath = path.join(dir, 's1.jsonl')
    expect(existsSync(filePath)).toBe(true)

    store.delete('s1')

    expect(existsSync(filePath)).toBe(false)
    expect(store.read('s1')).toEqual([])
  })

  it('lists per-session summaries for an agent and ignores other agents', () => {
    store.append('s1', turnStarted('s1', 'a1'))
    store.append('s1', { type: 'error', agentId: 'a1', sessionId: 's1', message: 'boom' })
    store.append('s2', turnStarted('s2', 'a2'))

    const summaries = store.listForAgent('a1')

    expect(summaries).toHaveLength(1)
    expect(summaries[0].sessionId).toBe('s1')
    expect(summaries[0].eventCount).toBe(2)
    const s1Events = store.read('s1')
    expect(summaries[0].firstTs).toBe(s1Events[0].ts)
    expect(summaries[0].lastTs).toBe(s1Events[1].ts)
  })
})
