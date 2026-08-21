import type { GatewayConfig, GatewayRequestLog, GatewayStatus } from '../../shared/types'
import { GatewayConfigStore } from './config'
import { GatewayLogStore } from './log-store'
import { startGatewayServer, type GatewayServerHandle } from './server'
import type { ConnectionsManager } from '../connections/manager'
import type { AccountHealth } from './router'

export interface GatewayManagerDeps {
  dir: string
  connections: ConnectionsManager
  emit?: (channel: string, payload: unknown) => void
}

// Owns the gateway lifecycle: config store, log store, health map, and the
// http server. The server only runs when enabled; changing config while
// running restarts it.
export class GatewayManager {
  private readonly configStore: GatewayConfigStore
  private readonly logStore: GatewayLogStore
  private readonly health = new Map<string, AccountHealth>()
  private server: GatewayServerHandle | null = null

  constructor(private readonly deps: GatewayManagerDeps) {
    this.configStore = new GatewayConfigStore(deps.dir)
    this.logStore = new GatewayLogStore(deps.dir)
  }

  getStatus(): GatewayStatus {
    const cfg = this.configStore.load()
    return {
      ...cfg,
      running: this.server !== null,
      actualPort: this.server?.port ?? null
    }
  }

  async saveConfig(cfg: GatewayConfig): Promise<GatewayStatus> {
    const next = this.configStore.save(cfg)
    if (next.enabled && !this.server) {
      await this.startServer(next)
    } else if (!next.enabled && this.server) {
      await this.stopServer()
    } else if (next.enabled && this.server && (next.port !== this.getStatus().port)) {
      await this.stopServer()
      await this.startServer(next)
    }
    this.deps.emit?.('gateway-changed', this.getStatus())
    return this.getStatus()
  }

  listLogs(limit?: number): GatewayRequestLog[] {
    return this.logStore.list(limit)
  }

  clearLogs(): void {
    this.logStore.clear()
  }

  async start(): Promise<void> {
    const cfg = this.configStore.load()
    if (cfg.enabled && !this.server) {
      await this.startServer(cfg)
      this.deps.emit?.('gateway-changed', this.getStatus())
    }
  }

  async stop(): Promise<void> {
    await this.stopServer()
  }

  private async startServer(cfg: GatewayConfig): Promise<void> {
    if (!cfg.apiKey) {
      throw new Error('[meow] Gateway cần đặt API key trước khi bật')
    }
    this.server = await startGatewayServer({
      getConfig: () => this.configStore.load(),
      getAccounts: () => this.gatewayScopeAccounts(),
      getSecrets: (id) => this.deps.connections.store.getSecrets(id),
      health: this.health,
      logs: this.logStore
    }, cfg.port)
  }

  private async stopServer(): Promise<void> {
    if (this.server) {
      await this.server.close()
      this.server = null
    }
  }

  // Only OpenAI-compatible accounts are routed: Codex (OAuth or API key) and
  // API-key vault entries with an OpenAI-compatible key field.
  private gatewayScopeAccounts() {
    const all = this.deps.connections.store.list()
    return all.filter(a => {
      if (a.provider === 'codex') return true
      if (a.provider === 'apikey') {
        const field = a.apiKeyField ?? ''
        return field === 'OPENAI_API_KEY' || field === 'OPENAI_COMPATIBLE' || !field
      }
      return false
    })
  }
}
