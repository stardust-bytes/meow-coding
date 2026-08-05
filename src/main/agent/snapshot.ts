import { readFileSync, writeFileSync } from 'node:fs'
import type { JsonStore } from '../json-store'

export interface SnapshotFile {
  filePath: string
  content: string
}

export interface SnapshotTurn {
  agentId: string
  ts: number
  before: Record<string, string>
  after: Record<string, string>
}

export const MAX_SNAPSHOTS = 50

type RawEntry = Partial<SnapshotTurn> & { filePath?: string; content?: string }

function normalize(raw: RawEntry): SnapshotTurn {
  if (raw.before) {
    return { agentId: raw.agentId ?? '', ts: raw.ts ?? 0, before: raw.before, after: raw.after ?? {} }
  }
  // Legacy per-file entry {agentId, filePath, content} → single-file turn.
  return {
    agentId: raw.agentId ?? '',
    ts: 0,
    before: raw.filePath && raw.content !== undefined ? { [raw.filePath]: raw.content } : {},
    after: {}
  }
}

export class SnapshotStore {
  private buffer = new Map<string, Map<string, string>>()

  constructor(private store: JsonStore<SnapshotTurn>) {}

  private loadTurns(): SnapshotTurn[] {
    return (this.store.load() as unknown as RawEntry[]).map(normalize)
  }

  private saveTurns(turns: SnapshotTurn[]): void {
    this.store.save(turns)
  }

  private turnsFor(agentId: string): SnapshotTurn[] {
    return this.loadTurns().filter(t => t.agentId === agentId)
  }

  beginTurn(agentId: string): void {
    if (!this.buffer.has(agentId)) this.buffer.set(agentId, new Map())
  }

  abortTurn(agentId: string): void {
    this.buffer.delete(agentId)
  }

  // Records the pre-change content of a file for the current in-progress turn.
  snapshot(agentId: string, filePath: string, content: string): void {
    const buf = this.buffer.get(agentId)
    if (!buf) return
    if (!buf.has(filePath)) buf.set(filePath, content)
  }

  commitTurn(agentId: string): void {
    const buf = this.buffer.get(agentId)
    this.buffer.delete(agentId)
    if (!buf || buf.size === 0) return
    const before: Record<string, string> = {}
    const after: Record<string, string> = {}
    for (const [filePath, content] of buf) {
      before[filePath] = content
      try {
        after[filePath] = readFileSync(filePath, 'utf-8')
      } catch {
        after[filePath] = content
      }
    }
    const all = this.loadTurns()
    const others = all.filter(t => t.agentId !== agentId)
    const mine = all.filter(t => t.agentId === agentId)
    mine.push({ agentId, ts: Date.now(), before, after })
    mine.sort((a, b) => a.ts - b.ts)
    this.saveTurns([...others, ...mine.slice(-MAX_SNAPSHOTS)])
  }

  // Pops the latest turn and restores its pre-change (before) contents.
  undo(agentId: string): SnapshotTurn | null {
    const all = this.loadTurns()
    let idx = -1
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].agentId === agentId) {
        idx = i
        break
      }
    }
    if (idx < 0) return null
    const [turn] = all.splice(idx, 1)
    this.saveTurns(all)
    for (const [filePath, content] of Object.entries(turn.before)) {
      try {
        writeFileSync(filePath, content)
      } catch {
        /* file may have been deleted */
      }
    }
    return turn
  }

  // Re-inserts a turn (used by redo so the change can be undone again).
  pushTurn(turn: SnapshotTurn): void {
    const all = this.loadTurns()
    const others = all.filter(t => t.agentId !== turn.agentId)
    const mine = all.filter(t => t.agentId === turn.agentId)
    mine.push(turn)
    mine.sort((a, b) => a.ts - b.ts)
    this.saveTurns([...others, ...mine.slice(-MAX_SNAPSHOTS)])
  }

  // Earliest recorded pre-change content per file across history (for revert).
  originals(agentId: string): SnapshotFile[] {
    const seen = new Map<string, string>()
    for (const turn of this.turnsFor(agentId)) {
      for (const [filePath, content] of Object.entries(turn.before)) {
        if (!seen.has(filePath)) seen.set(filePath, content)
      }
    }
    return [...seen.entries()].map(([filePath, content]) => ({ filePath, content }))
  }

  clear(agentId: string): void {
    this.buffer.delete(agentId)
    this.saveTurns(this.loadTurns().filter(t => t.agentId !== agentId))
  }
}
