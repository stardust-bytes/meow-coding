import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const treeKillMock = vi.hoisted(() => vi.fn())
vi.mock('tree-kill', () => ({ default: treeKillMock }))

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
  exitCode: number | null
  signalCode: NodeJS.Signals | null
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
  c.exitCode = null
  c.signalCode = null
  c.kill = vi.fn(() => {
    c.killed = true
    setImmediate(() => c.emit('exit', 0, null))
    return true
  })
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  return c
}

function makeManager(overrides: Partial<ConstructorParameters<typeof CodexProxyManager>[0]> = {}) {
  const binaryPath = path.join(dir, 'meow-cliproxy' + (process.platform === 'win32' ? '.exe' : ''))
  writeFileSync(binaryPath, 'fake-binary')
  return new CodexProxyManager({
    runtimeDir: path.join(dir, 'runtime'),
    binaryPath,
    spawnFn: spawnFn as unknown as (cmd: string, args: string[], opts: { cwd?: string }) => unknown,
    portAllocator: async (count: number) => {
      const base = portSeq
      portSeq += Math.max(count, 1)
      return base
    },
    readStatusFile: async (p) => {
      // status.json lives next to config.json; derive ports from the config.
      const cfg = JSON.parse(readFileSync(path.join(path.dirname(p), 'config.json'), 'utf8'))
      const out: Record<string, { port: number }> = {}
      cfg.accounts.forEach((a: { id: string }, i: number) => { out[a.id] = { port: cfg.port + i } })
      return out
    },
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
  treeKillMock.mockReset()
  treeKillMock.mockImplementation((pid: number, cb?: () => void) => {
    child?.emit('exit', 0, null)
    cb?.()
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

  it('loads the private catalog only after every account is healthy and clears it on stop', async () => {
    let healthy = false
    const readModelCatalogFile = vi.fn(async () => ({
      data: [{ id: 'gpt-5.6', name: 'GPT-5.6', variants: ['low', 'ultra'] }]
    }))
    const manager = makeManager({
      readStatusFile: async (p) => {
        const cfg = JSON.parse(readFileSync(path.join(path.dirname(p), 'config.json'), 'utf8'))
        return {
          [cfg.accounts[0].id]: { port: cfg.port },
          modelsPath: path.join(path.dirname(p), 'models.json')
        }
      },
      fetchFn: async () => {
        healthy = true
        return new Response('', { status: 200 })
      },
      readModelCatalogFile
    })
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    expect(healthy).toBe(true)
    expect(readModelCatalogFile).toHaveBeenCalledWith(expect.stringMatching(/models\.json$/))
    expect(manager.getModelCatalog()).toEqual({ data: [{ id: 'gpt-5.6', name: 'GPT-5.6', variants: ['low', 'ultra'] }] })
    await manager.stop()
    expect(manager.getModelCatalog()).toBeUndefined()
  })

  it('does not expose missing, malformed, or out-of-run-directory catalogs', async () => {
    const outside = path.join(dir, 'outside.json')
    const readModelCatalogFile = vi.fn(async () => ({ invalid: true }))
    const manager = makeManager({
      readStatusFile: async (p) => {
        const cfg = JSON.parse(readFileSync(path.join(path.dirname(p), 'config.json'), 'utf8'))
        return { [cfg.accounts[0].id]: { port: cfg.port }, modelsPath: outside }
      },
      readModelCatalogFile
    })
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    expect(readModelCatalogFile).not.toHaveBeenCalled()
    expect(manager.getModelCatalog()).toBeUndefined()
  })

  it('ignores malformed in-run catalog metadata and catalog reads', async () => {
    const manager = makeManager({
      readStatusFile: async (p) => {
        const cfg = JSON.parse(readFileSync(path.join(path.dirname(p), 'config.json'), 'utf8'))
        return { [cfg.accounts[0].id]: { port: cfg.port }, modelsPath: 42 }
      }
    })
    await expect(manager.start([{ accountId: 'acct-a', tokens: tokens() }])).resolves.toHaveLength(1)
    expect(manager.getModelCatalog()).toBeUndefined()

    const malformedCatalogManager = makeManager({
      readStatusFile: async (p) => {
        const cfg = JSON.parse(readFileSync(path.join(path.dirname(p), 'config.json'), 'utf8'))
        return { [cfg.accounts[0].id]: { port: cfg.port }, modelsPath: path.join(path.dirname(p), 'models.json') }
      },
      readModelCatalogFile: async () => { throw new Error('bad catalog') }
    })
    await expect(malformedCatalogManager.start([{ accountId: 'acct-a', tokens: tokens() }])).resolves.toHaveLength(1)
    expect(malformedCatalogManager.getModelCatalog()).toBeUndefined()
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

  it('gracefully stops: terminates the child and removes the runtime directory', async () => {
    const manager = makeManager()
    await manager.start([{ accountId: 'acct-a', tokens: tokens() }])
    expect(child).not.toBeNull()
    treeKillMock.mockClear()
    await manager.stop()
    if (process.platform === 'win32') {
      expect(treeKillMock).toHaveBeenCalledWith(child!.pid, expect.any(Function))
    } else {
      expect(child!.kill).toHaveBeenCalled()
    }
    const configArgIndex = spawnFn.mock.calls[0][1].indexOf('--config')
    const runDir = path.dirname(spawnFn.mock.calls[0][1][configArgIndex + 1])
    expect(existsSync(runDir)).toBe(false)
  })
})
