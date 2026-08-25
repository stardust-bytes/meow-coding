import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConnectionAccount, ConnectionProviderId } from '../../shared/types'

const STORE_VERSION = 1

interface ConnectionIndexDocument {
  version: number
  accounts: ConnectionAccount[]
}

function isValidAccount(raw: unknown): raw is ConnectionAccount {
  if (typeof raw !== 'object' || raw === null) return false
  const a = raw as Record<string, unknown>
  return (
    typeof a.id === 'string' && a.id !== '' &&
    (a.provider === 'codex') &&
    typeof a.displayName === 'string' &&
    typeof a.active === 'boolean' &&
    typeof a.createdAt === 'string' &&
    (a.status === 'ready' || a.status === 'refreshing' || a.status === 'expired' || a.status === 'error')
  )
}

// Metadata-only account index under userData/connections. Secrets never touch
// this file; they live in the encrypted Vault (safeStorage) instead.
export class ConnectionStore {
  constructor(private readonly file: string) {}

  list(provider: ConnectionProviderId): ConnectionAccount[] {
    return this.load().accounts.filter(a => a.provider === provider)
  }

  get(provider: ConnectionProviderId, id: string): ConnectionAccount | undefined {
    return this.load().accounts.find(a => a.provider === provider && a.id === id)
  }

  upsert(account: ConnectionAccount): void {
    const doc = this.load()
    const index = doc.accounts.findIndex(a => a.provider === account.provider && a.id === account.id)
    if (account.active) {
      for (const a of doc.accounts) {
        if (a.provider === account.provider && a.id !== account.id) a.active = false
      }
    }
    if (index >= 0) doc.accounts[index] = account
    else doc.accounts.push(account)
    this.save(doc)
  }

  setActive(provider: ConnectionProviderId, id: string): void {
    const doc = this.load()
    const now = new Date().toISOString()
    for (const a of doc.accounts) {
      if (a.provider !== provider) continue
      a.active = a.id === id
      if (a.active) a.lastUsedAt = now
    }
    this.save(doc)
  }

  remove(provider: ConnectionProviderId, id: string): void {
    const doc = this.load()
    doc.accounts = doc.accounts.filter(a => !(a.provider === provider && a.id === id))
    this.save(doc)
  }

  private load(): ConnectionIndexDocument {
    if (!existsSync(this.file)) return { version: STORE_VERSION, accounts: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ConnectionIndexDocument>
      const accounts = Array.isArray(parsed.accounts)
        ? (parsed.accounts as unknown[]).filter(isValidAccount)
        : []
      return { version: STORE_VERSION, accounts }
    } catch {
      return { version: STORE_VERSION, accounts: [] }
    }
  }

  private save(doc: ConnectionIndexDocument): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, accounts: doc.accounts }, null, 2))
    renameSync(tmp, this.file)
  }
}
