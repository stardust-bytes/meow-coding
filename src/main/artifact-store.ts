import { randomUUID } from 'node:crypto'
import type { ArtifactEntry } from '../shared/types'

export type ArtifactInput = Omit<ArtifactEntry, 'id' | 'ts'>

/**
 * Per-project collection of files created/modified during sessions. One entry
 * per (path, agentId) pair: repeated edits by the same agent update the entry
 * in place so the list stays compact. Newest first on read.
 */
export class ArtifactStore {
  private byProject = new Map<string, Map<string, ArtifactEntry>>()

  constructor(private onChange: (projectPath: string, artifacts: ArtifactEntry[]) => void) {}

  private mapFor(projectPath: string): Map<string, ArtifactEntry> {
    let map = this.byProject.get(projectPath)
    if (!map) {
      map = new Map()
      this.byProject.set(projectPath, map)
    }
    return map
  }

  record(projectPath: string, input: ArtifactInput): ArtifactEntry {
    const map = this.mapFor(projectPath)
    const key = `${input.path}::${input.agentId}`
    const existing = map.get(key)
    const entry: ArtifactEntry = existing
      ? { ...existing, kind: input.kind, agentName: input.agentName, ts: Date.now() }
      : { ...input, id: randomUUID(), ts: Date.now() }
    map.set(key, entry)
    this.onChange(projectPath, this.list(projectPath))
    return entry
  }

  list(projectPath: string): ArtifactEntry[] {
    return [...(this.byProject.get(projectPath)?.values() ?? [])].sort((a, b) => b.ts - a.ts)
  }

  clear(projectPath: string): void {
    this.byProject.delete(projectPath)
    this.onChange(projectPath, [])
  }
}
