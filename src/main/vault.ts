import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Encrypted secret store backed by Electron safeStorage (OS keychain: DPAPI /
// Keychain / libsecret). Only the main process touches secrets; the renderer
// receives masked values only.
export class Vault {
  constructor(private readonly file: string) {}

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  saveSecret(ref: string, secret: string): void {
    if (!this.isAvailable()) {
      throw new Error('[meow] Could not encrypt the key: safeStorage is not available on this machine')
    }
    const map = this.load()
    map[ref] = safeStorage.encryptString(secret).toString('base64')
    this.save(map)
  }

  saveSecretObject(ref: string, secret: unknown): void {
    this.saveSecret(ref, JSON.stringify(secret))
  }

  getSecret(ref: string): string | null {
    const entry = this.load()[ref]
    if (!entry) return null
    try {
      return safeStorage.decryptString(Buffer.from(entry, 'base64')).toString()
    } catch {
      return null
    }
  }

  getSecretObject<T>(ref: string): T | null {
    const raw = this.getSecret(ref)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  hasSecret(ref: string): boolean {
    return ref in this.load()
  }

  deleteSecret(ref: string): void {
    const map = this.load()
    if (!(ref in map)) return
    delete map[ref]
    this.save(map)
  }

  mask(secret: string): string {
    if (secret.length <= 8) return '••••'
    return `${secret.slice(0, 4)}…${secret.slice(-4)}`
  }

  private load(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8'))
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  private save(map: Record<string, string>): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(map, null, 2))
  }
}
