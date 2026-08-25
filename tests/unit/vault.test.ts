import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const encryptMock = vi.fn()
const decryptMock = vi.fn()
const availableMock = vi.fn()

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => availableMock(),
    encryptString: (s: string) => encryptMock(s),
    decryptString: (b: Buffer) => decryptMock(b)
  }
}))

import { Vault } from '../../src/main/vault'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-vault-'))
  availableMock.mockReturnValue(true)
  encryptMock.mockImplementation((s: string) => Buffer.from(`enc:${s}`))
  decryptMock.mockImplementation((b: Buffer) => {
    const text = b.toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
    return text.slice(4)
  })
})

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true })} catch { /* ignore */ }
  }
})

describe('Vault', () => {
  it('stores and retrieves a connection secret reference', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(vault.isAvailable()).toBe(true)
    vault.saveSecret('connection:codex:acct-a', 'refresh-token')
    expect(vault.getSecret('connection:codex:acct-a')).toBe('refresh-token')
  })

  it('stores a structured connection secret object', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token' }
    vault.saveSecretObject('connection:codex:acct-a', tokens)
    expect(vault.getSecretObject<{ accessToken: string; refreshToken: string }>('connection:codex:acct-a'))
      .toEqual(tokens)
  })

  it('returns null for a missing secret', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(vault.getSecret('connection:codex:nope')).toBeNull()
    expect(vault.getSecretObject('connection:codex:nope')).toBeNull()
  })

  it('deletes a secret reference', () => {
    const vault = new Vault(path.join(dir, 'vault.json'))
    vault.saveSecret('connection:codex:acct-a', 'refresh-token')
    vault.deleteSecret('connection:codex:acct-a')
    expect(vault.getSecret('connection:codex:acct-a')).toBeNull()
  })

  it('fails closed when encryption is unavailable', () => {
    availableMock.mockReturnValue(false)
    const vault = new Vault(path.join(dir, 'vault.json'))
    expect(vault.isAvailable()).toBe(false)
    expect(() => vault.saveSecret('connection:codex:acct-a', 'x')).toThrow(/safeStorage/)
  })

  it('persists secrets across reloads', () => {
    const file = path.join(dir, 'vault.json')
    const vault = new Vault(file)
    vault.saveSecret('connection:codex:acct-a', 'refresh-token')
    const reloaded = new Vault(file)
    expect(reloaded.getSecret('connection:codex:acct-a')).toBe('refresh-token')
  })
})
