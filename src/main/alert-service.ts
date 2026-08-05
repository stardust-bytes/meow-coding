import { EventEmitter } from 'node:events'

export interface AlertServiceConfig {
  idleThresholdMs: number
}

export const DEFAULT_ALERT_CONFIG: AlertServiceConfig = { idleThresholdMs: 5 * 60_000 }

export class AlertService extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private config: AlertServiceConfig = DEFAULT_ALERT_CONFIG) {
    super()
  }

  onOutput(agentId: string): void {
    this.resetTimer(agentId)
  }

  track(agentId: string): void {
    this.resetTimer(agentId)
  }

  onExit(agentId: string, exitCode: number): void {
    this.clearTimer(agentId)
    this.emit('exit', { agentId, exitCode })
  }

  clear(agentId: string): void {
    this.clearTimer(agentId)
  }

  private resetTimer(agentId: string): void {
    this.clearTimer(agentId)
    this.timers.set(
      agentId,
      setTimeout(() => {
        this.timers.delete(agentId)
        this.emit('idle', { agentId })
      }, this.config.idleThresholdMs)
    )
  }

  private clearTimer(agentId: string): void {
    const t = this.timers.get(agentId)
    if (t) clearTimeout(t)
    this.timers.delete(agentId)
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}
