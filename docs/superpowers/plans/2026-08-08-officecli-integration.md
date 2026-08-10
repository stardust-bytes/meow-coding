# OfficeCLI Integration (native tool `office`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho native Meow agent tạo/sửa Word (.docx), Excel (.xlsx), PowerPoint (.pptx) qua một native tool mới `office` — spawn one-shot `officecli` subprocess, tự tải binary về `userData/officecli/` khi chưa có trong PATH.

**Architecture:** Thêm `OfficeCliBinary` (main process, service thuần) quản lý resolve/tải binary; thêm `officeTool` (ToolDefinition) spawn `[binary, ...args, '--json']` với cwd = project, timeout kill cả process tree. Tool đăng ký trong `createDefaultTools` khi có `getUserDataDir`; permission mặc định `office: 'ask'`. Không đổi IPC/preload/renderer.

**Tech Stack:** Electron main process (Node 20+), `node:child_process`, `tree-kill` (đã có), `zod` (đã có), Vitest. Không thêm dependency.

## Global Constraints

- Tuân theo `AGENTS.md`: không thêm comment thừa; chỉ comment khi giải thích quyết định phức tạp (VD: checksum mismatch, tree-kill timeout).
- IPC: không đổi `src/shared/ipc.ts`, preload, renderer — tool chỉ chạy trong main process.
- Tool mới phải thêm `office: 'ask'` vào `DEFAULT_MEOW_CONFIG.permission` trong `src/main/agent/config.ts`.
- Windows: `officecli` là `.exe` thật (không phải `.cmd` shim) → spawn trực tiếp, **không** bọc qua `cmd.exe`.
- Download dùng `fetch` (Node 20+, `redirect: 'follow'`); URL asset theo install.ps1 của OfficeCLI.
- Bắt buộc `npm run typecheck` pass và `npm test` pass sau mỗi task.

---

### Task 1: OfficeCliBinary — resolve & auto-download binary

**Files:**
- Create: `src/main/officecli/binary-manager.ts`
- Test: `tests/unit/officecli-binary-manager.test.ts`

**Interfaces:**
- Consumes: `node:crypto`, `node:fs`, `node:path`; không dependency ngoài.
- Produces:
  - `officecliAssetFor(platform: string, arch: string): string | null`
  - `officecliBinaryFileName(platform: string): string`
  - `findInPath(name: string, env: NodeJS.ProcessEnv): string | null`
  - `class OfficeCliBinary` với `constructor(opts: OfficeCliBinaryOptions)` và `resolveBinaryPath(): Promise<string>`
  - `interface OfficeCliBinaryOptions { userDataDir: string; env?: NodeJS.ProcessEnv; fetchFn?: (url: string, init?: { redirect?: string }) => Promise<FetchedResponse>; platform?: string; arch?: string }`
  - `interface FetchedResponse { url: string; ok: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }`

- [ ] **Step 1: Write the failing test**

`tests/unit/officecli-binary-manager.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  officecliAssetFor,
  officecliBinaryFileName,
  findInPath,
  OfficeCliBinary,
  type FetchedResponse
} from '../../src/main/officecli/binary-manager'

let dir = ''

function makeDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-officecli-'))
  return dir
}

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function res(url: string, body: string | Buffer, ok = true, status = 200): FetchedResponse {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return {
    url,
    ok,
    status,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    text: async () => buf.toString()
  }
}

function makeFetch(handlers: Record<string, (url: string) => FetchedResponse>) {
  return async (url: string): Promise<FetchedResponse> => {
    const h = handlers[url]
    if (!h) throw new Error(`unexpected fetch: ${url}`)
    return h()
  }
}

const VERSION_URL = 'https://d.officecli.ai/releases/latest'
const ASSET_NAME = 'officecli-win-x64.exe'
const ASSET_URL = `https://d.officecli.ai/releases/download/v1.2.3/${ASSET_NAME}`
const SUMS_URL = `https://d.officecli.ai/releases/download/v1.2.3/SHA256SUMS`
const BINARY_BYTES = Buffer.from('fake-officecli-binary')
const SUMS_LINE = (bytes: Buffer, name: string) => {
  const hex = createHash('sha256').update(bytes).digest('hex')
  return `${hex}  ${name}\n`
}

describe('officecliAssetFor', () => {
  it('maps known platform/arch to asset names', () => {
    expect(officecliAssetFor('win32', 'x64')).toBe('officecli-win-x64.exe')
    expect(officecliAssetFor('win32', 'arm64')).toBe('officecli-win-arm64.exe')
    expect(officecliAssetFor('darwin', 'x64')).toBe('officecli-mac-x64')
    expect(officecliAssetFor('darwin', 'arm64')).toBe('officecli-mac-arm64')
    expect(officecliAssetFor('linux', 'x64')).toBe('officecli-linux-x64')
    expect(officecliAssetFor('linux', 'arm64')).toBe('officecli-linux-arm64')
  })

  it('returns null for unsupported platforms', () => {
    expect(officecliAssetFor('freebsd', 'x64')).toBeNull()
    expect(officecliAssetFor('win32', 'mips')).toBeNull()
  })
})

describe('officecliBinaryFileName', () => {
  it('uses .exe on win32', () => {
    expect(officecliBinaryFileName('win32')).toBe('officecli.exe')
    expect(officecliBinaryFileName('linux')).toBe('officecli')
    expect(officecliBinaryFileName('darwin')).toBe('officecli')
  })
})

describe('findInPath', () => {
  it('finds an existing executable in PATH', () => {
    const dir = makeDir()
    const name = officecliBinaryFileName(process.platform)
    writeFileSync(path.join(dir, name), 'x')
    const env: NodeJS.ProcessEnv = { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT' }
    const found = findInPath('officecli', env)
    expect(found).toBe(path.join(dir, name))
  })

  it('returns null when not present', () => {
    expect(findInPath('officecli', { PATH: makeDir() })).toBeNull()
  })
})

describe('OfficeCliBinary.resolveBinaryPath', () => {
  it('returns a binary found in PATH without downloading', async () => {
    const dir = makeDir()
    const name = officecliBinaryFileName(process.platform)
    writeFileSync(path.join(dir, name), 'x')
    const fetchFn = () => { throw new Error('should not fetch') }
    const bin = new OfficeCliBinary({ userDataDir: dir, env: { PATH: dir }, fetchFn: fetchFn as never })
    expect(await bin.resolveBinaryPath()).toBe(path.join(dir, name))
  })

  it('returns a local binary under userData/officecli without downloading', async () => {
    const dir = makeDir()
    const binDir = path.join(dir, 'officecli')
    const localPath = path.join(binDir, officecliBinaryFileName('win32'))
    writeFileSync(localPath, 'local')
    const fetchFn = () => { throw new Error('should not fetch') }
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', fetchFn: fetchFn as never })
    expect(await bin.resolveBinaryPath()).toBe(localPath)
  })

  it('downloads, verifies checksum and writes the binary', async () => {
    const dir = makeDir()
    const fetchFn = makeFetch({
      [VERSION_URL]: () => res('https://d.officecli.ai/releases/tag/v1.2.3', ''),
      [ASSET_URL]: () => res(ASSET_URL, BINARY_BYTES),
      [SUMS_URL]: () => res(SUMS_URL, SUMS_LINE(BINARY_BYTES, ASSET_NAME))
    })
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    const resolved = await bin.resolveBinaryPath()
    const localPath = path.join(dir, 'officecli', 'officecli.exe')
    expect(resolved).toBe(localPath)
    expect(existsSync(localPath)).toBe(true)
    expect(readFileSync(localPath)).toEqual(BINARY_BYTES)
  })

  it('throws and keeps no binary when checksum mismatches', async () => {
    const dir = makeDir()
    const fetchFn = makeFetch({
      [VERSION_URL]: () => res('https://d.officecli.ai/releases/tag/v1.2.3', ''),
      [ASSET_URL]: () => res(ASSET_URL, BINARY_BYTES),
      [SUMS_URL]: () => res(SUMS_URL, '0000000000000000000000000000000000000000000000000000000000000000  officecli-win-x64.exe\n')
    })
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    await expect(bin.resolveBinaryPath()).rejects.toThrow()
    expect(existsSync(path.join(dir, 'officecli', 'officecli.exe'))).toBe(false)
  })

  it('fails when no version can be resolved', async () => {
    const dir = makeDir()
    const fetchFn = async (url: string) => {
      if (url === VERSION_URL) return res('https://d.officecli.ai/somewhere', '', false, 404)
      throw new Error(`unexpected fetch: ${url}`)
    }
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    await expect(bin.resolveBinaryPath()).rejects.toThrow(/version/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/officecli-binary-manager.test.ts`
Expected: FAIL — module `officecli-binary-manager` not found.

- [ ] **Step 3: Write minimal implementation**

`src/main/officecli/binary-manager.ts`:

```ts
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
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
    for (const c of candidates) {
      const p = path.join(dir, c)
      if (existsSync(p)) return p
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/officecli-binary-manager.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/officecli/binary-manager.ts tests/unit/officecli-binary-manager.test.ts
git commit -m "feat(officecli): binary manager that resolves or auto-downloads officecli"
```

---

### Task 2: `office` native tool — spawn one-shot subprocess

**Files:**
- Create: `src/main/agent/tools/office.ts`
- Test: `tests/unit/agent-tools-office.test.ts`

**Interfaces:**
- Consumes: `OfficeCliBinary` từ Task 1 (qua `resolveBinary` được inject); `ToolDefinition`/`ToolContext` từ `./types`; `tree-kill`.
- Produces:
  - `buildOfficeArgs(args: string[]): string[]` — thêm `--json` nếu chưa có.
  - `createOfficeTool(deps: { resolveBinary: () => Promise<string>; spawnFn?: typeof spawn }): ToolDefinition`
  - Tool `name: 'office'`, schema zod `{ args: string[], timeoutMs?: number }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/agent-tools-office.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createOfficeTool, buildOfficeArgs } from '../../src/main/agent/tools/office'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir = ''
afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function ctx(): ToolContext {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-office-tool-'))
  return { cwd: dir, ask: async () => null }
}

function fakeChild(opts: { stdout?: string; stderr?: string; code?: number; never?: boolean }) {
  const child: any = new EventEmitter()
  child.pid = 1234
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  setTimeout(() => {
    if (opts.never) return
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    child.emit('close', opts.code ?? 0)
  }, 0)
  return child
}

describe('buildOfficeArgs', () => {
  it('appends --json when missing', () => {
    expect(buildOfficeArgs(['create', 'report.docx'])).toEqual(['create', 'report.docx', '--json'])
  })
  it('does not duplicate --json', () => {
    expect(buildOfficeArgs(['get', 'report.docx', '--json'])).toEqual(['get', 'report.docx', '--json'])
  })
})

describe('office tool', () => {
  it('spawns the resolved binary with args in ctx.cwd and returns stdout', async () => {
    let spawnCall: { bin: string; args: string[]; opts: { cwd: string } } | undefined
    const tool = createOfficeTool({
      resolveBinary: async () => '/fake/officecli',
      spawnFn: ((bin: string, args: string[], opts: { cwd: string }) => {
        spawnCall = { bin, args, opts }
        return fakeChild({ stdout: '{"success":true}' })
      }) as never
    })
    const r = await tool.run({ args: ['create', 'deck.pptx'] }, ctx())
    expect(r.output).toBe('{"success":true}')
    expect(spawnCall?.bin).toBe('/fake/officecli')
    expect(spawnCall?.args).toEqual(['create', 'deck.pptx', '--json'])
    expect(spawnCall?.opts.cwd).toBe(dir)
  })

  it('reports a nonzero exit with stdout and stderr', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => 'officecli',
      spawnFn: (() => fakeChild({
        stdout: '{"success":false,"error":{"code":"not_found"}}',
        stderr: 'boom',
        code: 1
      })) as never
    })
    const r = await tool.run({ args: ['get', 'x.docx', '/p[99]'] }, ctx())
    expect(r.error).toMatch(/exit code 1/)
    expect(r.error).toContain('not_found')
    expect(r.error).toContain('boom')
  })

  it('times out and kills the process tree', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => 'officecli',
      spawnFn: (() => fakeChild({ never: true })) as never
    })
    const r = await tool.run({ args: ['create', 'x.pptx'], timeoutMs: 100 }, ctx())
    expect(r.error).toMatch(/timeout/)
  }, 5000)

  it('returns a helpful error when the binary cannot be resolved', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => { throw new Error('officecli: download failed') }
    })
    const r = await tool.run({ args: ['create', 'x.docx'] }, ctx())
    expect(r.error).toMatch(/cannot locate officecli binary/)
  })

  it('rejects a missing args field', async () => {
    const tool = createOfficeTool({ resolveBinary: async () => 'officecli' })
    const r = await tool.run({}, ctx())
    expect(r.error).toMatch(/missing "args"/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-tools-office.test.ts`
Expected: FAIL — module `tools/office` not found.

- [ ] **Step 3: Write minimal implementation**

`src/main/agent/tools/office.ts`:

```ts
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export interface OfficeToolDeps {
  resolveBinary: () => Promise<string>
  spawnFn?: typeof spawn
}

const MAX_OUTPUT = 1024 * 1024

export function buildOfficeArgs(args: string[]): string[] {
  return args.includes('--json') ? args : [...args, '--json']
}

export function createOfficeTool(deps: OfficeToolDeps): ToolDefinition {
  return {
    name: 'office',
    description:
      'Create, read, analyze, and modify Office documents (.docx, .xlsx, .pptx) via the officecli ' +
      'CLI. The binary is resolved from PATH or auto-downloaded on first use. Pass the officecli ' +
      'arguments as an argv array (no shell), e.g. ["create","report.docx"] or ' +
      '["add","deck.pptx","/","--type","slide","--prop","title=Q4"]. "--json" is appended ' +
      'automatically for structured output.',
    schema: z.object({
      args: z.array(z.string()).describe('The officecli command arguments, e.g. ["create", "report.docx"].'),
      timeoutMs: z.number().int().optional().describe('Optional timeout in milliseconds.')
    }),
    async run(input, ctx): Promise<ToolRunResult> {
      const { args, timeoutMs = 120_000 } = input as { args?: unknown; timeoutMs?: number }
      if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
        return { error: 'office: missing "args" (string[])' }
      }
      const argv = buildOfficeArgs(args)
      const fallbackCwd = existsSync(ctx.cwd) ? ctx.cwd : homedir()
      let binary: string
      try {
        binary = await deps.resolveBinary()
      } catch (err) {
        return {
          error:
            'office: cannot locate officecli binary — ' + (err as Error).message + '. ' +
            'Install it manually (e.g. `npm install -g @officecli/officecli`) or check the download. ' +
            'See https://github.com/iOfficeAI/OfficeCLI'
        }
      }
      const spawnFn = deps.spawnFn ?? spawn
      return new Promise<ToolRunResult>(resolve => {
        const child = spawnFn(binary, argv, {
          cwd: fallbackCwd,
          env: process.env as Record<string, string>,
          windowsHide: true
        })
        let stdout = ''
        let stderr = ''
        let settled = false
        let timedOut = false
        const done = (result: ToolRunResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        }
        const timer = setTimeout(() => {
          timedOut = true
          if (child.pid) {
            try {
              kill(child.pid, () => done({ error: `office: timeout after ${timeoutMs}ms` }))
            } catch {
              done({ error: `office: timeout after ${timeoutMs}ms` })
            }
          } else {
            done({ error: `office: timeout after ${timeoutMs}ms` })
          }
        }, timeoutMs)
        child.stdout?.on('data', (d) => {
          if (stdout.length < MAX_OUTPUT) stdout += d.toString()
        })
        child.stderr?.on('data', (d) => {
          if (stderr.length < MAX_OUTPUT) stderr += d.toString()
        })
        child.on('error', (err) => done({ error: `office: ${err.message}` }))
        child.on('close', (code) => {
          if (timedOut) return
          const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
          const body = output || '(no output)'
          if (code === 0) return done({ output: body })
          done({ error: `office: exit code ${code}\n${body}` })
        })
      })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-tools-office.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/office.ts tests/unit/agent-tools-office.test.ts
git commit -m "feat(agent): add office tool spawning officecli subprocess"
```

---

### Task 3: Wire tool into registry, index.ts and permission defaults

**Files:**
- Modify: `src/main/agent/tools/registry.ts`
- Modify: `src/main/index.ts` (block `tools: createDefaultTools({ ... })`)
- Modify: `src/main/agent/config.ts` (`DEFAULT_MEOW_CONFIG.permission`)

**Interfaces:**
- Consumes: `createOfficeTool` (Task 2), `OfficeCliBinary` (Task 1).
- Produces: `createDefaultTools(opts)` nhận thêm option `getUserDataDir?: () => string | undefined`; khi có → registry khởi tạo office tool (lazy qua `OfficeCliBinary`). Permission map chứa `office: 'ask'`.

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/unit/agent-tools.test.ts` (hoặc file mới `tests/unit/agent-tools-registry.test.ts`):

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'

let dir = ''
afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('createDefaultTools', () => {
  it('adds the office tool when getUserDataDir is provided', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-reg-'))
    const tools = createDefaultTools({ getUserDataDir: () => dir })
    expect(tools.has('office')).toBe(true)
  })

  it('omits the office tool without getUserDataDir', () => {
    const tools = createDefaultTools({})
    expect(tools.has('office')).toBe(false)
  })
})

describe('default permission', () => {
  it('defaults office permission to ask', () => {
    expect(DEFAULT_MEOW_CONFIG.permission.office).toBe('ask')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-tools-registry.test.ts`
Expected: FAIL — `tools.has('office')` là false, `permission.office` là undefined.

- [ ] **Step 3: Write minimal implementation**

`src/main/agent/tools/registry.ts` — thêm import và option:

```ts
import { OfficeCliBinary } from '../../officecli/binary-manager'
import { createOfficeTool } from './office'
```

sửa interface `DefaultToolsOptions` thêm `getUserDataDir?: () => string | undefined`, và cuối hàm `createDefaultTools`:

```ts
  const userDataDir = opts.getUserDataDir?.()
  if (userDataDir) {
    const binary = new OfficeCliBinary({ userDataDir })
    tools.push(createOfficeTool({ resolveBinary: () => binary.resolveBinaryPath() }))
  }
  return new Map(tools.map(t => [t.name, t]))
```

`src/main/agent/config.ts` — trong `DEFAULT_MEOW_CONFIG.permission`, thêm dòng:

```ts
    bash: 'ask',
    office: 'ask',
    question: 'allow'
```

`src/main/index.ts` — trong block `tools: createDefaultTools({ ... })`, thêm option:

```ts
      getUserDataDir: () => app.getPath('userData')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-tools-registry.test.ts tests/unit/agent-config.test.ts tests/unit/agent-permission.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: pass (không có lỗi TS).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/registry.ts src/main/index.ts src/main/agent/config.ts tests/unit/agent-tools-registry.test.ts
git commit -m "feat(officecli): wire office tool into registry, index and default permissions"
```

---

### Task 4: Full verification

**Files:**
- Không đổi file.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: tất cả pass (unit + integration), không phá test hiện có.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: (Nếu cần) build + e2e**

Chỉ chạy nếu thay đổi liên quan tới e2e/renderer. Task này không đổi IPC/preload/renderer nên e2e thường không cần:
Run: `npm run build && npm run e2e`

- [ ] **Step 4: Commit (nếu còn thay đổi dư từ bước chạy test)**

```bash
git status --short
# chỉ commit nếu có file thay đổi ngoài ý muốn
```
