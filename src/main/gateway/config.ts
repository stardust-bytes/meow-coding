import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GatewayConfig } from '../../shared/types'

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  enabled: false,
  port: 1480,
  apiKey: '',
  routingStrategy: 'auto',
  coldownSeconds: 300,
  quotaReservePercent: 10
}

export class GatewayConfigStore {
  constructor(private readonly dir: string) {}

  private file(): string {
    return path.join(this.dir, 'gateway.json')
  }

  load(): GatewayConfig {
    if (!existsSync(this.file())) return { ...DEFAULT_GATEWAY_CONFIG }
    try {
      const parsed = JSON.parse(readFileSync(this.file(), 'utf-8')) as Partial<GatewayConfig>
      return {
        enabled: Boolean(parsed.enabled),
        port: Number.isInteger(parsed.port) && parsed.port! > 0 ? parsed.port! : DEFAULT_GATEWAY_CONFIG.port,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        routingStrategy: parsed.routingStrategy ?? DEFAULT_GATEWAY_CONFIG.routingStrategy,
        coldownSeconds: Number.isInteger(parsed.coldownSeconds) && parsed.coldownSeconds! > 0
          ? parsed.coldownSeconds!
          : DEFAULT_GATEWAY_CONFIG.coldownSeconds,
        quotaReservePercent: Number.isInteger(parsed.quotaReservePercent) && parsed.quotaReservePercent! >= 0
          ? parsed.quotaReservePercent!
          : DEFAULT_GATEWAY_CONFIG.quotaReservePercent
      }
    } catch {
      return { ...DEFAULT_GATEWAY_CONFIG }
    }
  }

  save(cfg: GatewayConfig): GatewayConfig {
    const next: GatewayConfig = {
      enabled: Boolean(cfg.enabled),
      port: Number.isInteger(cfg.port) && cfg.port > 0 ? cfg.port : DEFAULT_GATEWAY_CONFIG.port,
      apiKey: cfg.apiKey ?? '',
      routingStrategy: cfg.routingStrategy ?? DEFAULT_GATEWAY_CONFIG.routingStrategy,
      coldownSeconds: Number.isInteger(cfg.coldownSeconds) && cfg.coldownSeconds > 0
        ? cfg.coldownSeconds
        : DEFAULT_GATEWAY_CONFIG.coldownSeconds,
      quotaReservePercent: Number.isInteger(cfg.quotaReservePercent) && cfg.quotaReservePercent >= 0
        ? cfg.quotaReservePercent
        : DEFAULT_GATEWAY_CONFIG.quotaReservePercent
    }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file(), JSON.stringify(next, null, 2))
    return next
  }
}
