import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const encryptMock = vi.fn((s: string) => Buffer.from(`enc:${s}`))
const decryptMock = vi.fn((b: Buffer) => Buffer.from(b.toString().replace(/^enc:/, '')))
const availableMock = vi.fn(() => true)

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => availableMock(),
    encryptString: (s: string) => encryptMock(s),
    decryptString: (b: Buffer) => decryptMock(b)
  }
}))

import { Vault } from '../../src/main/connections/vault'
import { ConnectionsStore } from '../../src/main/connections/store'

function makeDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'meow-conn-'))
}

describe('Vault', () => {
  let dir: string
  beforeEach(() => {
    dir = makeDir()
    encryptMock.mockClear()
    decryptMock.mockClear()
    availableMock.mockReset()
    availableMock.mockImplementation(() => true)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('encrypts and decrypts a secret round-trip', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    vault.saveSecret('ref-1', 'sk-secret-123')
    expect(vault.getSecret('ref-1')).toBe('sk-secret-123')
  })

  it('persists secrets to disk and reads them back', () => {
    const file = path.join(dir, 'vault.json')
    const vault = new Vault(file)
    vault.saveSecret('a', 'sk-a')
    const reloaded = new Vault(file)
    expect(reloaded.getSecret('a')).toBe('sk-a')
  })

  it('returns null for a missing ref and removes refs', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(vault.getSecret('nope')).toBeNull()
    vault.saveSecret('x', 'secret')
    vault.deleteSecret('x')
    expect(vault.getSecret('x')).toBeNull()
  })

  it('throws when safeStorage is unavailable', () => {
    availableMock.mockImplementation(() => false)
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(() => vault.saveSecret('a', 'sk')).toThrow()
    expect(vault.isAvailable()).toBe(false)
  })

  it('masks secrets for display', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(vault.mask('sk-abcdef123456')).toBe('sk-a…3456')
    expect(vault.mask('short')).toBe('••••')
  })
})

describe('ConnectionsStore', () => {
  let dir: string
  beforeEach(() => {
    dir = makeDir()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const vault = (): Vault => new Vault(path.join(dir, 'vault.json'))

  it('upserts, lists and removes accounts; secrets stay out of JSON', () => {
    const store = new ConnectionsStore(dir, vault())
    const account = {
      id: 'acc-1', provider: 'apikey' as const, name: 'My Key', authMode: 'api-key' as const,
      active: false, createdAt: 1, lastUsed: 1, apiKeyField: 'ANTHROPIC_API_KEY'
    }
    store.setApiKey('acc-1', 'sk-vaulted')
    store.upsert(account)
    expect(store.list()).toHaveLength(1)
    expect(store.getSecrets('acc-1').apiKey).toBe('sk-vaulted')
    const raw = readFileSync(path.join(dir, 'accounts', 'acc-1.json'), 'utf-8')
    expect(raw).not.toContain('sk-vaulted')
    store.remove('acc-1')
    expect(store.list()).toHaveLength(0)
    expect(store.getSecrets('acc-1').apiKey).toBeUndefined()
  })

  it('keeps only one active account per provider', () => {
    const store = new ConnectionsStore(dir, vault())
    for (const id of ['a', 'b']) {
      store.upsert({ id, provider: 'claude', name: id, authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1 })
    }
    store.setActive('claude', 'a')
    store.setActive('claude', 'b')
    expect(store.activeFor('claude')?.id).toBe('b')
  })

  it('switching active to a different provider does not affect the first', () => {
    const store = new ConnectionsStore(dir, vault())
    store.upsert({ id: 'c1', provider: 'claude', name: 'c1', authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1 })
    store.upsert({ id: 'x1', provider: 'codex', name: 'x1', authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1 })
    store.setActive('claude', 'c1')
    store.setActive('codex', 'x1')
    expect(store.activeFor('claude')?.id).toBe('c1')
    expect(store.activeFor('codex')?.id).toBe('x1')
  })

  it('removing an active account clears the active id', () => {
    const store = new ConnectionsStore(dir, vault())
    store.upsert({ id: 'a', provider: 'claude', name: 'a', authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1 })
    store.setActive('claude', 'a')
    store.remove('a')
    expect(store.activeFor('claude')).toBeNull()
  })

  it('statuses builds per-provider summaries', () => {
    const store = new ConnectionsStore(dir, vault())
    store.upsert({ id: 'a', provider: 'claude', name: 'a', authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1 })
    store.setActive('claude', 'a')
    const statuses = store.statuses({})
    expect(statuses.find(s => s.provider === 'claude')).toMatchObject({
      provider: 'claude', activeAccountId: 'a', accounts: [{ id: 'a' }]
    })
    expect(statuses.find(s => s.provider === 'apikey')?.accounts).toEqual([])
  })
})
