import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export class LogManager {
  constructor(private logDir: string) {}

  private fileFor(agentId: string): string {
    return path.join(this.logDir, `${agentId}.log`)
  }

  append(agentId: string, data: string): void {
    mkdirSync(this.logDir, { recursive: true })
    appendFileSync(this.fileFor(agentId), data)
  }

  pathFor(agentId: string): string {
    return this.fileFor(agentId)
  }

  exists(agentId: string): boolean {
    return existsSync(this.fileFor(agentId))
  }
}
