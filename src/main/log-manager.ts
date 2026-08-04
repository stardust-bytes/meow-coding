import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export class LogManager {
  constructor(private logDir: string) {
    mkdirSync(this.logDir, { recursive: true })
  }

  private fileFor(agentId: string): string {
    return path.join(this.logDir, `${agentId}.log`)
  }

  append(agentId: string, data: string): void {
    try {
      appendFileSync(this.fileFor(agentId), data)
    } catch (err) {
      console.error(`[log] append failed for ${agentId}:`, err)
    }
  }

  pathFor(agentId: string): string {
    return this.fileFor(agentId)
  }

  exists(agentId: string): boolean {
    return existsSync(this.fileFor(agentId))
  }
}
