import type { ProviderAccount, ProviderId, QuotaInfo } from '../../shared/types'
import type { ConnectionsManager } from './manager'

const REFRESH_INTERVAL_MS = 45 * 60 * 1000
const ALERT_THRESHOLD = 0.9
const ALERT_COOLDOWN_MS = 5 * 60 * 1000

// Quota monitoring: periodic refresh + near-limit alert with cooldown,
// mirroring cockpit-tools' quota alert behaviour.
export class QuotaMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastAlertAt = new Map<string, number>()

  constructor(
    private readonly manager: ConnectionsManager,
    private readonly notify?: { notify(opts: { title: string; body: string }): void },
    private readonly emitAlert?: (payload: { provider: ProviderId; accountId: string; message: string }) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refreshAll(), REFRESH_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async refreshAll(): Promise<void> {
    await this.manager.refreshQuota()
    this.checkAlerts(this.manager.store.list())
  }

  async refreshOne(account: ProviderAccount): Promise<void> {
    await this.manager.refreshQuota(account.provider, account.id)
    this.checkAlerts([account])
  }

  private checkAlerts(accounts: ProviderAccount[]): void {
    const now = Date.now()
    for (const account of accounts) {
      const quota = account.quota
      if (!quota || quota.used === undefined || quota.limit === undefined || quota.limit <= 0) continue
      const ratio = quota.used / quota.limit
      if (ratio < ALERT_THRESHOLD) continue
      const key = account.id
      const last = this.lastAlertAt.get(key) ?? 0
      if (now - last < ALERT_COOLDOWN_MS) continue
      this.lastAlertAt.set(key, now)
      const message = `[meow] Quota ${account.provider} "${account.name}" đã dùng ${Math.round(ratio * 100)}% (${quota.used}/${quota.limit}).`
      this.notify?.notify({ title: '[meow] Cảnh báo quota', body: message })
      this.emitAlert?.({ provider: account.provider, accountId: account.id, message })
    }
  }
}
