import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SnapshotStore, MAX_SNAPSHOTS } from '../../src/main/agent/snapshot'
import type { SnapshotTurn } from '../../src/main/agent/snapshot'
import { SavedPermissions } from '../../src/main/agent/saved-permissions'
import type { SavedPermission } from '../../src/main/agent/saved-permissions'
import { writeTool } from '../../src/main/agent/tools/write'
import { editTool } from '../../src/main/agent/tools/edit'
import { revertTool } from '../../src/main/agent/tools/revert'
import { snapshotFile } from '../../src/main/agent/tools/snapshot-util'
import type { ToolContext } from '../../src/main/agent/tools/types'

function makeStore() {
  const entries: SnapshotTurn[] = []
  return {
    store: new SnapshotStore({
      load: () => entries,
      save: (next) => entries.splice(0, entries.length, ...next)
    }),
    entries
  }
}

describe('SnapshotStore', () => {
  it('records one turn per commit and restores on undo', () => {
    const { store, entries } = makeStore()
    store.beginTurn('a1')
    store.snapshot('a1', '/x/f.ts', 'original')
    store.snapshot('a1', '/x/f.ts', 'overwritten')
    store.commitTurn('a1')
    expect(entries).toHaveLength(1)
    expect(entries[0].before).toEqual({ '/x/f.ts': 'original' })
    expect(store.undo('a1')).not.toBeNull()
    expect(entries).toHaveLength(0)
    expect(store.undo('a1')).toBeNull()
  })

  it('keeps only the first snapshot per file within a turn', () => {
    const { store, entries } = makeStore()
    store.beginTurn('a1')
    store.snapshot('a1', '/x/f.ts', 'first')
    store.snapshot('a1', '/x/f.ts', 'second')
    store.commitTurn('a1')
    expect(entries[0].before['/x/f.ts']).toBe('first')
  })

  it('keeps separate agents isolated and caps history', () => {
    const { store, entries } = makeStore()
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      store.beginTurn('a1')
      store.snapshot('a1', `/x/${i}.ts`, String(i))
      store.commitTurn('a1')
    }
    store.beginTurn('a2')
    store.snapshot('a2', '/y/g.ts', 'other')
    store.commitTurn('a2')
    expect(entries.filter(e => e.agentId === 'a1')).toHaveLength(MAX_SNAPSHOTS)
    expect(entries.filter(e => e.agentId === 'a2')).toHaveLength(1)
    store.clear('a2')
    expect(entries.every(e => e.agentId !== 'a2')).toBe(true)
  })

  it('originals returns the earliest recorded content per file', () => {
    const { store } = makeStore()
    store.beginTurn('a1')
    store.snapshot('a1', '/x/f.ts', 'v1')
    store.commitTurn('a1')
    store.beginTurn('a1')
    store.snapshot('a1', '/x/f.ts', 'v2')
    store.commitTurn('a1')
    expect(store.originals('a1')).toEqual([{ filePath: '/x/f.ts', content: 'v1' }])
  })
})

describe('SavedPermissions', () => {
  it('saves and checks always-allow rules per project', () => {
    const entries: SavedPermission[] = []
    const store = new SavedPermissions({
      load: () => entries,
      save: (next) => entries.splice(0, entries.length, ...next)
    })
    expect(store.isAllowed('/proj/a', 'bash')).toBe(false)
    store.save('/proj/a', 'bash')
    expect(store.isAllowed('/proj/a', 'bash')).toBe(true)
    expect(store.isAllowed('/proj/b', 'bash')).toBe(false)
  })
})

describe('revert tool + file tools snapshot', () => {
  let dir: string
  let ctx: ToolContext
  let store: SnapshotStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    store = makeStore().store
    ctx = { cwd: dir, ask: async () => null, agentId: 'a1', snapshots: store }
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function inTurn(fn: () => Promise<unknown>): Promise<void> {
    store.beginTurn('a1')
    try {
      await fn()
    } finally {
      store.commitTurn('a1')
    }
  }

  it('reverts a write back to the original content', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'original')
    await inTurn(() => writeTool.run({ file_path: 'f.txt', content: 'changed' }, ctx))
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('changed')
    const r = await revertTool.run({}, ctx)
    expect(r.output).toContain('reverted 1')
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('original')
  })

  it('reverts an edit back to the original content', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'aaa\nbbb\n')
    await inTurn(() => editTool.run({ file_path: 'f.txt', old_string: 'bbb', new_string: 'BBB' }, ctx))
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('aaa\nBBB\n')
    await revertTool.run({}, ctx)
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('aaa\nbbb\n')
  })

  it('reports when there is nothing to revert', async () => {
    const r = await revertTool.run({}, ctx)
    expect(r.output).toContain('no changes')
  })
})

describe('snapshotFile agent attribution', () => {
  it('records under snapshotAgentId when the caller is a subagent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'before')
    const recorded: Array<{ agentId: string; filePath: string }> = []
    const ctx = {
      cwd: dir,
      ask: async () => null,
      agentId: 'sub-general-123',
      snapshotAgentId: 'agent-parent',
      snapshots: {
        snapshot: (agentId: string, filePath: string) => recorded.push({ agentId, filePath })
      }
    } as unknown as ToolContext

    snapshotFile(ctx, file)

    expect(recorded).toEqual([{ agentId: 'agent-parent', filePath: file }])
  })

  it('falls back to agentId when snapshotAgentId is absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'before')
    const recorded: string[] = []
    const ctx = {
      cwd: dir,
      ask: async () => null,
      agentId: 'agent-parent',
      snapshots: { snapshot: (agentId: string) => recorded.push(agentId) }
    } as unknown as ToolContext

    snapshotFile(ctx, file)

    expect(recorded).toEqual(['agent-parent'])
  })
})
