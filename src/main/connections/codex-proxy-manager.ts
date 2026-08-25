import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import treeKill from 'tree-kill'
import { randomBytes as nodeRandomBytes } from 'node:crypto'
import path from 'node:path'
import type { OAuthTokens } from './types'

export interface CodexProxyEndpoint {
  accountId: string
  /** OpenAI-compatible base URL for the account-scoped proxy. */
  baseUrl: string
  /** Local credential accepted only for this account. */
  apiKey: string
}

interface SidecarAccount {
  id: string
  credential: string
  tokens: OAuthTokens
}

interface SidecarConfig {
  host: string
  port: number
  accounts: SidecarAccount[]
}

interface SidecarStatus {
  modelsPath?: string
  [key: string]: unknown
}

function isStatusEntry(value: unknown): value is { port: number } {
  return typeof value === 'object' && value !== null &&
    typeof (value as { port?: unknown }).port === 'number'
}

function isModelCatalog(value: unknown): value is { data: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { data?: unknown }).data)
}

export interface CodexProxyManagerDeps {
  runtimeDir: string
  binaryPath: string
  host?: string
  spawnFn?: (cmd: string, args: string[], opts: { cwd?: string }) => ChildProcess
  portAllocator?: (count: number) => Promise<number>
  randomBytes?: (n: number) => Buffer
  fetchFn?: typeof fetch
  readStatusFile?: (path: string) => Promise<SidecarStatus>
  readModelCatalogFile?: (path: string) => Promise<unknown>
  healthTimeoutMs?: number
  pollDelayMs?: number
}

function maskError(err: unknown, secrets: string[], paths: string[] = []): Error {
  let message = err instanceof Error ? err.message : String(err)
  for (const secret of secrets) {
    if (secret && secret.length >= 4) message = message.split(secret).join('[redacted]')
  }
  // Never leak runtime directory paths (they are random per launch).
  for (const p of paths) {
    if (p) message = message.split(p).join('[redacted]')
  }
  return new Error(`[meow] Không thể khởi động proxy Codex: ${message}`)
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

async function findFreePorts(count: number): Promise<number> {
  for (let attempt = 0; attempt < 32; attempt++) {
    // Ask the OS for an ephemeral port, then verify the contiguous range the
    // sidecar will bind (port + i per account).
    const base = await findFreePort()
    let allFree = true
    for (let i = 0; i < count; i++) {
      if (!(await isPortFree(base + i))) {
        allFree = false
        break
      }
    }
    if (allFree) return base
  }
  throw new Error('no contiguous free port range available')
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('no free port')))
      }
    })
  })
}

export class CodexProxyManager {
  private readonly deps: Required<Pick<CodexProxyManagerDeps, 'host' | 'spawnFn' | 'portAllocator' | 'randomBytes' | 'fetchFn' | 'readStatusFile' | 'readModelCatalogFile' | 'healthTimeoutMs' | 'pollDelayMs'>> & CodexProxyManagerDeps
  private child: ChildProcess | null = null
  private runDir: string | null = null
  private readonly endpoints = new Map<string, CodexProxyEndpoint>()
  private modelCatalog: unknown | undefined
  private readonly secrets: string[] = []
  private stopping = false

  constructor(deps: CodexProxyManagerDeps) {
    this.deps = {
      host: deps.host ?? '127.0.0.1',
      spawnFn: deps.spawnFn ?? spawn,
      portAllocator: deps.portAllocator ?? findFreePorts,
      randomBytes: deps.randomBytes ?? nodeRandomBytes,
      fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
      readStatusFile: deps.readStatusFile ?? (async (p) =>
        JSON.parse(readFileSync(p, 'utf8')) as SidecarStatus),
      readModelCatalogFile: deps.readModelCatalogFile ?? (async (p) => JSON.parse(readFileSync(p, 'utf8')) as unknown),
      healthTimeoutMs: deps.healthTimeoutMs ?? 15_000,
      pollDelayMs: deps.pollDelayMs ?? 200,
      ...deps
    }
  }

  async start(accounts: Array<{ accountId: string; tokens: OAuthTokens }>): Promise<CodexProxyEndpoint[]> {
    this.cleanupStale()
    this.modelCatalog = undefined
    if (accounts.length === 0) throw new Error('[meow] Không có tài khoản Codex để khởi động proxy')
    if (this.child) {
      await this.stop()
    }

    if (!existsSync(this.deps.binaryPath)) {
      throw new Error('[meow] Không tìm thấy proxy Codex. Trong môi trường dev, chạy `npm run build:cliproxy`; bản cài đặt chính thức đã kèm sẵn.')
    }

    const runDir = path.join(this.deps.runtimeDir, `run-${this.deps.randomBytes(8).toString('hex')}`)
    mkdirSync(runDir, { recursive: true })
    if (process.platform !== 'win32') chmodSync(runDir, 0o700)

    // The sidecar binds port + i per account, so reserve a contiguous range.
    const port = await this.deps.portAllocator(accounts.length)
    const sidecarAccounts: SidecarAccount[] = accounts.map((account, i) => ({
      id: account.accountId,
      credential: this.deps.randomBytes(32).toString('base64url'),
      tokens: account.tokens
    }))
    this.secrets.length = 0
    for (const acc of sidecarAccounts) {
      this.secrets.push(acc.credential, acc.tokens.accessToken, acc.tokens.refreshToken ?? '')
    }

    const config: SidecarConfig = { host: this.deps.host, port, accounts: sidecarAccounts }
    const configPath = path.join(runDir, 'config.json')
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
    const statusPath = path.join(runDir, 'status.json')

    const args = ['--host', this.deps.host, '--port', String(port), '--config', configPath, '--status', statusPath]
    let child: ChildProcess
    try {
      child = this.deps.spawnFn(this.deps.binaryPath, args, { cwd: runDir })
    } catch (err) {
      this.removeRunDir(runDir)
      throw maskError(err, this.secrets, [runDir, configPath])
    }
    this.child = child
    this.runDir = runDir

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })

    const healthTimeout = setTimeout(() => {
      child.kill()
    }, this.deps.healthTimeoutMs)

    try {
      // The sidecar writes status.json only after every account is healthy; the
      // reported ports are the ones it actually bound, so we never route to a
      // port owned by another process.
      const status = await Promise.race([
        this.waitForStatusFile(statusPath),
        exited.then(() => { throw new Error('proxy sidecar exited during startup') })
      ])
      for (const acc of sidecarAccounts) {
        const reported = status[acc.id]
        if (!isStatusEntry(reported)) throw new Error(`proxy did not report a port for account ${acc.id}`)
        await Promise.race([
          this.waitHealthy(reported.port),
          exited.then(() => { throw new Error('proxy sidecar exited during startup') })
        ])
        this.endpoints.set(acc.id, {
          accountId: acc.id,
          baseUrl: `http://${this.deps.host}:${reported.port}/v1`,
          apiKey: acc.credential
        })
      }
      await this.loadModelCatalog(status.modelsPath, runDir)
    } catch (err) {
      clearTimeout(healthTimeout)
      child.kill()
      await this.stop()
      throw maskError(err, this.secrets, [runDir, configPath, statusPath])
    }
    clearTimeout(healthTimeout)

    return accounts.map(a => this.endpoints.get(a.accountId)!)
  }

  private async loadModelCatalog(modelsPath: unknown, runDir: string): Promise<void> {
    if (typeof modelsPath !== 'string' || !modelsPath || !this.isWithinRunDir(modelsPath, runDir)) return
    try {
      const catalog = await this.deps.readModelCatalogFile(modelsPath)
      this.modelCatalog = isModelCatalog(catalog) ? catalog : undefined
    } catch {
      this.modelCatalog = undefined
    }
  }

  private isWithinRunDir(candidate: string, runDir: string): boolean {
    const relative = path.relative(path.resolve(runDir), path.resolve(candidate))
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
  }

  private async waitForStatusFile(statusPath: string): Promise<SidecarStatus> {
    const deadline = Date.now() + this.deps.healthTimeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        const status = await this.deps.readStatusFile(statusPath)
        if (status && Object.keys(status).length > 0) return status
      } catch (err) {
        lastError = err
      }
      await new Promise(r => setTimeout(r, this.deps.pollDelayMs))
    }
    throw lastError ?? new Error('proxy status file was not written in time')
  }

  getEndpoint(accountId: string): CodexProxyEndpoint | null {
    return this.endpoints.get(accountId) ?? null
  }

  getModelCatalog(): unknown | undefined {
    return this.modelCatalog
  }

  /** Controlled restart with updated tokens for the given account set. */
  async refreshAccounts(accounts: Array<{ accountId: string; tokens: OAuthTokens }>): Promise<CodexProxyEndpoint[]> {
    await this.stop()
    return this.start(accounts)
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (child && child.pid) {
      this.stopping = true
      await new Promise<void>(resolve => {
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          child.removeListener('exit', done)
          child.removeListener('error', done)
          resolve()
        }
        if (child.exitCode !== null || child.signalCode !== null) return done()
        child.once('exit', done)
        child.once('error', done)
        const timer = setTimeout(done, 2000)
        timer.unref()
        // On Windows a plain kill() does not terminate the process tree; match
        // the repo-wide tree-kill convention used by pty-manager.
        const pid = child.pid
        if (process.platform === 'win32' && pid) {
          treeKill(pid, () => {})
        } else {
          child.kill('SIGTERM')
        }
      })
      this.stopping = false
    }
    if (this.runDir) {
      this.removeRunDir(this.runDir)
      this.runDir = null
    }
    this.endpoints.clear()
    this.modelCatalog = undefined
  }

  private async waitHealthy(port: number): Promise<void> {
    const url = `http://${this.deps.host}:${port}/healthz`
    const deadline = Date.now() + this.deps.healthTimeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.deps.fetchFn(url)
        if (res.ok) return
      } catch {
        // keep polling
      }
      await new Promise(r => setTimeout(r, this.deps.pollDelayMs))
    }
    throw new Error('proxy sidecar did not become healthy in time')
  }

  private cleanupStale(): void {
    if (!existsSync(this.deps.runtimeDir)) return
    for (const entry of readdirSafe(this.deps.runtimeDir)) {
      if (entry.startsWith('run-')) {
        rmSync(path.join(this.deps.runtimeDir, entry), { recursive: true, force: true })
      }
    }
  }

  private removeRunDir(runDir: string): void {
    try {
      rmSync(runDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup; stale dirs are removed at next launch
    }
  }
}

function readdirSafe(dir: string): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
