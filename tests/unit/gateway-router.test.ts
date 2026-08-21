import { describe, expect, it } from 'vitest'
import { selectAccount, blockAccount, unblockAccount, type AccountHealth } from '../../src/main/gateway/router'
import type { ProviderAccount } from '../../src/shared/types'
import type { ConnectionSecrets } from '../../src/main/connections/types'

function acc(id: string, overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id, provider: 'codex', name: id, authMode: 'oauth', active: false,
    createdAt: 1, lastUsed: 100, codexAuthMode: 'oauth', ...overrides
  }
}

const secretsFor = (hasToken = true): ((id: string) => ConnectionSecrets) =>
  id => hasToken ? { tokens: { accessToken: `at-${id}`, expiresAt: Date.now() + 1e6, lastRefresh: 1 } } : {}

const NOW = 1_000_000

function health(): Map<string, AccountHealth> {
  return new Map()
}

describe('gateway router selectAccount', () => {
  it('returns null when no account has credentials', () => {
    const accounts = [acc('a'), acc('b')]
    expect(selectAccount(accounts, secretsFor(false), health(), { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })).toBeNull()
  })

  it('filters blocked accounts and picks a healthy one', () => {
    const accounts = [acc('a'), acc('b')]
    const h = health()
    blockAccount(h, 'a', 300, '429')
    const picked = selectAccount(accounts, secretsFor(), h, { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })
    expect(picked?.id).toBe('b')
  })

  it('unblocks an account after coldown expires', () => {
    const accounts = [acc('a')]
    const h = health()
    blockAccount(h, 'a', 300, '429', NOW)
    // now = blockedUntil + 1 -> not blocked anymore
    const picked = selectAccount(accounts, secretsFor(), h, { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW + 300_001 })
    expect(picked?.id).toBe('a')
  })

  it('auto prefers the account with most remaining quota', () => {
    const accounts = [
      acc('low', { quota: { provider: 'codex', used: 90, limit: 100, refreshedAt: 1 } }),
      acc('high', { quota: { provider: 'codex', used: 10, limit: 100, refreshedAt: 1 } })
    ]
    const picked = selectAccount(accounts, secretsFor(), health(), { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })
    expect(picked?.id).toBe('high')
  })

  it('quota-reserve accounts sort after healthy ones but are not excluded', () => {
    const accounts = [
      acc('reserved', { quota: { provider: 'codex', used: 95, limit: 100, refreshedAt: 1 } }),
      acc('healthy', { quota: { provider: 'codex', used: 20, limit: 100, refreshedAt: 1 } })
    ]
    const picked = selectAccount(accounts, secretsFor(), health(), { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })
    expect(picked?.id).toBe('healthy')
    // Only reserved account available -> still usable.
    const only = selectAccount([acc('reserved', { quota: { provider: 'codex', used: 99, limit: 100, refreshedAt: 1 } })], secretsFor(), health(), { strategy: 'auto', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })
    expect(only?.id).toBe('reserved')
  })

  it('single strategy always picks the active account', () => {
    const accounts = [
      acc('a', { active: false }),
      acc('b', { active: true })
    ]
    const picked = selectAccount(accounts, secretsFor(), health(), { strategy: 'single', coldownSeconds: 300, quotaReservePercent: 10, now: NOW, activeAccountId: 'b' })
    expect(picked?.id).toBe('b')
  })

  it('quota-high-first sorts descending, quota-low-first ascending', () => {
    const accounts = [
      acc('a', { quota: { provider: 'codex', used: 20, limit: 100, refreshedAt: 1 } }),
      acc('b', { quota: { provider: 'codex', used: 80, limit: 100, refreshedAt: 1 } })
    ]
    expect(selectAccount(accounts, secretsFor(), health(), { strategy: 'quota-high-first', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })?.id).toBe('b')
    expect(selectAccount(accounts, secretsFor(), health(), { strategy: 'quota-low-first', coldownSeconds: 300, quotaReservePercent: 10, now: NOW })?.id).toBe('a')
  })

  it('unblockAccount clears the block', () => {
    const h = health()
    blockAccount(h, 'a', 300, 'err')
    unblockAccount(h, 'a')
    expect(h.get('a')?.blockedUntil).toBeNull()
  })
})
