import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import type { TraceEvent, TraceSummary } from '../../shared/types'

// Omit does not distribute over the TraceEvent union; a naked type parameter
// does, so derive the input type per member to keep discriminated-union
// narrowing in append() callers.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type TraceEventInput = DistributiveOmit<TraceEvent, 'seq' | 'ts'>

const FLUSH_INTERVAL_MS = 1000
const FLUSH_BATCH = 64

export class TraceStore {
  // In-memory seq counters per session; seeded from the file's last seq on
  // first append so seq stays monotonic across process restarts.
  private seqs = new Map<string, number>()
  // Appends land in a per-session buffer and are flushed asynchronously so a
  // hot agent loop never blocks the main event loop on synchronous file I/O.
  private buffers = new Map<string, TraceEvent[]>()
  // Per-session promise chain keeps writes strictly ordered per session even
  // when multiple flushes are in flight.
  private writeChains = new Map<string, Promise<void>>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private filePath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.jsonl`)
  }

  private nextSeq(sessionId: string): number {
    let seq = this.seqs.get(sessionId)
    if (seq === undefined) {
      const filePath = this.filePath(sessionId)
      if (existsSync(filePath)) {
        for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as TraceEvent
            if (typeof parsed.seq === 'number') seq = parsed.seq
          } catch {
            /* corrupt tail line: ignore, last valid seq wins */
          }
        }
      }
      seq = (seq ?? 0) + 1
      this.seqs.set(sessionId, seq)
    }
    this.seqs.set(sessionId, seq + 1)
    return seq
  }

  append(sessionId: string, event: TraceEventInput): TraceEvent {
    const full = { ...event, seq: this.nextSeq(sessionId), ts: Date.now() } as TraceEvent
    let buf = this.buffers.get(sessionId)
    if (!buf) {
      buf = []
      this.buffers.set(sessionId, buf)
    }
    buf.push(full)
    if (buf.length >= FLUSH_BATCH) {
      void this.flush(sessionId)
    } else if (!this.timers.has(sessionId)) {
      const t = setTimeout(() => void this.flush(sessionId), FLUSH_INTERVAL_MS)
      t.unref?.()
      this.timers.set(sessionId, t)
    }
    return full
  }

  flush(sessionId: string): Promise<void> {
    const buf = this.buffers.get(sessionId)
    if (buf && buf.length > 0) {
      this.buffers.delete(sessionId)
      const lines = buf.map(e => JSON.stringify(e) + '\n').join('')
      const prev = this.writeChains.get(sessionId) ?? Promise.resolve()
      const next = prev.then(() => appendFile(this.filePath(sessionId), lines))
      next.catch(err => console.warn(`[trace] flush failed for ${sessionId}:`, err))
      this.writeChains.set(sessionId, next)
    }
    const timer = this.timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(sessionId)
    }
    return this.writeChains.get(sessionId) ?? Promise.resolve()
  }

  async flushAll(): Promise<void> {
    const sessions = new Set([...this.buffers.keys(), ...this.writeChains.keys()])
    for (const sessionId of sessions) {
      await this.flush(sessionId)
    }
  }

  async read(sessionId: string): Promise<TraceEvent[]> {
    await this.flush(sessionId)
    const filePath = this.filePath(sessionId)
    if (!existsSync(filePath)) return []
    const events: TraceEvent[] = []
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as TraceEvent)
      } catch {
        console.warn(`[trace] skipping corrupt line in ${filePath}`)
      }
    }
    return events
  }

  delete(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(sessionId)
    }
    this.buffers.delete(sessionId)
    this.seqs.delete(sessionId)
    const prev = this.writeChains.get(sessionId) ?? Promise.resolve()
    this.writeChains.delete(sessionId)
    prev.then(() => rmSync(this.filePath(sessionId), { force: true })).catch(() => {})
  }

  async listForAgent(agentId: string): Promise<TraceSummary[]> {
    await this.flushAll()
    const summaries: TraceSummary[] = []
    if (!existsSync(this.dir)) return summaries
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -'.jsonl'.length)
      const events = (await this.read(sessionId)).filter(e => e.agentId === agentId)
      if (events.length === 0) continue
      summaries.push({
        sessionId,
        eventCount: events.length,
        firstTs: events[0].ts,
        lastTs: events[events.length - 1].ts
      })
    }
    return summaries
  }
}
