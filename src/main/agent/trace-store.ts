import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { TraceEvent, TraceSummary } from '../../shared/types'

export class TraceStore {
  // In-memory seq counters per session; seeded from the file's last seq on
  // first append so seq stays monotonic across process restarts.
  private seqs = new Map<string, number>()

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private filePath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.jsonl`)
  }

  private nextSeq(sessionId: string): number {
    let seq = this.seqs.get(sessionId)
    if (seq === undefined) {
      const events = this.read(sessionId)
      seq = events.length > 0 ? events[events.length - 1].seq + 1 : 1
      this.seqs.set(sessionId, seq)
    }
    this.seqs.set(sessionId, seq + 1)
    return seq
  }

  append(sessionId: string, event: Omit<TraceEvent, 'seq' | 'ts'>): void {
    const full = { ...event, seq: this.nextSeq(sessionId), ts: Date.now() }
    appendFileSync(this.filePath(sessionId), JSON.stringify(full) + '\n')
  }

  read(sessionId: string): TraceEvent[] {
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
    rmSync(this.filePath(sessionId), { force: true })
    this.seqs.delete(sessionId)
  }

  listForAgent(agentId: string): TraceSummary[] {
    const summaries: TraceSummary[] = []
    if (!existsSync(this.dir)) return summaries
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -'.jsonl'.length)
      const events = this.read(sessionId).filter(e => e.agentId === agentId)
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
