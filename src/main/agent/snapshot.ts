import type { JsonStore } from '../json-store'

export interface SnapshotEntry {
  agentId: string
  filePath: string
  content: string
}

export class SnapshotStore {
  constructor(private store: JsonStore<SnapshotEntry>) {}

  snapshot(agentId: string, filePath: string, content: string): void {
    const all = this.store.load().filter(e => !(e.agentId === agentId && e.filePath === filePath))
    all.push({ agentId, filePath, content })
    this.store.save(all)
  }

  list(agentId: string): Array<{ filePath: string }> {
    return this.store.load()
      .filter(e => e.agentId === agentId)
      .map(e => ({ filePath: e.filePath }))
  }

  restore(agentId: string, filePath: string): string | null {
    const all = this.store.load()
    const idx = all.findIndex(e => e.agentId === agentId && e.filePath === filePath)
    if (idx < 0) return null
    const content = all[idx].content
    all.splice(idx, 1)
    this.store.save(all)
    return content
  }

  clear(agentId: string): void {
    this.store.save(this.store.load().filter(e => e.agentId !== agentId))
  }
}
