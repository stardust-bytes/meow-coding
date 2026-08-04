import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { WorkspaceStore } from '../../src/main/workspace-store'

let file: string
let store: WorkspaceStore

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-ws-'))
  file = path.join(dir, 'workspaces.json')
  store = new WorkspaceStore(createJsonStore(file))
})

afterEach(() => rmSync(path.dirname(file), { recursive: true, force: true }))

describe('WorkspaceStore', () => {
  it('lists empty by default', () => {
    expect(store.list()).toEqual([])
  })

  it('adds a workspace without duplicating', () => {
    store.add('/proj/a', 'Project A')
    store.add('/proj/a', 'Project A again')
    expect(store.list()).toHaveLength(1)
    expect(store.get('/proj/a')?.name).toBe('Project A')
  })

  it('adds an agent and keeps its config', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    expect(ws.agents).toHaveLength(1)
    expect(ws.agents[0].id).toBeTruthy()
    expect(ws.agents[0].templateId).toBe('opencode')
  })

  it('removes an agent by id', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    const agentId = ws.agents[0].id
    const after = store.removeAgent('/proj/a', agentId)
    expect(after.agents).toHaveLength(0)
  })

  it('throws when adding an agent to an unknown workspace', () => {
    expect(() => store.addAgent('/nope', { name: 'x', templateId: 't', cwd: '/nope' }))
      .toThrow('Workspace not found')
  })

  it('removes a workspace', () => {
    store.add('/proj/a', 'Project A')
    store.remove('/proj/a')
    expect(store.list()).toHaveLength(0)
  })
})
