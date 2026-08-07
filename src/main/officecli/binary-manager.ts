import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MIRROR_BASE = 'https://d.officecli.ai'
const GITHUB_BASE = 'https://github.com/iOfficeAI/OfficeCLI'

export interface FetchedResponse {
  url: string
  ok: boolean
  status?: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface OfficeCliBinaryOptions {
  userDataDir: string
  env?: NodeJS.ProcessEnv
  fetchFn?: (url: string, init?: { redirect?: string }) => Promise<FetchedResponse>
  platform?: string
  arch?: string
}

export function officecliAssetFor(platform: string, arch: string): string | null {
  const map: Record<string, string> = {
    'win32-x64': 'officecli-win-x64.exe',
    'win32-arm64': 'officecli-win-arm64.exe',
    'darwin-x64': 'officecli-mac-x64',
    'darwin-arm64': 'officecli-mac-arm64',
    'linux-x64': 'officecli-linux-x64',
    'linux-arm64': 'officecli-linux-arm64'
  }
  return map[`${platform}-${arch}`] ?? null
}

export function officecliBinaryFileName(platform: string): string {
  return platform === 'win32' ? 'officecli.exe' : 'officecli'
}

export function findInPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (env.PATHEXT ?? (process.platform === 'win32' ? '.EXE;.CMD;.BAT' : ''))
    .split(';').filter(Boolean)
  const hasExt = name.includes('.')
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidates = hasExt ? [name] : [name, ...exts.map(e => name + e)]
    let entries: string[] | null = null
    for (const c of candidates) {
      const p = path.join(dir, c)
      if (existsSync(p)) {
        // On case-insensitive filesystems (Windows) existsSync also matches
        // differently-cased candidates; resolve the real on-disk entry name.
        if (entries === null) {
          try { entries = readdirSync(dir) } catch { entries = [] }
        }
        const real = entries.find(f => f.toLowerCase() === c.toLowerCase())
        return real ? path.join(dir, real) : p
      }
    }
  }
  return null
}

export class OfficeCliBinary {
  private readonly localPath: string
  private readonly platform: string
  private readonly arch: string

  constructor(private readonly opts: OfficeCliBinaryOptions) {
    this.platform = opts.platform ?? process.platform
    this.arch = opts.arch ?? process.arch
    this.localPath = path.join(opts.userDataDir, 'officecli', officecliBinaryFileName(this.platform))
  }

  async resolveBinaryPath(): Promise<string> {
    const inPath = findInPath('officecli', this.opts.env ?? process.env)
    if (inPath) return inPath
    if (existsSync(this.localPath)) return this.localPath
    await this.downloadIfNeeded()
    return this.localPath
  }

  private fetch(url: string): Promise<FetchedResponse> {
    const fn = this.opts.fetchFn
    if (fn) return fn(url, { redirect: 'follow' })
    return globalThis.fetch(url, { redirect: 'follow' }) as unknown as Promise<FetchedResponse>
  }

  private async resolveLatestVersion(): Promise<string | null> {
    const bases = [`${MIRROR_BASE}/releases/latest`, `${GITHUB_BASE}/releases/latest`]
    for (const base of bases) {
      try {
        const r = await this.fetch(base)
        const m = /\/releases\/tag\/(v[0-9]+\.[0-9]+\.[0-9]+)/.exec(r.url)
        if (m) return m[1]
      } catch { /* try next base */ }
    }
    return null
  }

  private async downloadIfNeeded(): Promise<void> {
    const asset = officecliAssetFor(this.platform, this.arch)
    if (!asset) {
      throw new Error(`officecli: unsupported platform ${this.platform}/${this.arch}`)
    }
    const version = await this.resolveLatestVersion()
    if (!version) throw new Error('officecli: could not resolve latest version')
    const bases = [
      `${MIRROR_BASE}/releases/download/${version}`,
      `${GITHUB_BASE}/releases/download/${version}`
    ]
    let lastErr: unknown = new Error('officecli: download failed')
    for (const base of bases) {
      try {
        const r = await this.fetch(`${base}/${asset}`)
        if (!r.ok) throw new Error(`officecli: download failed (${r.status ?? 'unknown'})`)
        const buf = Buffer.from(await r.arrayBuffer())
        const checksum = await this.checksumFor(`${base}/SHA256SUMS`, asset)
        if (
          checksum &&
          createHash('sha256').update(buf).digest('hex').toLowerCase() !== checksum.toLowerCase()
        ) {
          throw new Error('officecli: checksum mismatch')
        }
        mkdirSync(path.dirname(this.localPath), { recursive: true })
        const tmp = this.localPath + '.tmp'
        writeFileSync(tmp, buf)
        if (this.platform !== 'win32') chmodSync(tmp, 0o755)
        renameSync(tmp, this.localPath)
        return
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }

  private async checksumFor(url: string, asset: string): Promise<string | null> {
    try {
      const r = await this.fetch(url)
      if (!r.ok) return null
      const text = await r.text()
      for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2 && parts[1] === asset) return parts[0]
      }
      return null
    } catch {
      return null
    }
  }
}
