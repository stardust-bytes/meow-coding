import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MIRROR_BASE = 'https://d.officecli.ai'
const GITHUB_BASE = 'https://github.com/iOfficeAI/OfficeCLI'
const DEFAULT_FETCH_TIMEOUT_MS = 30_000
const SMOKE_TEST_TIMEOUT_MS = 10_000

// Hard failure for anything that breaks verification of the downloaded artifact
// (checksum mismatch, asset not listed, failed smoke test). These abort the
// mirror→GitHub fallback loop instead of silently retrying another source.
class OfficeCliVerificationError extends Error {}

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
  fetchFn?: (url: string, init?: { redirect?: string; signal?: AbortSignal }) => Promise<FetchedResponse>
  fetchTimeoutMs?: number
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

// Normalize the filename column of sha256sum output so coreutils/GitHub-archive
// binary-mode prefixes ("*name", "\name") match the plain asset name.
function stripSumFilenamePrefix(name: string): string {
  return name.startsWith('*') || name.startsWith('\\') ? name.slice(1) : name
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

  async resolveBinaryPath(signal?: AbortSignal): Promise<string> {
    const inPath = findInPath('officecli', this.opts.env ?? process.env)
    if (inPath) return inPath
    if (existsSync(this.localPath)) return this.localPath
    await this.downloadIfNeeded(signal)
    return this.localPath
  }

  private fetch(url: string, signal?: AbortSignal): Promise<FetchedResponse> {
    const fn = this.opts.fetchFn
    const timeoutMs = this.opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    const init = { redirect: 'follow' as const, signal: abort }
    if (fn) return fn(url, init)
    return globalThis.fetch(url, init) as unknown as Promise<FetchedResponse>
  }

  private isAbortError(err: unknown): boolean {
    return (err as { name?: string })?.name === 'AbortError'
  }

  private async resolveLatestVersion(signal?: AbortSignal): Promise<string | null> {
    const bases = [`${MIRROR_BASE}/releases/latest`, `${GITHUB_BASE}/releases/latest`]
    for (const base of bases) {
      try {
        const r = await this.fetch(base, signal)
        const m = /\/releases\/tag\/(v[0-9]+\.[0-9]+\.[0-9]+)/.exec(r.url)
        if (m) return m[1]
      } catch (err) {
        if (this.isAbortError(err)) throw err
        /* try next base */
      }
    }
    return null
  }

  private async downloadIfNeeded(signal?: AbortSignal): Promise<void> {
    const asset = officecliAssetFor(this.platform, this.arch)
    if (!asset) {
      throw new Error(`officecli: unsupported platform ${this.platform}/${this.arch}`)
    }
    const version = await this.resolveLatestVersion(signal)
    if (!version) throw new Error('officecli: could not resolve latest version')
    const bases = [
      `${MIRROR_BASE}/releases/download/${version}`,
      `${GITHUB_BASE}/releases/download/${version}`
    ]
    let lastErr: unknown = new Error('officecli: download failed')
    for (const base of bases) {
      try {
        const r = await this.fetch(`${base}/${asset}`, signal)
        if (!r.ok) throw new Error(`officecli: download failed (${r.status ?? 'unknown'})`)
        const buf = Buffer.from(await r.arrayBuffer())
        const checksum = await this.checksumFor(`${base}/SHA256SUMS`, asset, signal)
        if (checksum && this.sha256Hex(buf) !== checksum.toLowerCase()) {
          throw new OfficeCliVerificationError('officecli: checksum mismatch')
        }
        mkdirSync(path.dirname(this.localPath), { recursive: true })
        const tmp = this.localPath + '.tmp'
        try {
          writeFileSync(tmp, buf)
          if (this.platform !== 'win32') chmodSync(tmp, 0o755)
          renameSync(tmp, this.localPath)
        } catch (err) {
          // Leave no stale .tmp behind if writing/chmod/rename fails.
          try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
          throw err
        }
        this.runSmokeTest()
        return
      } catch (err) {
        if (err instanceof OfficeCliVerificationError || this.isAbortError(err)) throw err
        lastErr = err
      }
    }
    throw lastErr
  }

  private sha256Hex(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex').toLowerCase()
  }

  private runSmokeTest(): void {
    const result = spawnSync(this.localPath, ['--version'], { timeout: SMOKE_TEST_TIMEOUT_MS })
    if (result.error || result.status !== 0) {
      // The binary is unusable — remove it so a broken copy is not cached.
      try { rmSync(this.localPath, { force: true }) } catch { /* ignore */ }
      throw new OfficeCliVerificationError('officecli: downloaded binary failed smoke test')
    }
  }

  private async checksumFor(url: string, asset: string, signal?: AbortSignal): Promise<string | null> {
    let r: FetchedResponse
    try {
      r = await this.fetch(url, signal)
    } catch (err) {
      if (this.isAbortError(err)) throw err
      // SUMS file unreachable → skip verification (matches upstream install.ps1).
      return null
    }
    if (!r.ok) {
      // Same treatment for a non-OK SUMS response.
      return null
    }
    let text: string
    try {
      text = await r.text()
    } catch {
      return null
    }
    for (const line of text.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 2) continue
      const name = stripSumFilenamePrefix(parts[1])
      if (name === asset) return parts[0]
    }
    // SUMS was fetched OK but does not list the asset → fail closed rather
    // than write and run an unverified binary.
    throw new OfficeCliVerificationError(`officecli: checksum file does not list ${asset}`)
  }
}
