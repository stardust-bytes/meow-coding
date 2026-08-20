import { describe, expect, it, vi } from 'vitest'
import { ArtifactStore } from '../../src/main/artifact-store'
import type { ArtifactInput } from '../../src/main/artifact-store'

function input(overrides: Partial<ArtifactInput>): ArtifactInput {
  return {
    path: 'src/a.ts',
    absPath: '/proj/src/a.ts',
    kind: 'edit',
    agentId: 'agent-1',
    agentName: 'Agent 1',
    ...overrides
  }
}

describe('ArtifactStore', () => {
  it('records an entry and notifies onChange', () => {
    const onChange = vi.fn()
    const store = new ArtifactStore(onChange)
    const entry = store.record('/proj', input({}))
    expect(entry.id).toBeTruthy()
    expect(entry.ts).toBeGreaterThan(0)
    expect(store.list('/proj')).toEqual([entry])
    expect(onChange).toHaveBeenCalledWith('/proj', [entry])
  })

  it('updates in place when the same agent edits the same path again', () => {
    const store = new ArtifactStore(() => {})
    const first = store.record('/proj', input({ kind: 'create' }))
    const second = store.record('/proj', input({ kind: 'edit' }))
    expect(second.id).toBe(first.id)
    expect(store.list('/proj')).toHaveLength(1)
    expect(store.list('/proj')[0].kind).toBe('edit')
  })

  it('keeps separate entries for different agents', () => {
    const store = new ArtifactStore(() => {})
    store.record('/proj', input({ agentId: 'agent-1', agentName: 'Agent 1' }))
    store.record('/proj', input({ agentId: 'agent-2', agentName: 'Agent 2', path: 'src/b.ts', absPath: '/proj/src/b.ts' }))
    expect(store.list('/proj')).toHaveLength(2)
  })

  it('lists newest first', () => {
    vi.useFakeTimers()
    try {
      const store = new ArtifactStore(() => {})
      const first = store.record('/proj', input({ path: 'a.ts', absPath: '/proj/a.ts' }))
      vi.advanceTimersByTime(1000)
      const second = store.record('/proj', input({ path: 'b.ts', absPath: '/proj/b.ts' }))
      expect(store.list('/proj').map(e => e.path)).toEqual(['b.ts', 'a.ts'])
      expect(second.ts).toBeGreaterThan(first.ts)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clear empties the project list and notifies', () => {
    const onChange = vi.fn()
    const store = new ArtifactStore(onChange)
    store.record('/proj', input({}))
    store.clear('/proj')
    expect(store.list('/proj')).toEqual([])
    expect(onChange).toHaveBeenLastCalledWith('/proj', [])
  })

  it('isolates projects from each other', () => {
    const store = new ArtifactStore(() => {})
    store.record('/proj-a', input({}))
    store.record('/proj-b', input({ path: 'c.ts', absPath: '/proj-b/c.ts' }))
    expect(store.list('/proj-a')).toHaveLength(1)
    expect(store.list('/proj-b')).toHaveLength(1)
  })
})
