import type { ConnectionAccount, ModelRef } from '../../shared/types'

// In-memory connection backend used by Playwright e2e when
// MEOW_E2E_MOCK_CONNECTIONS=1. It replaces the real OAuth/proxy wiring so the
// Providers flow is exercised without launching a browser OAuth flow or a real
// sidecar process.
export class E2EConnectionFixtures {
  private accounts: ConnectionAccount[] = []

  listAccounts(): ConnectionAccount[] {
    return this.accounts.map(a => ({ ...a }))
  }

  async connectCodex(): Promise<ConnectionAccount> {
    const account: ConnectionAccount = {
      id: 'codex-e2e-1',
      provider: 'codex',
      email: 'e2e@example.com',
      displayName: 'E2E Account',
      active: this.accounts.length === 0,
      createdAt: new Date().toISOString(),
      status: 'ready'
    }
    this.accounts.push(account)
    return { ...account }
  }

  async disconnect(accountId: string): Promise<ConnectionAccount[]> {
    this.accounts = this.accounts.filter(a => a.id !== accountId)
    if (this.accounts.length > 0 && !this.accounts.some(a => a.active)) {
      this.accounts[0].active = true
    }
    return this.listAccounts()
  }

  async setActive(accountId: string): Promise<ConnectionAccount[]> {
    for (const a of this.accounts) {
      a.active = a.id === accountId
    }
    return this.listAccounts()
  }

  async getActiveCodexModels(): Promise<ModelRef[]> {
    const active = this.accounts.find(a => a.active && a.status === 'ready')
    if (!active) return []
    return ['gpt-5.3-codex', 'gpt-5.3-codex-spark'].map(model => ({
      provider: 'codex',
      accountId: active.id,
      accountLabel: active.displayName ?? active.email ?? 'Codex',
      model
    }))
  }
}
