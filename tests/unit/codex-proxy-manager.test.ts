import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexProxyManager } from '../../src/main/connections/codex-proxy-manager'
import type { OAuthTokens } from '../../src/main/connections/types'

function tokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides
  }
}

interface FakeChild extends EventEmitter {
  pid: number
  killed: boolean
  kill: ReturnType<typeof vi.fn>
  stdout: EventEmitter
  stderr: EventEmitter
}

let dir = ''
let child: FakeChild | null = null
let spawnFn: ReturnType<typeof vi.fn>
let portSeq = 40000

function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild
  c.pid = 12345
  c.killed = false
  c.kill = vi.fn(() => { c.killed = true; return true })
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  return c
}

function makeManager(overrides: Partial<ConstructorParameters<typeof CodexProxyManager>[0]> = {}) {
  return new CodexProxyManager({
    runtimeDir: path.join(dir, 'runtime'),
    binaryPath: path.join('sidecars', 'meow-cliproxy', 'bin', 'meow-cliproxy.exe'),
    spawnFn: spawnFn as unknown as (cmd: string, args: string[], opts: { cwd?: string }) => unknown,
    portAllocator: async () => portSeq++,
    fetchFn: async () => new Response('{"status":"ok"}', { status: 200 }) as unknown as Response,
    ...overrides
  })
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-proxy-'))
  child = null
  spawnFn = vi.fn(() => {
    child = makeChild()
    return child
  })
  portSeq = 40000
})

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('CodexProxyManager', () => {
  it('starts the sidecar with loopback arguments and a runtime config', async () => {
    const manager = makeManager()
    const endpoints = await manager.start([
      { accountId: 'acct-a', tokens: tokens() }
    ])
    expect(endpoints).toHaveLength(1)
    expect(spawnFn).toHaveBeenCalledWith(
      expect.stringContaining('meow-cliproxy'),
      expect.arrayContaining(['--host', '127.0.0.1']),
      expect.anything()
    )
    const args = spawnFn.mock.calls[0][1] as string[]
    expect(args).toContain('--config')
  })

  it('issues distinct local credentials for two accounts', async () => {
    const manager = makeManager()
    const endpoints = await manager.start([
      { accountId: 'acct-a', tokens: tokens() },
      { accountId: 'acct-b', tokens: tokens({ accessToken: 'access-token-b' }) }
    ])
    const a = manager.getEndpoint('acct-a')!
    const b = manager.getEndpoint('acct-b')!
    expect(a.apiKey).not.toBe(b.apiKey)
    expect(a.baseUrl).not.toBe(b.baseUrl)
    expect(a.baseUrl).toContain('127.0.0.1')
  })

  it('writes an account-scoped credential mapping', async () => {
    const manager = makeManager()
    await manager.start([
      { accountId: 'acct-a', tokens: tokens() },
      { accountId: 'acct-b', tokens: tokens({ accessToken: 'access-token-b' }) }
    ])
    const configPath = spawnFn.mock.calls[0][1].find((a: string) => a === '--config')
    const configArgIndex = spawnFn.mock.calls[0][1].indexOf('--config')
    const cfg = JSON.parse(readFileSync(spawnFn.mock.calls[0][1][configArgIndex + 1], 'utf8'))
    const credentials = cfg.accounts.map((a: { credential: string; id: string }) => a.credential)
    expect(new Set(credentials).size).toBe(2)
    for (const acc of cfg.accounts as Array<{ id: string; credential: string }>) {
      expect(acc.credential).toBeTruthy()
      expect(acc.id).toMatch(/^acct-[ab]$/)
    }
  })

  it('keeps tokens inside the restricted runtime directory only', async () => {
    const manager = makeManager()
    await manager.start([
      { accountId: 'acct-a', tokens: tokens() },
      { accountId: 'acct-b', tokens: tokens({ accessToken: 'access-token-b' }) }
    ])
    const configArgIndex = spawnFn.mock.calls[0][1].indexOf('--config')
    const configPath = spawnFn.mock.calls[0][1][configArgIndex + 1]
    const runDir = path.dirname(configPath)
    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('access-token')
    // Nothing outside the run dir (userData root) may contain token material.
    for (const file of readdirSync(dir)) {
      if (file.startsWith('runtime')) continue
      const content = readFileSync(path.join(dir, file), 'utf8')
      expect(content).not.toContain('access-token')
      expect(content).not.toContain('refresh-token')
    }
    // The run dir must be created with owner-only permissions (POSIX).
    const { statSync } = require('node:fs') as typeof import('node:fs')
    if (process.platform !== 'win32') {
      expect(statSync(runDir).mode & 0o077).toBe(0)
    }
  })

  it('uses a fresh random runtime directory and cleans stale ones', async () => {
    const stale = path.join(dir, 'runtime', 'run-stale-1')
    const { mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(stale, { recursive: true })
    const manager = makeManager()
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    const configArgIndex = spawnFn.mock.calls[0][1].indexOf('--config')
    const configPath = spawnFn.mock.calls[0][1][configArgIndex + 1]
    const runDir = path.dirname(configPath)
    expect(runDir).not.toContain('run-stale-1')
    expect(runDir).toMatch(/run-[a-zA-Z0-9_-]+$/)
    expect(existsSync(stale)).toBe(false)
  })

  it('masks credentials and paths in emitted errors', async () => {
    const badSpawn = vi.fn(() => {
      const c = makeChild()
      process.nextTick(() => c.emit('error', new Error('spawn ENOENT sidecars/meow-cliproxy/bin/meow-cliproxy.exe')))
      return c
    })
    const refusingFetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1')
    }
    const manager = makeManager({
      spawnFn: badSpawn as unknown as typeof spawnFn,
      fetchFn: refusingFetch as unknown as typeof fetch
    })
    await expect(manager.start([{ accountId: 'acct-a', tokens: tokens() }]))
      .rejects.toThrow()
    try {
      await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    } catch (err) {
      const message = String((err as Error).message)
      expect(message).not.toContain('access-token')
      expect(message).not.toContain('refresh-token')
      expect(message).not.toContain('meow-cliproxy.exe')
    }
  })

  it('refuses to serve an account that was never issued a credential', async () => {
    const manager = makeManager()
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    expect(manager.getEndpoint('acct-b')).toBeNull()
    expect(manager.getEndpoint('acct-a')!.apiKey).not.toContain('acct-b')
  })

  it('detects unexpected child exit and fails health checks', async () => {
    const refusingFetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1')
    }
    const manager = makeManager({ fetchFn: refusingFetch as unknown as typeof fetch })
    const pending = manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    // Child exits before the health check passes.
    process.nextTick(() => child?.emit('exit', 1, null))
    await expect(pending).rejects.toThrow()
  })

  it('gracefully stops: kills the child and removes the runtime directory', async () => {
    const manager = makeManager()
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    expect(child).not.toBeNull()
    await manager.stop()
    expect(child!.kill).toHaveBeenCalled()
    const configArgIndex = spawnFn.mock.calls[0][1].indexOf('--config')
    const runDir = path.dirname(spawnFn.mock.calls[0][1][configArgIndex + 1])
    expect(existsSync(runDir)).toBe(false)
  })
})
