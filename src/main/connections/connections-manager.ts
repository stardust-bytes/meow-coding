import { randomUUID } from 'node:crypto'
import type { ConnectionAccount, ModelRef } from '../../shared/types'
import type { Vault } from '../vault'
import type { CodexOAuth } from './codex-oauth'
import type { CodexProxyEndpoint, CodexProxyManager } from './codex-proxy-manager'
import { ConnectionStore } from './connection-store'
import { connectionSecretRef } from './types'
import type { OAuthTokens } from './types'

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000

// Fallback list used when the sidecar models endpoint is unreachable. The proxy
// is authoritative for what an account can actually call; this list keeps the
// picker usable while the sidecar is warming up. Names must match the
// CLIProxyAPI v7.1.22 registry (gpt-5.2-codex/gpt-5.1-codex/codex-mini no longer
// exist there); image/review-only models are excluded.
const CODEX_FALLBACK_MODELS = [
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.2'
]

export interface ConnectionsManagerDeps {
  store: ConnectionStore
  vault: Vault
  oauth: Pick<CodexOAuth, 'authorize' | 'refreshTokens'>
  proxy: Pick<CodexProxyManager, 'start' | 'getEndpoint' | 'refreshAccounts' | 'stop'>
  fetchFn?: typeof fetch
}

export class ConnectionsManager {
  private readonly deps: Required<Pick<ConnectionsManagerDeps, 'fetchFn'>> & ConnectionsManagerDeps
  private started = false
  private readonly refreshInFlight = new Map<string, Promise<void>>()

  constructor(deps: ConnectionsManagerDeps) {
    this.deps = { fetchFn: deps.fetchFn ?? fetch.bind(globalThis), ...deps }
  }

  async init(): Promise<void> {
    const accounts = this.deps.store.list('codex')
    if (accounts.length === 0) return
    await this.startProxy(accounts)
    for (const account of accounts) {
      void this.ensureFresh(account.id)
    }
  }

  listAccounts(): ConnectionAccount[] {
    return this.deps.store.list('codex')
  }

  async connectCodex(): Promise<ConnectionAccount> {
    const result = await this.deps.oauth.authorize()
    const existing = this.listAccounts().find(a => a.email === result.email)
    const id = existing?.id ?? `codex-${result.accountId ?? randomUUID()}`
    const tokens = result.tokens
    this.deps.vault.saveSecretObject(connectionSecretRef('codex', id), tokens)

    const accounts = this.listAccounts()
    const isFirst = accounts.length === 0
    const account: ConnectionAccount = {
      id,
      provider: 'codex',
      email: result.email,
      displayName: result.displayName,
      active: isFirst || existing?.active === true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      status: 'ready'
    }
    this.deps.store.upsert(account)
    if (isFirst) this.deps.store.setActive('codex', id)

    const fresh = this.listAccounts()
    if (this.started) {
      await this.deps.proxy.refreshAccounts(fresh.map(a => ({
        accountId: a.id,
        tokens: this.readTokens(a.id)!
      })))
    } else {
      await this.startProxy(fresh)
    }
    return this.listAccounts().find(a => a.id === id)!
  }

  async disconnect(accountId: string): Promise<void> {
    this.deps.vault.deleteSecret(connectionSecretRef('codex', accountId))
    this.deps.store.remove('codex', accountId)
    const remaining = this.listAccounts()
    if (remaining.length === 0) {
      this.started = false
      await this.deps.proxy.stop()
      return
    }
    if (!remaining.some(a => a.active)) {
      this.deps.store.setActive('codex', remaining[0].id)
    }
    await this.deps.proxy.refreshAccounts(remaining.map(a => ({
      accountId: a.id,
      tokens: this.readTokens(a.id)!
    })))
  }

  async setActive(accountId: string): Promise<void> {
    const account = this.deps.store.get('codex', accountId)
    if (!account) throw new Error('[meow] Không tìm thấy tài khoản Codex')
    if (account.status !== 'ready') {
      throw new Error('[meow] Tài khoản Codex chưa sẵn sàng (token hết hạn hoặc đang làm mới)')
    }
    this.deps.store.setActive('codex', accountId)
  }

  async getActiveCodexModels(): Promise<ModelRef[]> {
    const active = this.listAccounts().find(a => a.active && a.status === 'ready')
    if (!active) return []
    const endpoint = this.deps.proxy.getEndpoint(active.id)
    if (!endpoint) return []
    const models = await this.fetchModels(endpoint)
    const label = active.displayName ?? active.email ?? 'Codex'
    return models.map(model => ({ provider: 'codex', accountId: active.id, accountLabel: label, model }))
  }

  /** Returns the account-scoped endpoint synchronously for the chat runner. */
  getChatEndpoint(accountId: string): { baseUrl: string; apiKey: string } | null {
    const account = this.deps.store.get('codex', accountId)
    if (!account || account.status !== 'ready') {
      throw new Error('[meow] Không có tài khoản Codex sẵn sàng. Kết nối tài khoản trong Providers rồi thử lại.')
    }
    const endpoint = this.deps.proxy.getEndpoint(accountId)
    if (!endpoint) {
      throw new Error('[meow] Proxy Codex chưa sẵn sàng. Thử lại sau.')
    }
    void this.ensureFresh(accountId)
    return { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey }
  }

  /** Refreshes the access token when it expires within the conservative window. */
  async ensureFresh(accountId: string): Promise<void> {
    const existing = this.refreshInFlight.get(accountId)
    if (existing) return existing
    const run = this.doEnsureFresh(accountId).finally(() => {
      this.refreshInFlight.delete(accountId)
    })
    this.refreshInFlight.set(accountId, run)
    return run
  }

  private async doEnsureFresh(accountId: string): Promise<void> {
    const account = this.deps.store.get('codex', accountId)
    if (!account) return
    const tokens = this.readTokens(accountId)
    if (!tokens?.refreshToken) {
      this.setStatus(accountId, 'expired', undefined)
      return
    }
    const expiresAt = Date.parse(tokens.accessTokenExpiresAt)
    if (!Number.isNaN(expiresAt) && expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_MS) return
    this.setStatus(accountId, 'refreshing', undefined)
    try {
      const refreshed = await this.deps.oauth.refreshTokens(tokens)
      this.deps.vault.saveSecretObject(connectionSecretRef('codex', accountId), refreshed)
      this.setStatus(accountId, 'ready', undefined)
      if (this.started) {
        await this.deps.proxy.refreshAccounts(this.listAccounts().map(a => ({
          accountId: a.id,
          tokens: this.readTokens(a.id)!
        })))
      }
    } catch {
      this.setStatus(accountId, 'expired', undefined)
    }
  }

  async dispose(): Promise<void> {
    this.started = false
    await this.deps.proxy.stop()
  }

  private async startProxy(accounts: ConnectionAccount[]): Promise<void> {
    const withTokens = accounts.map(a => ({ accountId: a.id, tokens: this.readTokens(a.id)! }))
    await this.deps.proxy.start(withTokens)
    this.started = true
  }

  private readTokens(accountId: string): OAuthTokens | null {
    return this.deps.vault.getSecretObject<OAuthTokens>(connectionSecretRef('codex', accountId))
  }

  private setStatus(accountId: string, status: ConnectionAccount['status'], error: string | undefined): void {
    const account = this.deps.store.get('codex', accountId)
    if (!account) return
    this.deps.store.upsert({ ...account, status, error })
  }

  private async fetchModels(endpoint: CodexProxyEndpoint): Promise<string[]> {
    try {
      const res = await this.deps.fetchFn(`${endpoint.baseUrl}/models`, {
        headers: { authorization: `Bearer ${endpoint.apiKey}` }
      })
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ id?: string }> }
        const ids = (data.data ?? []).map(m => m.id).filter((id): id is string => typeof id === 'string' && id !== '')
        if (ids.length > 0) return ids
      }
    } catch {
      // fall through to the curated list
    }
    return CODEX_FALLBACK_MODELS
  }
}
