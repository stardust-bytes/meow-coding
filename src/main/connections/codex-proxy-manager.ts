import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

export interface CodexProxyManagerDeps {
  runtimeDir: string
  binaryPath: string
  host?: string
  spawnFn?: (cmd: string, args: string[], opts: { cwd?: string }) => ChildProcess
  portAllocator?: () => Promise<number>
  randomBytes?: (n: number) => Buffer
  fetchFn?: typeof fetch
  healthTimeoutMs?: number
  pollDelayMs?: number
}

function maskError(err: unknown, secrets: string[]): Error {
  let message = err instanceof Error ? err.message : String(err)
  for (const secret of secrets) {
    if (secret && secret.length >= 4) message = message.split(secret).join('[redacted]')
  }
  // Never leak filesystem paths of the runtime directory.
  return new Error(`[meow] Không thể khởi động proxy Codex: ${message}`)
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
  private readonly deps: Required<Pick<CodexProxyManagerDeps, 'host' | 'spawnFn' | 'portAllocator' | 'randomBytes' | 'fetchFn' | 'healthTimeoutMs' | 'pollDelayMs'>> & CodexProxyManagerDeps
  private child: ChildProcess | null = null
  private runDir: string | null = null
  private readonly endpoints = new Map<string, CodexProxyEndpoint>()
  private readonly secrets: string[] = []
  private stopping = false

  constructor(deps: CodexProxyManagerDeps) {
    this.deps = {
      host: deps.host ?? '127.0.0.1',
      spawnFn: deps.spawnFn ?? spawn,
      portAllocator: deps.portAllocator ?? findFreePort,
      randomBytes: deps.randomBytes ?? nodeRandomBytes,
      fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
      healthTimeoutMs: deps.healthTimeoutMs ?? 15_000,
      pollDelayMs: deps.pollDelayMs ?? 200,
      ...deps
    }
  }

  async start(accounts: Array<{ accountId: string; tokens: OAuthTokens }>): Promise<CodexProxyEndpoint[]> {
    this.cleanupStale()
    if (accounts.length === 0) throw new Error('[meow] Không có tài khoản Codex để khởi động proxy')
    if (this.child) {
      await this.stop()
    }

    const runDir = path.join(this.deps.runtimeDir, `run-${this.deps.randomBytes(8).toString('hex')}`)
    mkdirSync(runDir, { recursive: true })
    if (process.platform !== 'win32') chmodSync(runDir, 0o700)

    const port = await this.deps.portAllocator()
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

    const args = ['--host', this.deps.host, '--port', String(port), '--config', configPath]
    let child: ChildProcess
    try {
      child = this.deps.spawnFn(this.deps.binaryPath, args, { cwd: runDir })
    } catch (err) {
      this.removeRunDir(runDir)
      throw maskError(err, this.secrets)
    }
    this.child = child
    this.runDir = runDir

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })

    // Wait for all account ports to become healthy, or fail fast on exit.
    const healthTimeout = setTimeout(() => {
      child.kill()
    }, this.deps.healthTimeoutMs)

    try {
      for (const acc of sidecarAccounts) {
        const accountPort = port + sidecarAccounts.indexOf(acc)
        await Promise.race([
          this.waitHealthy(accountPort),
          exited.then(() => { throw new Error('proxy sidecar exited during startup') })
        ])
        this.endpoints.set(acc.id, {
          accountId: acc.id,
          baseUrl: `http://${this.deps.host}:${accountPort}/v1`,
          apiKey: acc.credential
        })
      }
    } catch (err) {
      clearTimeout(healthTimeout)
      child.kill()
      await this.stop()
      throw maskError(err, this.secrets)
    }
    clearTimeout(healthTimeout)

    return accounts.map(a => this.endpoints.get(a.accountId)!)
  }

  getEndpoint(accountId: string): CodexProxyEndpoint | null {
    return this.endpoints.get(accountId) ?? null
  }

  /** Controlled restart with updated tokens for the given account set. */
  async refreshAccounts(accounts: Array<{ accountId: string; tokens: OAuthTokens }>): Promise<CodexProxyEndpoint[]> {
    await this.stop()
    return this.start(accounts)
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (child) {
      this.stopping = true
      child.kill()
      await new Promise<void>(resolve => {
        const done = () => resolve()
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('exit', done)
        child.once('error', done)
        setTimeout(done, 2000).unref()
      })
      this.stopping = false
    }
    if (this.runDir) {
      this.removeRunDir(this.runDir)
      this.runDir = null
    }
    this.endpoints.clear()
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
