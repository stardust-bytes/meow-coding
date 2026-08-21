import type { ProviderAccount, QuotaInfo, RoutingStrategy } from '../../shared/types'
import type { ConnectionSecrets } from '../connections/types'

export interface AccountHealth {
  blockedUntil: number | null
  lastError?: string
}

export interface RouterOptions {
  strategy: RoutingStrategy
  coldownSeconds: number
  quotaReservePercent: number
  now?: number
  /** Active account id used by the 'single' strategy. */
  activeAccountId?: string | null
}

function quotaRatio(quota: QuotaInfo | undefined): number | null {
  if (!quota || quota.used === undefined || quota.limit === undefined || quota.limit <= 0) return null
  return quota.used / quota.limit
}

function planTier(planType: string | undefined): number {
  // Higher tier sorts first. Unknown plans get a neutral middle tier.
  const p = (planType ?? '').toLowerCase()
  if (p.includes('max')) return 3
  if (p.includes('pro')) return 2
  if (p.includes('team') || p.includes('enterprise')) return 2
  if (p.includes('free')) return 0
  return 1
}

function isBlocked(health: AccountHealth | undefined, now: number): boolean {
  return health?.blockedUntil != null && health.blockedUntil > now
}

// Pick an account for a gateway request. Filtered by availability + health,
// sorted by strategy, with quota-reserve accounts pushed to the end (not
// excluded entirely).
export function selectAccount(
  accounts: ProviderAccount[],
  getSecrets: (id: string) => ConnectionSecrets,
  health: Map<string, AccountHealth>,
  opts: RouterOptions
): ProviderAccount | null {
  const now = opts.now ?? Date.now()
  const available = accounts.filter(account => {
    if (isBlocked(health.get(account.id), now)) return false
    const secrets = getSecrets(account.id)
    return Boolean(secrets.apiKey || secrets.tokens?.accessToken)
  })
  if (available.length === 0) return null

  const reserveRatio = opts.quotaReservePercent / 100
  const scored = available.map(account => {
    const ratio = quotaRatio(account.quota)
    const nearLimit = ratio !== null && ratio >= 1 - reserveRatio
    return { account, ratio, nearLimit }
  })

  // Sort by strategy (stable: keep original order for ties).
  const sorted = [...scored].sort((a, b) => {
    // Near-limit accounts always sort after healthy ones (except 'single').
    if (opts.strategy !== 'single') {
      if (a.nearLimit !== b.nearLimit) return a.nearLimit ? 1 : -1
    }
    switch (opts.strategy) {
      case 'single':
        // Active account first, then fall back to first available.
        if (a.account.id === opts.activeAccountId) return -1
        if (b.account.id === opts.activeAccountId) return 1
        return 0
      case 'random':
        return Math.random() - 0.5
      case 'quota-high-first':
        return ratioSort(a.ratio, b.ratio, -1)
      case 'quota-low-first':
        return ratioSort(a.ratio, b.ratio, 1)
      case 'expiry-soon-first': {
        const ea = a.account.quota?.periodEnd ?? ''
        const eb = b.account.quota?.periodEnd ?? ''
        return ea.localeCompare(eb)
      }
      case 'auto':
      default: {
        // Most remaining quota → least recently used → higher plan tier.
        if (a.ratio !== null && b.ratio !== null && a.ratio !== b.ratio) return a.ratio - b.ratio
        if (a.account.lastUsed !== b.account.lastUsed) return a.account.lastUsed - b.account.lastUsed
        return planTier(b.account.profile?.planType) - planTier(a.account.profile?.planType)
      }
    }
  })

  return sorted[0]?.account ?? null
}

function ratioSort(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return dir === 1 ? 1 : -1
  if (b === null) return dir === 1 ? -1 : 1
  return dir * (a - b)
}

export function blockAccount(health: Map<string, AccountHealth>, accountId: string, coldownSeconds: number, error?: string, now: number = Date.now()): void {
  health.set(accountId, {
    blockedUntil: now + coldownSeconds * 1000,
    lastError: error
  })
}

export function unblockAccount(health: Map<string, AccountHealth>, accountId: string): void {
  health.set(accountId, { blockedUntil: null })
}
