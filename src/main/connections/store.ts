import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConnectionProviderStatus, LoginStart, ProviderAccount, ProviderId } from '../../shared/types'
import { Vault } from './vault'
import type { ConnectionSecrets } from './types'

export const CONNECTION_PROVIDERS: ProviderId[] = ['claude', 'codex', 'apikey']

interface StoreIndex {
  version: string
  providers: Partial<Record<ProviderId, { activeAccountId: string | null }>>
  accountIds: string[]
}

const EMPTY_INDEX: StoreIndex = { version: '1', providers: {}, accountIds: [] }

function defaultIndex(): StoreIndex {
  const providers: StoreIndex['providers'] = {}
  for (const p of CONNECTION_PROVIDERS) providers[p] = { activeAccountId: null }
  return { ...EMPTY_INDEX, providers }
}

// One file per account (metadata only, secrets stay in the Vault), mirroring
// cockpit-tools' accounts.json + accounts/<uuid>.json layout.
export class ConnectionsStore {
  private readonly accountsDir: string
  private readonly indexFile: string

  constructor(
    private readonly dir: string,
    private readonly vault: Vault
  ) {
    this.accountsDir = path.join(dir, 'accounts')
    this.indexFile = path.join(dir, 'index.json')
  }

  list(): ProviderAccount[] {
    return this.index().accountIds
      .map(id => this.readAccount(id))
      .filter((a): a is ProviderAccount => a !== null)
  }

  listByProvider(provider: ProviderId): ProviderAccount[] {
    return this.list().filter(a => a.provider === provider)
  }

  get(id: string): ProviderAccount | null {
    return this.readAccount(id)
  }

  upsert(account: ProviderAccount): ProviderAccount {
    const idx = this.index()
    if (!idx.accountIds.includes(account.id)) idx.accountIds.push(account.id)
    this.writeIndex(idx)
    mkdirSync(this.accountsDir, { recursive: true })
    writeFileSync(this.accountFile(account.id), JSON.stringify(account, null, 2))
    return account
  }

  remove(id: string): void {
    const idx = this.index()
    idx.accountIds = idx.accountIds.filter(a => a !== id)
    for (const p of CONNECTION_PROVIDERS) {
      if (idx.providers[p]?.activeAccountId === id) idx.providers[p] = { activeAccountId: null }
    }
    this.writeIndex(idx)
    const file = this.accountFile(id)
    if (existsSync(file)) rmSync(file, { force: true })
    // Drop all vault secrets belonging to the account.
    for (const field of ['tokens', 'apiKey'] as const) {
      this.vault.deleteSecret(this.secretRef(id, field))
    }
  }

  setActive(provider: ProviderId, accountId: string): void {
    const idx = this.index()
    // Only one active account per provider.
    for (const p of CONNECTION_PROVIDERS) {
      if (p === provider) idx.providers[p] = { activeAccountId: accountId }
      else if (idx.providers[p]?.activeAccountId === accountId) idx.providers[p] = { activeAccountId: null }
    }
    this.writeIndex(idx)
  }

  activeFor(provider: ProviderId): ProviderAccount | null {
    const id = this.index().providers[provider]?.activeAccountId
    if (!id) return null
    return this.readAccount(id)
  }

  clearActive(provider: ProviderId): void {
    const idx = this.index()
    idx.providers[provider] = { activeAccountId: null }
    this.writeIndex(idx)
  }

  getSecrets(id: string): ConnectionSecrets {
    const secrets: ConnectionSecrets = {}
    const tokensRaw = this.vault.getSecret(this.secretRef(id, 'tokens'))
    if (tokensRaw) {
      try {
        secrets.tokens = JSON.parse(tokensRaw)
      } catch {
        // Corrupt entry: ignore, treat as missing.
      }
    }
    const apiKey = this.vault.getSecret(this.secretRef(id, 'apiKey'))
    if (apiKey !== null) secrets.apiKey = apiKey
    return secrets
  }

  setTokens(id: string, tokens: NonNullable<ConnectionSecrets['tokens']>): void {
    this.vault.saveSecret(this.secretRef(id, 'tokens'), JSON.stringify(tokens))
  }

  setApiKey(id: string, apiKey: string): void {
    this.vault.saveSecret(this.secretRef(id, 'apiKey'), apiKey)
  }

  statuses(pending: Partial<Record<ProviderId, LoginStart | null>>): ConnectionProviderStatus[] {
    return CONNECTION_PROVIDERS.map(provider => {
      const accounts = this.listByProvider(provider)
      const active = this.index().providers[provider]?.activeAccountId ?? null
      const login = pending[provider] ?? null
      return { provider, accounts, activeAccountId: active && accounts.some(a => a.id === active) ? active : null, login }
    })
  }

  private secretRef(id: string, field: string): string {
    return `conn:${id}:${field}`
  }

  private accountFile(id: string): string {
    return path.join(this.accountsDir, `${id}.json`)
  }

  private readAccount(id: string): ProviderAccount | null {
    const file = this.accountFile(id)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as ProviderAccount
    } catch {
      return null
    }
  }

  private index(): StoreIndex {
    if (!existsSync(this.indexFile)) return defaultIndex()
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf-8')) as Partial<StoreIndex>
      const merged = defaultIndex()
      if (Array.isArray(parsed.accountIds)) merged.accountIds = parsed.accountIds
      for (const p of CONNECTION_PROVIDERS) {
        if (parsed.providers?.[p]) merged.providers[p] = parsed.providers[p]!
      }
      return merged
    } catch {
      return defaultIndex()
    }
  }

  private writeIndex(idx: StoreIndex): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.indexFile, JSON.stringify(idx, null, 2))
  }
}
