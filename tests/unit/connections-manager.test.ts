import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConnectionsManager } from '../../src/main/connections/connections-manager'
import { ConnectionStore } from '../../src/main/connections/connection-store'
import { Vault } from '../../src/main/vault'
import type { OAuthTokens } from '../../src/main/connections/types'
import type { CodexAuthorizeResult } from '../../src/main/connections/codex-oauth'
import type { ConnectionAccount } from '../../src/shared/types'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const t = b.toString('utf8')
      if (!t.startsWith('enc:')) throw new Error('bad ciphertext')
      return t.slice(4)
    }
  }
}))

let dir = ''
let store: ConnectionStore
let vault: InstanceType<typeof Vault>

function makeTokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides
  }
}

function makeAuthorizeResult(overrides: Partial<CodexAuthorizeResult> = {}): CodexAuthorizeResult {
  return {
    email: 'dev@example.com',
    displayName: 'Dev',
    tokens: makeTokens(),
    ...overrides
  }
}

function makeManager(overrides: { oauth?: Partial<{ authorize: typeof vi.fn; refreshTokens: typeof vi.fn }>; proxy?: Partial<{ start: typeof vi.fn; getEndpoint: typeof vi.fn; getModelCatalog: typeof vi.fn; refreshAccounts: typeof vi.fn; stop: typeof vi.fn }> } = {}) {
  const oauth = {
    authorize: vi.fn(async () => makeAuthorizeResult()),
    refreshTokens: vi.fn(async (t: OAuthTokens) => ({
      ...t,
      accessToken: 'refreshed-access',
      accessTokenExpiresAt: new Date(Date.now() + 7200_000).toISOString()
    })),
    ...(overrides.oauth ?? {})
  }
  const proxy = {
    start: vi.fn(async () => []),
    getEndpoint: vi.fn(() => ({ accountId: '', baseUrl: 'http://127.0.0.1:43123/v1', apiKey: 'local-account-scoped-key' })),
    getModelCatalog: vi.fn(() => undefined),
    refreshAccounts: vi.fn(async () => []),
    stop: vi.fn(async () => {}),
    ...(overrides.proxy ?? {})
  }
  const manager = new ConnectionsManager({
    store,
    vault,
    oauth,
    proxy
  })
  return { manager, oauth, proxy }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-connmgr-'))
  store = new ConnectionStore(path.join(dir, 'connections', 'index.json'))
  vault = new Vault(path.join(dir, 'connections', 'vault.json'))
})

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('ConnectionsManager', () => {
  it('connects a Codex account and saves secrets through the Vault', async () => {
    const { manager, oauth, proxy } = makeManager()
    const account = await manager.connectCodex()
    expect(account).toMatchObject({ provider: 'codex', email: 'dev@example.com', active: true, status: 'ready' })
    expect(oauth.authorize).toHaveBeenCalled()
    expect(vault.getSecretObject<OAuthTokens>(`connection:codex:${account.id}`)).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    })
    expect(manager.listAccounts()).toHaveLength(1)
    expect(proxy.start).toHaveBeenCalled()
  })

  it('sets the first account active and switches the active account', async () => {
    const { manager, oauth } = makeManager()
    oauth.authorize
      .mockResolvedValueOnce(makeAuthorizeResult({ email: 'one@example.com', displayName: 'One', accountId: 'u1' }))
      .mockResolvedValueOnce(makeAuthorizeResult({ email: 'two@example.com', displayName: 'Two', accountId: 'u2' }))
    const first = await manager.connectCodex()
    const second = await manager.connectCodex()
    expect(first.active).toBe(true)
    expect(second.active).toBe(false)
    await manager.setActive(second.id)
    const accounts = manager.listAccounts()
    expect(accounts.find(a => a.id === first.id)?.active).toBe(false)
    expect(accounts.find(a => a.id === second.id)?.active).toBe(true)
  })

  it('refreshes an expiring token before use', async () => {
    const { manager, oauth, proxy } = makeManager()
    const account = await manager.connectCodex()
    // Token already near expiry -> refresh on next use.
    const expiring = makeTokens({ accessTokenExpiresAt: new Date(Date.now() + 30_000).toISOString() })
    vault.saveSecretObject(`connection:codex:${account.id}`, expiring)
    await manager.ensureFresh(account.id)
    expect(oauth.refreshTokens).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'refresh-token' }))
    const saved = vault.getSecretObject<OAuthTokens>(`connection:codex:${account.id}`)
    expect(saved?.accessToken).toBe('refreshed-access')
    expect(proxy.refreshAccounts).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ accountId: account.id, tokens: expect.objectContaining({ accessToken: 'refreshed-access' }) })
    ]))
  })

  it('marks an account expired when refresh fails', async () => {
    const { manager, oauth } = makeManager({
      oauth: { refreshTokens: vi.fn(async () => { throw new Error('refresh failed') }) }
    })
    const account = await manager.connectCodex()
    const expiring = makeTokens({ accessTokenExpiresAt: new Date(Date.now() + 30_000).toISOString() })
    vault.saveSecretObject(`connection:codex:${account.id}`, expiring)
    await manager.ensureFresh(account.id)
    expect(manager.listAccounts().find(a => a.id === account.id)?.status).toBe('expired')
  })

  it('returns the active account models with accountId and label', async () => {
    const { manager, proxy } = makeManager({
      proxy: {
        getEndpoint: vi.fn(() => ({ accountId: 'codex-acct', baseUrl: 'http://127.0.0.1:43123/v1', apiKey: 'k' })),
        start: vi.fn(async () => [])
      }
    })
    await manager.connectCodex()
    const models = await manager.getActiveCodexModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0]).toMatchObject({ provider: 'codex' })
    expect(models[0].accountId).toBeTruthy()
    expect(models[0].accountLabel).toBeTruthy()
  })

  it('maps the private provider catalog to active model refs and validates declared variants', async () => {
    const { manager } = makeManager({
      proxy: {
        getModelCatalog: vi.fn(() => ({
          data: [
            { id: 'gpt-5.6', name: 'GPT-5.6', variants: ['low', 'ultra'] },
            { id: 'gpt-plain', name: 'GPT Plain', variants: [] }
          ]
        }))
      }
    })
    const account = await manager.connectCodex()
    await expect(manager.getActiveCodexModels()).resolves.toEqual([
      { provider: 'codex', accountId: account.id, accountLabel: 'Dev', model: 'gpt-5.6', variants: ['low', 'ultra'] },
      { provider: 'codex', accountId: account.id, accountLabel: 'Dev', model: 'gpt-plain', variants: [] }
    ])
    await expect(manager.getCodexVariantOptions(account.id, 'gpt-5.6', 'ultra')).resolves.toEqual({
      openaiCompatible: { reasoningEffort: 'ultra' }
    })
    await expect(manager.getCodexVariantOptions(account.id, 'gpt-5.6', 'high')).resolves.toBeUndefined()
    await expect(manager.getCodexVariantOptions('unknown', 'gpt-5.6', 'ultra')).resolves.toBeUndefined()

    const { manager: secondManager, oauth } = makeManager({
      proxy: {
        getModelCatalog: vi.fn(() => ({
          data: [{ id: 'gpt-5.6', name: 'GPT-5.6', variants: ['ultra'] }]
        }))
      }
    })
    oauth.authorize
      .mockResolvedValueOnce(makeAuthorizeResult({ email: 'one@example.com', accountId: 'one' }))
      .mockResolvedValueOnce(makeAuthorizeResult({ email: 'two@example.com', accountId: 'two' }))
    await secondManager.connectCodex()
    const inactive = await secondManager.connectCodex()
    expect(secondManager.listAccounts().find(account => account.id === inactive.id)?.active).toBe(false)
    await expect(secondManager.getCodexVariantOptions(inactive.id, 'gpt-5.6', 'ultra')).resolves.toBeUndefined()
  })

  it('uses fallback model IDs without variants when the private catalog is unavailable', async () => {
    const { manager } = makeManager()
    await manager.connectCodex()
    const models = await manager.getActiveCodexModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(model => Array.isArray(model.variants) && model.variants.length === 0)).toBe(true)
  })

  it('returns a user-safe error when no active ready account exists', async () => {
    const { manager } = makeManager()
    expect(() => manager.getChatEndpoint('nope')).toThrow(/Không có tài khoản Codex/)
  })

  it('disconnects an account and removes its secrets', async () => {
    const { manager, proxy } = makeManager()
    const account = await manager.connectCodex()
    await manager.disconnect(account.id)
    expect(manager.listAccounts()).toHaveLength(0)
    expect(vault.getSecretObject(`connection:codex:${account.id}`)).toBeNull()
    expect(proxy.stop).toHaveBeenCalled()
  })

  it('lists accounts with masked status only', async () => {
    const { manager } = makeManager()
    await manager.connectCodex()
    const account: ConnectionAccount = manager.listAccounts()[0]
    expect(account).not.toHaveProperty('accessToken')
    expect(account).not.toHaveProperty('refreshToken')
  })
})
