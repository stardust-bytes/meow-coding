import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConnectionStore } from '../../src/main/connections/connection-store'
import type { ConnectionAccount } from '../../src/shared/types'

let dir = ''
let indexPath = ''

function makeStore(): ConnectionStore {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-conn-'))
  indexPath = path.join(dir, 'connections', 'index.json')
  return new ConnectionStore(indexPath)
}

function acct(overrides: Partial<ConnectionAccount> = {}): ConnectionAccount {
  return {
    id: 'acct-a',
    provider: 'codex',
    email: 'a@example.com',
    displayName: 'a@example.com',
    active: false,
    createdAt: new Date().toISOString(),
    status: 'ready',
    ...overrides
  }
}

beforeEach(() => {
  makeStore()
})

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('ConnectionStore', () => {
  it('adds and lists Codex account metadata', () => {
    const store = makeStore()
    const a = acct({ id: 'acct-a', active: true })
    store.upsert(a)
    expect(store.list('codex')).toEqual([
      expect.objectContaining({ id: 'acct-a', active: true, status: 'ready' })
    ])
  })

  it('persists exactly one active account per provider', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a', active: true }))
    store.upsert(acct({ id: 'acct-b', active: true }))
    const list = store.list('codex')
    expect(list.filter(a => a.active)).toHaveLength(1)
    expect(list.find(a => a.active)?.id).toBe('acct-b')
  })

  it('selecting an account clears active on its peers', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a', active: true }))
    store.upsert(acct({ id: 'acct-b' }))
    store.setActive('codex', 'acct-b')
    const list = store.list('codex')
    expect(list.find(a => a.id === 'acct-a')?.active).toBe(false)
    expect(list.find(a => a.id === 'acct-b')?.active).toBe(true)
  })

  it('removes an account', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a' }))
    store.upsert(acct({ id: 'acct-b' }))
    store.remove('codex', 'acct-a')
    expect(store.list('codex').map(a => a.id)).toEqual(['acct-b'])
  })

  it('reloads persisted metadata from disk', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a', active: true }))
    const reloaded = new ConnectionStore(indexPath)
    expect(reloaded.list('codex')).toEqual([
      expect.objectContaining({ id: 'acct-a', active: true })
    ])
  })

  it('never writes OAuth tokens into the metadata index', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a' }))
    const raw = readFileSync(indexPath, 'utf8')
    expect(raw).not.toContain('refresh-token')
    expect(raw).not.toContain('access-token')
    expect(raw).not.toContain('id-token')
  })

  it('discards malformed entries while keeping valid ones', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a' }))
    // Simulate corruption: write an invalid account object into the document.
    const doc = JSON.parse(readFileSync(indexPath, 'utf8'))
    doc.accounts.push({ id: 'broken', provider: 'codex' }) // missing displayName/createdAt/status
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(indexPath, JSON.stringify(doc))
    const reloaded = new ConnectionStore(indexPath)
    expect(reloaded.list('codex').map(a => a.id)).toEqual(['acct-a'])
  })

  it('tracks lastUsedAt on selection', () => {
    const store = makeStore()
    store.upsert(acct({ id: 'acct-a' }))
    store.setActive('codex', 'acct-a')
    expect(store.list('codex')[0].lastUsedAt).toBeDefined()
    expect(store.list('codex')[0].active).toBe(true)
  })
})
