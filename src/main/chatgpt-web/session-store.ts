import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export interface ChatGptWebConfig {
  enabled: boolean
  chromeExecutablePath?: string
}

export interface ChatGptWebVerifiedMarker {
  authenticated: boolean
  verifiedAt: string
}

const DEFAULT_CONFIG: ChatGptWebConfig = { enabled: false, chromeExecutablePath: undefined }

export class ChatGptWebSessionStore {
  constructor(private readonly dir: string) {}

  private configPath(): string {
    return path.join(this.dir, 'config.json')
  }

  private verifiedPath(): string {
    return path.join(this.dir, 'storage-state.verified.json')
  }

  storageStatePath(): string {
    return path.join(this.dir, 'storage-state.json')
  }

  userDataDir(): string {
    return this.dir
  }

  loadConfig(): ChatGptWebConfig {
    if (!existsSync(this.configPath())) return { ...DEFAULT_CONFIG }
    try {
      const parsed = JSON.parse(readFileSync(this.configPath(), 'utf-8'))
      return { enabled: Boolean(parsed.enabled), chromeExecutablePath: parsed.chromeExecutablePath || undefined }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  saveConfig(cfg: ChatGptWebConfig): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.configPath(), JSON.stringify(cfg, null, 2))
  }

  readVerifiedMarker(): ChatGptWebVerifiedMarker | null {
    if (!existsSync(this.verifiedPath())) return null
    try {
      return JSON.parse(readFileSync(this.verifiedPath(), 'utf-8'))
    } catch {
      return null
    }
  }

  writeVerifiedMarker(marker: ChatGptWebVerifiedMarker): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.verifiedPath(), JSON.stringify(marker, null, 2))
  }

  clearSession(): void {
    for (const p of [this.storageStatePath(), this.verifiedPath()]) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
  }
}
