import { randomUUID } from 'node:crypto'
import { Channels } from '../../shared/ipc'
import type { ApiKeyInput, ConnectionsState, LoginStart, ProviderAccount, ProviderId, QuotaInfo } from '../../shared/types'
import { ConnectionsStore } from './store'
import { Vault } from './vault'
import type { ConnectionSecrets, PendingLogin } from './types'
import type { LoginProgressStatus } from './types'
import type { CallbackServer } from './oauth'

const LOGIN_TTL_MS = 5 * 60 * 1000

export interface AdapterContext {
  store: ConnectionsStore
  vault: Vault
  /** Base connections dir (userData/connections). */
  dir: string
  openExternal?: (url: string) => void
}

export interface ProviderAdapter {
  readonly provider: ProviderId
  loginStart?(ctx: AdapterContext & LoginContext): Promise<Omit<LoginStart, 'loginId' | 'provider'>>
  loginSubmit?(ctx: AdapterContext & LoginContext, code: string): Promise<ProviderAccount>
  importFromJson?(json: string, ctx: AdapterContext): Promise<ProviderAccount>
  onSwitch?(account: ProviderAccount, ctx: AdapterContext): Promise<void> | void
  onRemove?(account: ProviderAccount, ctx: AdapterContext): Promise<void> | void
  buildSpawnEnv?(account: ProviderAccount, secrets: ConnectionSecrets): Record<string, string>
  refreshQuota?(account: ProviderAccount, secrets: ConnectionSecrets, ctx: AdapterContext): Promise<QuotaInfo | null>
  test?(account: ProviderAccount, secrets: ConnectionSecrets): Promise<{ ok: boolean; error?: string }>
}

export interface LoginContext {
  provider: ProviderId
  loginId: string
  codeVerifier?: string
  state?: string
  /** Local callback server started by the adapter (Codex). */
  callbackServer?: CallbackServer
  /** Port the OAuth callback arrived on. */
  callbackPort?: number
}

export interface ConnectionsManagerDeps {
  dir: string
  vault: Vault
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>
  notify?: { notify(opts: { title: string; body: string }): void }
  emit?: (channel: string, payload: unknown) => void
  openExternal?: (url: string) => void
}

export class ConnectionsManager {
  readonly store: ConnectionsStore
  private readonly adapters: Partial<Record<ProviderId, ProviderAdapter>>
  private readonly pending = new Map<string, PendingLogin>()
  private readonly callbackServers = new Map<string, CallbackServer>()

  constructor(private readonly deps: ConnectionsManagerDeps) {
    this.store = new ConnectionsStore(deps.dir, deps.vault)
    this.adapters = deps.adapters ?? {}
  }

  listState(): ConnectionsState {
    const pending: ConnectionsState['providers'] = this.store.statuses({})
    for (const [loginId, login] of this.pending) {
      if (Date.now() > login.expiresAt) {
        this.pending.delete(loginId)
        continue
      }
      const status = pending.find(p => p.provider === login.provider)
      if (status) {
        status.login = {
          loginId,
          provider: login.provider,
          authUrl: '',
          mode: login.mode,
          expiresIn: Math.max(0, Math.ceil((login.expiresAt - Date.now()) / 1000))
        } as LoginStart
      }
    }
    return { providers: pending }
  }

  async startLogin(provider: ProviderId, _mode?: 'oauth'): Promise<LoginStart> {
    const adapter = this.adapters[provider]
    if (!adapter?.loginStart) {
      throw new Error(`[meow] Provider "${provider}" chưa hỗ trợ đăng nhập`)
    }
    const loginId = randomUUID()
    const pending: PendingLogin = {
      loginId,
      provider,
      mode: 'browser-code',
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_TTL_MS
    }
    const ctx: AdapterContext & LoginContext = { ...this.ctx(), provider, loginId }
    const start = await adapter.loginStart(ctx)
    pending.mode = start.mode
    pending.codeVerifier = ctx.codeVerifier
    pending.state = ctx.state
    pending.callbackPort = ctx.callbackPort
    this.pending.set(loginId, pending)
    if (ctx.callbackServer) this.callbackServers.set(loginId, ctx.callbackServer)
    if (start.authUrl) this.deps.openExternal?.(start.authUrl)
    this.emitProgress(loginId, provider, 'started')
    return { ...start, loginId, provider, expiresIn: Math.ceil((pending.expiresAt - Date.now()) / 1000) }
  }

  cancelLogin(loginId: string): void {
    const pending = this.pending.get(loginId)
    this.pending.delete(loginId)
    this.callbackServers.get(loginId)?.close()
    this.callbackServers.delete(loginId)
    if (pending) this.emitProgress(loginId, pending.provider, 'cancelled')
  }

  async submitCode(loginId: string, code: string): Promise<ProviderAccount> {
    const pending = this.pending.get(loginId)
    if (!pending) throw new Error('[meow] Phiên đăng nhập không tồn tại hoặc đã hết hạn')
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(loginId)
      throw new Error('[meow] Phiên đăng nhập đã hết hạn, hãy thử lại')
    }
    const adapter = this.adapters[pending.provider]
    if (!adapter?.loginSubmit) throw new Error(`[meow] Provider "${pending.provider}" chưa hỗ trợ đăng nhập`)
    const ctx: AdapterContext & LoginContext = {
      ...this.ctx(),
      provider: pending.provider,
      loginId,
      codeVerifier: pending.codeVerifier,
      state: pending.state,
      callbackServer: this.callbackServers.get(loginId),
      callbackPort: pending.callbackPort
    }
    try {
      this.emitProgress(loginId, pending.provider, 'awaiting-code')
      const account = await adapter.loginSubmit(ctx, code.trim())
      this.callbackServers.get(loginId)?.close()
      this.callbackServers.delete(loginId)
      this.pending.delete(loginId)
      this.store.upsert({ ...account, active: true, lastUsed: Date.now() })
      this.store.setActive(pending.provider, account.id)
      await this.adapters[pending.provider]?.onSwitch?.(account, this.ctx())
      this.emitChanged()
      return account
    } catch (err) {
      this.emitProgress(loginId, pending.provider, 'failed', String(err))
      throw err
    }
  }

  async switchAccount(provider: ProviderId, accountId: string): Promise<void> {
    const account = this.store.get(accountId)
    if (!account || account.provider !== provider) throw new Error('[meow] Không tìm thấy tài khoản')
    this.store.setActive(provider, accountId)
    await this.adapters[provider]?.onSwitch?.(account, this.ctx())
    this.emitChanged()
  }

  async removeAccount(accountId: string): Promise<void> {
    const account = this.store.get(accountId)
    if (!account) return
    await this.adapters[account.provider]?.onRemove?.(account, this.ctx())
    this.store.remove(accountId)
    this.emitChanged()
  }

  async importAccount(provider: ProviderId, json: string): Promise<ProviderAccount> {
    const adapter = this.adapters[provider]
    if (!adapter?.importFromJson) throw new Error(`[meow] Provider "${provider}" chưa hỗ trợ import`)
    const account = await adapter.importFromJson(json, this.ctx())
    this.store.upsert({ ...account, active: false, lastUsed: Date.now() })
    this.emitChanged()
    return account
  }

  // ---- API key vault (provider 'apikey') ----
  async saveApiKey(input: ApiKeyInput): Promise<ProviderAccount> {
    const adapter = this.adapters.apikey
    if (!adapter?.importFromJson) {
      throw new Error('[meow] API key vault chưa khả dụng')
    }
    const account = await adapter.importFromJson(JSON.stringify(input), this.ctx())
    this.store.upsert({ ...account, active: false, lastUsed: Date.now() })
    this.emitChanged()
    return account
  }

  async testApiKey(accountId: string): Promise<{ ok: boolean; error?: string }> {
    const account = this.store.get(accountId)
    if (!account || account.provider !== 'apikey') return { ok: false, error: 'Không tìm thấy khóa' }
    const adapter = this.adapters.apikey
    if (!adapter?.test) return { ok: false, error: 'Chưa hỗ trợ kiểm tra' }
    return adapter.test(account, this.store.getSecrets(accountId))
  }

  // ---- Quota (Phase 6 fills real endpoints) ----
  async refreshQuota(provider?: ProviderId, accountId?: string): Promise<void> {
    const accounts = accountId
      ? (this.store.get(accountId) ? [this.store.get(accountId)!] : [])
      : this.store.list().filter(a => provider ? a.provider === provider : true)
    for (const account of accounts) {
      const adapter = this.adapters[account.provider]
      if (!adapter?.refreshQuota) continue
      try {
        const quota = await adapter.refreshQuota(account, this.store.getSecrets(account.id), this.ctx())
        if (quota) {
          this.store.upsert({ ...account, quota, quotaError: undefined, lastUsed: Date.now() })
        }
      } catch (err) {
        this.store.upsert({ ...account, quotaError: String(err) })
      }
    }
    this.emitChanged()
  }

  // Resolve extra env vars for a spawned CLI agent (e.g. template 'claude'
  // gets CLAUDE_CONFIG_DIR / ANTHROPIC_* of the active account).
  resolveSpawnEnv(templateId: string): Record<string, string> {
    const provider = this.providerForTemplate(templateId)
    if (!provider) return {}
    const account = this.store.activeFor(provider)
    if (!account) return {}
    const adapter = this.adapters[provider]
    if (!adapter?.buildSpawnEnv) return {}
    return adapter.buildSpawnEnv(account, this.store.getSecrets(account.id))
  }

  private providerForTemplate(templateId: string): ProviderId | null {
    if (templateId === 'claude') return 'claude'
    if (templateId === 'codex') return 'codex'
    return null
  }

  private ctx(): AdapterContext {
    return { store: this.store, vault: this.deps.vault, dir: this.deps.dir, openExternal: this.deps.openExternal }
  }

  private emitChanged(): void {
    this.deps.emit?.(Channels.EventConnectionsChanged, { state: this.listState() })
  }

  private emitProgress(loginId: string, provider: ProviderId, status: LoginProgressStatus, message?: string): void {
    this.deps.emit?.(Channels.EventConnectionsLoginProgress, { loginId, provider, status, message })
  }
}
