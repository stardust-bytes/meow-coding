import { randomUUID } from 'node:crypto'
import type { ConnectionAccount, ModelRef } from '../../shared/types'
import type { Vault } from '../vault'
import type { CodexOAuth } from './codex-oauth'
import type { CodexProxyManager } from './codex-proxy-manager'
import { codexVariantOptions, parseCodexModelCatalog } from './codex-model-catalog'
import { ConnectionStore } from './connection-store'
import { connectionSecretRef } from './types'
import type { OAuthTokens } from './types'

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000

// Fallback list used when the sidecar catalog is unavailable. The proxy is
// authoritative for what an account can actually call; this list keeps the
// picker usable while the sidecar is warming up. Names must match the current
// CLIProxyAPI registry (gpt-5.3-codex/gpt-5.2 were removed upstream — the
// ChatGPT backend rejects them with "model is not supported"); image/review-only
// models (gpt-image-2, codex-auto-review) are excluded.
const CODEX_FALLBACK_MODELS = [
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna'
]

export interface ConnectionsManagerDeps {
  store: ConnectionStore
  vault: Vault
  oauth: Pick<CodexOAuth, 'authorize' | 'refreshTokens'>
  proxy: Pick<CodexProxyManager, 'start' | 'getEndpoint' | 'getModelCatalog' | 'refreshAccounts' | 'stop'>
}

export class ConnectionsManager {
  private readonly deps: ConnectionsManagerDeps
  private started = false
  private readonly refreshInFlight = new Map<string, Promise<void>>()

  constructor(deps: ConnectionsManagerDeps) {
    this.deps = deps
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
    if (!account) throw new Error('[meow] Codex account not found')
    if (account.status !== 'ready') {
      throw new Error('[meow] Codex account is not ready (token expired or refreshing)')
    }
    this.deps.store.setActive('codex', accountId)
  }

  async getActiveCodexModels(): Promise<ModelRef[]> {
    const active = this.listAccounts().find(a => a.active && a.status === 'ready')
    if (!active || !this.deps.proxy.getEndpoint(active.id)) return []
    const label = active.displayName ?? active.email ?? 'Codex'
    const catalog = parseCodexModelCatalog(this.deps.proxy.getModelCatalog())
    if (catalog.length > 0) {
      return catalog.map(({ model, variants }) => ({
        provider: 'codex',
        accountId: active.id,
        accountLabel: label,
        model,
        variants
      }))
    }
    return CODEX_FALLBACK_MODELS.map(model => ({
      provider: 'codex',
      accountId: active.id,
      accountLabel: label,
      model,
      variants: []
    }))
  }

  async getCodexVariantOptions(
    accountId: string,
    model: string,
    selectedVariant: string | undefined
  ) {
    const account = this.deps.store.get('codex', accountId)
    if (!account || !account.active || account.status !== 'ready' || !this.deps.proxy.getEndpoint(accountId)) return undefined
    const catalogModel = parseCodexModelCatalog(this.deps.proxy.getModelCatalog())
      .find(entry => entry.model === model)
    return catalogModel ? codexVariantOptions(catalogModel.variants, selectedVariant) : undefined
  }

  /** Returns the account-scoped endpoint synchronously for the chat runner. */
  getChatEndpoint(accountId: string): { baseUrl: string; apiKey: string } | null {
    const account = this.deps.store.get('codex', accountId)
    if (!account || account.status !== 'ready') {
      throw new Error('[meow] No ready Codex account. Connect an account in Providers and try again.')
    }
    const endpoint = this.deps.proxy.getEndpoint(accountId)
    if (!endpoint) {
      throw new Error('[meow] Codex proxy is not ready. Try again later.')
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

}
