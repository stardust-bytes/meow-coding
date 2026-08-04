import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SnapshotStore } from '../../src/main/agent/snapshot'
import type { SnapshotEntry } from '../../src/main/agent/snapshot'
import { writeTool } from '../../src/main/agent/tools/write'
import { editTool } from '../../src/main/agent/tools/edit'
import { revertTool } from '../../src/main/agent/tools/revert'
import type { ToolContext } from '../../src/main/agent/tools/types'

function makeStore() {
  const entries: SnapshotEntry[] = []
  return {
    store: new SnapshotStore({
      load: () => entries,
      save: (next) => entries.splice(0, entries.length, ...next)
    }),
    entries
  }
}

describe('SnapshotStore', () => {
  it('snapshots, lists, restores and clears', () => {
    const { store, entries } = makeStore()
    store.snapshot('a1', '/x/f.ts', 'original')
    store.snapshot('a1', '/x/f.ts', 'overwritten')
    expect(store.list('a1')).toEqual([{ filePath: '/x/f.ts' }])
    store.snapshot('a2', '/y/g.ts', 'other')
    expect(store.list('a1')).toHaveLength(1)
    expect(store.restore('a1', '/x/f.ts')).toBe('overwritten')
    expect(store.restore('a1', '/x/f.ts')).toBeNull()
    expect(entries).toHaveLength(1)
    store.clear('a2')
    expect(entries).toHaveLength(0)
  })
})

describe('revert tool + file tools snapshot', () => {
  let dir: string
  let ctx: ToolContext

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    const { store } = makeStore()
    ctx = { cwd: dir, ask: async () => null, agentId: 'a1', snapshots: store }
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reverts a write back to the original content', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'original')
    await writeTool.run({ file_path: 'f.txt', content: 'changed' }, ctx)
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('changed')
    const r = await revertTool.run({}, ctx)
    expect(r.output).toContain('reverted 1')
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('original')
  })

  it('reverts an edit back to the original content', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'aaa\nbbb\n')
    await editTool.run({ file_path: 'f.txt', old_string: 'bbb', new_string: 'BBB' }, ctx)
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('aaa\nBBB\n')
    await revertTool.run({}, ctx)
    expect(readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('aaa\nbbb\n')
  })

  it('reports when there is nothing to revert', async () => {
    const r = await revertTool.run({}, ctx)
    expect(r.output).toContain('no changes')
  })
})
