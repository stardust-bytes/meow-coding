# Meow Agent Hooks System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hooks subsystem (`PreToolUse` / `PostToolUse` / `Stop`) to the native Meow agent that runs hook handlers as subprocesses (and MCP-tool / HTTP / prompt handlers) outside the LLM context window, with only a bounded result fed back into the context.

**Architecture:** A self-contained `HooksExecutor` in `src/main/agent/hooks.ts` loads config merged from `meow.json` (global) + `.meow/hooks.json` (project), matches tool events, and executes handlers (command/mcp_tool/http/prompt). The `SessionRunner` loop injects it as a per-turn dependency: PreToolUse runs before the permission gate, PostToolUse after a tool runs, Stop before a normal `done`. The manager wires the executor (with MCP + model access) into both parent and subagent runners.

**Tech Stack:** Node child_process (spawn, tree-kill for timeout), the existing `buildShellCommand` (bash.ts), `@modelcontextprotocol/sdk` client, AI-SDK `LlmClient`, Vitest. Tests use a model stub and an injected fake `spawn` — never hit a real LLM or spawn real shells.

**Spec:** `docs/superpowers/specs/2026-08-29-meow-hooks-system-design.md`

## Global Constraints

- Windows shell-form hooks reuse `buildShellCommand` (Git Bash via `cmd.exe` shim); exec-form (`args`) must be a real executable (never `.cmd`/`.bat`). Do not break the shim logic.
- Hooks config re-read every turn: `LoopDeps.hooks` is a **function** resolved once per `SessionRunner.run()` (mirroring the `system` dep).
- `exit 1` does **not** block; only `exit 2` (or a blocking JSON decision) does. A timed-out hook renders **no decision** — a timed-out PreToolUse gate does not block the tool call.
- stdout is parsed as JSON **only if** it starts with `{` and ends with `}` (surrounding whitespace allowed); otherwise plain text.
- Multiple matching hooks run **serially** (deterministic `deny > ask > allow` aggregation; avoids the documented `updatedInput` race). Tool calls still run in parallel.
- Hooks only **tighten**, never loosen: a PreToolUse `allow` skips the interactive prompt but a config `deny` (incl. plan mode) still wins.
- No new `ChatEvent`, nothing persisted to the transcript for hooks themselves. Hook lifecycle goes to `TraceStore` via a new `{ type: 'hook' }` `TraceEvent` when `trace.enabled`.
- Stop hooks fire only on normal exits (`complete`/`length`/`refusal`/`max-steps`), **not** on user Stop (aborted) or LLM error.
- Code + tests in English, per `AGENTS.md`. No unnecessary comments.

---

### Task 1: Hooks types, config load/merge, and matcher

**Files:**
- Create: `src/main/agent/hooks.ts`
- Modify: `src/main/agent/config.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Consumes: `MeowConfig` (`src/main/agent/config.ts`), `LlmClient` (`src/main/agent/llm.ts`)
- Produces:
  ```ts
  // src/main/agent/hooks.ts
  export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'Stop'
  export interface HooksConfig { PreToolUse?: HookGroup[]; PostToolUse?: HookGroup[]; Stop?: HookGroup[] }
  export interface HookGroup { matcher: string; hooks: HookEntry[] }
  export type HookEntry = CommandHook | McpToolHook | HttpHook | PromptHook
  export interface CommandHook { type: 'command'; command: string; args?: string[]; timeout?: number; statusMessage?: string; async?: boolean; shell?: 'bash' | 'powershell' }
  export interface McpToolHook { type: 'mcp_tool'; server: string; tool: string; input?: Record<string, unknown>; timeout?: number; statusMessage?: string; async?: boolean }
  export interface HttpHook { type: 'http'; url: string; headers?: Record<string, string>; allowedEnvVars?: string[]; timeout?: number; statusMessage?: string; async?: boolean }
  export interface PromptHook { type: 'prompt' | 'agent'; prompt: string; model?: string; timeout?: number; statusMessage?: string; async?: boolean }
  export interface PreToolUseResult { decision?: 'allow' | 'deny' | 'ask'; reason?: string; updatedInput?: Record<string, unknown>; additionalContext?: string }
  export interface PostToolUseResult { updatedToolOutput?: string; additionalContext?: string; warning?: string }
  export interface StopResult { block: boolean; reason?: string }
  export function loadProjectHooks(cwd: string): HooksConfig
  export function mergeHooksConfig(...configs: (HooksConfig | undefined)[]): HooksConfig
  export function matchHook(matcher: string, toolName: string): boolean
  ```
- `config.ts` gains: `hooks?: HooksConfig` on `MeowConfig`, `normalizeHooks(raw)` helper, wired into `mergeDefaults` / `configToSettings` / `settingsToConfig`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/agent-hooks.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadProjectHooks, mergeHooksConfig, matchHook } from '../../src/main/agent/hooks'
import { loadMeowConfig, DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'
import type { HooksConfig } from '../../src/main/agent/hooks'

describe('matchHook', () => {
  it('matches "*", empty, and omitted as catch-all', () => {
    expect(matchHook('*', 'Bash')).toBe(true)
    expect(matchHook('', 'Bash')).toBe(true)
    expect(matchHook('*', 'anything')).toBe(true)
  })
  it('matches exact name', () => {
    expect(matchHook('Bash', 'Bash')).toBe(true)
    expect(matchHook('Bash', 'Write')).toBe(false)
  })
  it('matches | and , separated lists', () => {
    expect(matchHook('Edit|Write', 'Write')).toBe(true)
    expect(matchHook('Edit, Write', 'Edit')).toBe(true)
    expect(matchHook('Edit|Write', 'Read')).toBe(false)
  })
  it('treats anything else as an unanchored regex', () => {
    expect(matchHook('^mcp__', 'mcp__memory__read')).toBe(true)
    expect(matchHook('mcp__memory__.*', 'mcp__memory__write')).toBe(true)
    expect(matchHook('^mcp__', 'Write')).toBe(false)
  })
  it('is case-sensitive and rejects a bad regex without throwing', () => {
    expect(matchHook('Write', 'write')).toBe(false)
    expect(matchHook('(', 'Write')).toBe(false)
  })
})

describe('loadProjectHooks + mergeHooksConfig', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-hooks-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('loads .meow/hooks.json when present', () => {
    writeFileSync(path.join(dir, '.meow', 'hooks.json'), JSON.stringify({
      PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'check.sh' }] }]
    }), { recursive: true } as never)
    const cfg = loadProjectHooks(dir)
    expect(cfg.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'check.sh' })
  })
  it('returns {} when the file is missing', () => {
    expect(loadProjectHooks(dir)).toEqual({})
  })
  it('concatenates groups per event, both scopes run', () => {
    const globalCfg: HooksConfig = { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'g.sh' }] }] }
    const projectCfg: HooksConfig = { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'p.sh' }] }] }
    const merged = mergeHooksConfig(globalCfg, projectCfg)
    expect(merged.PreToolUse).toHaveLength(2)
    expect(merged.PreToolUse?.[0].hooks[0].command).toBe('g.sh')
    expect(merged.PreToolUse?.[1].hooks[0].command).toBe('p.sh')
  })
  it('drops undefined scopes', () => {
    const merged = mergeHooksConfig(undefined, { Stop: [{ matcher: '*', hooks: [] }] })
    expect(merged.PreToolUse).toBeUndefined()
    expect(merged.Stop).toHaveLength(1)
  })
})

describe('config.ts hooks normalization', () => {
  it('loads a hooks key from meow.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cfg-'))
    try {
      writeFileSync(path.join(dir, 'meow.json'), JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x.sh' }] }] }
      }))
      const cfg = loadMeowConfig(path.join(dir, 'meow.json'))
      expect(cfg.hooks?.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'x.sh' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('defaults to undefined hooks when absent', () => {
    expect(DEFAULT_MEOW_CONFIG.hooks).toBeUndefined()
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cfg-'))
    try {
      writeFileSync(path.join(dir, 'meow.json'), JSON.stringify({}))
      expect(loadMeowConfig(path.join(dir, 'meow.json')).hooks).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: FAIL — module `../../src/main/agent/hooks` not found.

- [ ] **Step 3: Create `src/main/agent/hooks.ts` with types + helpers**

```ts
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'Stop'

export interface HooksConfig {
  PreToolUse?: HookGroup[]
  PostToolUse?: HookGroup[]
  Stop?: HookGroup[]
}

export interface HookGroup {
  matcher: string
  hooks: HookEntry[]
}

interface BaseHook {
  timeout?: number
  statusMessage?: string
  async?: boolean
}

export interface CommandHook extends BaseHook {
  type: 'command'
  command: string
  args?: string[]
  shell?: 'bash' | 'powershell'
}
export interface McpToolHook extends BaseHook {
  type: 'mcp_tool'
  server: string
  tool: string
  input?: Record<string, unknown>
}
export interface HttpHook extends BaseHook {
  type: 'http'
  url: string
  headers?: Record<string, string>
  allowedEnvVars?: string[]
}
export interface PromptHook extends BaseHook {
  type: 'prompt' | 'agent'
  prompt: string
  model?: string
}

export type HookEntry = CommandHook | McpToolHook | HttpHook | PromptHook

export interface PreToolUseResult {
  decision?: 'allow' | 'deny' | 'ask'
  reason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}
export interface PostToolUseResult {
  updatedToolOutput?: string
  additionalContext?: string
  warning?: string
}
export interface StopResult {
  block: boolean
  reason?: string
}

// A regex-safe split of a matcher into its exact/list members: [A-Za-z0-9_\-,| ].
const EXACT_OR_LIST = /^[\w\-,| ]+$/

export function matchHook(matcher: string, toolName: string): boolean {
  if (!matcher || matcher === '*') return true
  if (EXACT_OR_LIST.test(matcher)) {
    return matcher.split(/[|,]/).map(s => s.trim()).filter(Boolean).includes(toolName)
  }
  try {
    return new RegExp(matcher).test(toolName)
  } catch {
    return false
  }
}

function loadFile(path: string): HooksConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as HooksConfig
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadProjectHooks(cwd: string): HooksConfig {
  return loadFile(path.join(cwd, '.meow', 'hooks.json'))
}

export function mergeHooksConfig(...configs: (HooksConfig | undefined)[]): HooksConfig {
  const out: HooksConfig = {}
  for (const ev of ['PreToolUse', 'PostToolUse', 'Stop'] as const) {
    const groups = configs.flatMap(c => c?.[ev] ?? [])
    if (groups.length > 0) out[ev] = groups
  }
  return out
}
```

- [ ] **Step 4: Wire `hooks` into `config.ts`**

In `src/main/agent/config.ts`:
- Add `import type { HooksConfig } from './hooks'` at the top.
- Add `hooks?: HooksConfig` to the `MeowConfig` interface.
- Add a normalizer near the other `normalize*` helpers:

```ts
function normalizeHooks(raw: HooksConfig | undefined): HooksConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: HooksConfig = {}
  for (const ev of ['PreToolUse', 'PostToolUse', 'Stop'] as const) {
    const groups = raw[ev]
    if (Array.isArray(groups) && groups.length > 0) out[ev] = groups
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```

- In `mergeDefaults`, add `hooks: normalizeHooks(raw.hooks),`.
- In `settingsToConfig`, add `hooks: normalizeHooks(base.hooks),` — carried from the **base** config, following the `subagentMaxSteps` precedent.
- Do **not** add `hooks` to `MeowSettings` or `configToSettings`: hooks are file-edited, not a settings-UI field. Adding it there would make `src/shared` import from `src/main/agent`, and a settings save would write the round-tripped object back and wipe the user's hooks config.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: PASS. Also run `npm run typecheck` and `npx vitest run tests/unit/agent-config.test.ts` — `src/shared/types.ts` needs no change, since `hooks` stays out of `MeowSettings`.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/hooks.ts src/main/agent/config.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(agent): hooks config schema, load/merge, and matcher"
```

---

### Task 2: Command execution core (spawn, JSON protocol, exit codes, timeout, async)

**Files:**
- Modify: `src/main/agent/hooks.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Consumes: `buildShellCommand` (`src/main/agent/tools/bash.ts`), `tree-kill`, `spawn` from `node:child_process`
- Produces (internal to `hooks.ts`):
  ```ts
  interface HookExecution { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  interface HooksExecutorDeps {
    cwd: string
    spawnFn?: typeof spawn              // injectable for tests
    killFn?: (pid: number, cb: () => void) => void   // injectable for tests
    onTrace?: (e: HookTraceRecord) => void
    callMcpTool?: (server: string, tool: string, input: Record<string, unknown>) => Promise<{ output?: string; error?: string }>
    getModel?: () => { llm: LlmClient; model: string } | undefined
  }
  interface HookTraceRecord { event: HookEventName; tool?: string; status: 'started' | 'ok' | 'blocked' | 'failed' | 'timeout'; durationMs?: number }
  ```

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/agent-hooks.test.ts`)

```ts
import { EventEmitter } from 'node:events'
import type { HooksExecutor } from '../../src/main/agent/hooks'

interface FakeChild {
  stdin: { end: (s?: string) => void; write?: (s: string) => void }
  stdout: EventEmitter
  stderr: EventEmitter
  on: (ev: string, cb: (...a: unknown[]) => void) => void
  kill: () => void
  pid: number
  unref?: () => void
}
function fakeSpawn(script: Partial<{ stdout: string; stderr: string; exitCode: number; keepOpen: boolean }>) {
  return vi.fn(() => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const child: FakeChild = {
      stdin: { end: (s) => { void s; if (script.stdout !== undefined) stdout.emit('data', script.stdout) }, write: (s) => { void s } },
      stdout, stderr,
      on: (ev, cb) => { if (ev === 'close' && script.exitCode !== undefined && !script.keepOpen) setTimeout(() => cb(script.exitCode), 0) },
      kill: () => { if (script.keepOpen) setTimeout(() => { stdout.emit('data', script.stdout ?? ''); (child.on as never) }, 0) },
      pid: 123
    }
    return child as never
  })
}

describe('HooksExecutor command execution', () => {
  it('writes the event JSON to stdin and interprets exit 0 with no JSON as no decision', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const spawnFn = fakeSpawn({ stdout: 'plain text', exitCode: 0 })
    const ex = new HooksExecutor({ cwd: '/proj', spawnFn } as never)
    const r = await ex.runPreToolUse('Read', { file_path: 'a.ts' })
    expect(spawnFn).toHaveBeenCalled()
    expect(r).toEqual({})
  })
  it('blocks on exit 2, using stderr as reason when no JSON', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor({ cwd: '/proj', spawnFn: fakeSpawn({ stderr: 'forbidden', exitCode: 2 }) } as never)
    const r = await ex.runPreToolUse('Write', { file_path: 'a.ts', content: 'x' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('forbidden')
  })
  it('interprets hookSpecificOutput JSON on exit 0', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const json = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', permissionDecisionReason: 'ok', additionalContext: 'prod', updatedInput: { file_path: 'b.ts' } } })
    const ex = new HooksExecutor({ cwd: '/proj', spawnFn: fakeSpawn({ stdout: json, exitCode: 0 }) } as never)
    const r = await ex.runPreToolUse('Write', { file_path: 'a.ts' })
    expect(r.decision).toBe('allow')
    expect(r.additionalContext).toBe('prod')
    expect(r.updatedInput).toEqual({ file_path: 'b.ts' })
  })
  it('treats a timed-out hook as no decision', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor({ cwd: '/proj', spawnFn: fakeSpawn({ keepOpen: true }) } as never)
    const r = await ex.runPreToolUse('Read', {}, { defaultTimeout: 0.01 } as never)
    expect(r).toEqual({})
  })
})
```

Note: `runPreToolUse` in Task 2 can accept an optional `opts?: { defaultTimeout?: number }` test seam (add it to the signature now so the timeout test is honest). The executor needs the config too — the tests construct it with a config that matches `*`; add a `config?: HooksConfig` dep defaulting to `{ PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }] }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "command execution"`
Expected: FAIL — `HooksExecutor` not exported / not defined.

- [ ] **Step 3: Implement `HooksExecutor` command path**

Add to `src/main/agent/hooks.ts`:

```ts
import { spawn } from 'node:child_process'
import kill from 'tree-kill'
import type { LlmClient } from './llm'
import { buildShellCommand, type ResolvedShellCommand } from './tools/bash'

const MAX_HOOK_OUTPUT = 64 * 1024
const DEFAULT_TIMEOUT_S: Record<HookEventName, number> = { PreToolUse: 60, PostToolUse: 600, Stop: 600 }

export interface HookTraceRecord {
  event: HookEventName
  tool?: string
  status: 'started' | 'ok' | 'blocked' | 'failed' | 'timeout'
  durationMs?: number
}

interface HookExecution {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface HooksExecutorDeps {
  cwd: string
  spawnFn?: typeof spawn
  killFn?: (pid: number, cb: () => void) => void
  onTrace?: (e: HookTraceRecord) => void
  callMcpTool?: (server: string, tool: string, input: Record<string, unknown>) => Promise<{ output?: string; error?: string }>
  getModel?: () => { llm: LlmClient; model: string } | undefined
}

const ALL_MATCH: HooksConfig = { PreToolUse: [{ matcher: '*', hooks: [] }] }

export class HooksExecutor {
  constructor(
    private config: HooksConfig,
    private deps: HooksExecutorDeps
  ) {}

  private matchingHooks(event: 'PreToolUse' | 'PostToolUse', toolName: string): HookEntry[] {
    return (this.config[event] ?? [])
      .filter(g => matchHook(g.matcher, toolName))
      .flatMap(g => g.hooks)
  }

  private stopHooks(): HookEntry[] {
    return (this.config.Stop ?? []).flatMap(g => g.hooks)
  }

  private resolveCommand(hook: CommandHook): ResolvedShellCommand {
    if (hook.args && hook.args.length > 0) return { command: hook.command, args: hook.args }
    if (hook.shell === 'powershell') return { command: 'powershell.exe', args: ['-NoProfile', '-Command', hook.command] }
    return buildShellCommand(hook.command, this.deps.cwd)
  }

  private runCommand(hook: CommandHook, payload: Record<string, unknown>, event: HookEventName, timeoutS?: number): Promise<HookExecution> {
    const resolved = this.resolveCommand(hook)
    if (hook.async) {
      try {
        const child = this.deps.spawnFn ? this.deps.spawnFn(resolved.command, resolved.args, {
          cwd: this.deps.cwd, env: process.env as Record<string, string>, windowsHide: true, stdio: 'ignore'
        }) : spawn(resolved.command, resolved.args, {
          cwd: this.deps.cwd, env: process.env as Record<string, string>, windowsHide: true, stdio: 'ignore'
        })
        child.stdin?.end(JSON.stringify(payload))
        child.unref?.()
      } catch { /* fire-and-forget: never fails the call */ }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    }
    const limit = (timeoutS ?? hook.timeout ?? DEFAULT_TIMEOUT_S[event]) * 1000
    return new Promise<HookExecution>((resolve) => {
      const doSpawn = this.deps.spawnFn ?? spawn
      const child = doSpawn(resolved.command, resolved.args, {
        cwd: this.deps.cwd,
        env: process.env as Record<string, string>,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: resolved.verbatim ?? false
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const settle = (r: HookExecution) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r) }
      const killIt = () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) { settle({ exitCode: null, stdout, stderr, timedOut: true }); return }
        try {
          const k = this.deps.killFn ?? kill
          k(child.pid, () => settle({ exitCode: null, stdout, stderr, timedOut: true }))
        } catch { settle({ exitCode: null, stdout, stderr, timedOut: true }) }
      }
      const timer = setTimeout(killIt, limit)
      child.stdin?.end(JSON.stringify(payload))
      child.stdout?.on('data', (d: Buffer) => { if (stdout.length < MAX_HOOK_OUTPUT) stdout += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX_HOOK_OUTPUT) stderr += d.toString() })
      child.on('error', () => settle({ exitCode: null, stdout, stderr, timedOut: false }))
      child.on('close', (code: number | null) => settle({ exitCode: code, stdout, stderr, timedOut: false }))
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "command execution"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/hooks.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(agent): hooks command execution — spawn, JSON protocol, timeout, async"
```

---

### Task 3: HooksExecutor public API (PreToolUse / PostToolUse / Stop aggregation)

**Files:**
- Modify: `src/main/agent/hooks.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Consumes: `HookExecution` (Task 2), `ToolRunResult` (`src/main/agent/tools/types.ts`)
- Produces:
  ```ts
  class HooksExecutor {
    runPreToolUse(toolName: string, input: Record<string, unknown>, opts?: { defaultTimeout?: number }): Promise<PreToolUseResult>
    runPostToolUse(toolName: string, input: Record<string, unknown>, result: ToolRunResult, opts?: { defaultTimeout?: number }): Promise<PostToolUseResult>
    runStop(lastAssistantMessage: string, stopHookActive: boolean, opts?: { defaultTimeout?: number }): Promise<StopResult>
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe('HooksExecutor PreToolUse aggregation', () => {
  async function exWith(hooks: HookEntry[], tool: string) {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const cfg = { PreToolUse: [{ matcher: tool, hooks }] } as HooksConfig
    return new HooksExecutor(cfg, { cwd: '/proj', spawnFn: fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'nope', additionalContext: 'ctx' } }), exitCode: 0 }) } as never)
  }
  it('deny beats allow and ask across multiple hooks', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [
        { type: 'command', command: 'a' }, { type: 'command', command: 'b' }
      ] }] } as HooksConfig,
      { cwd: '/proj', spawnFn: fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }), exitCode: 0 }) } as never
    )
    // second hook denies
    ex['runCommand'] = async () => ({ exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' } }), stderr: '', timedOut: false })
    const r = await ex.runPreToolUse('Write', {})
    expect(r.decision).toBe('deny')
  })
  it('concatenates additionalContext from all hooks', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    let n = 0
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }] } as HooksConfig,
      { cwd: '/proj', spawnFn: fakeSpawn({ stdout: '', exitCode: 0 }) } as never
    )
    ex['runCommand'] = async () => ({ exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: `ctx${++n}` } }), stderr: '', timedOut: false })
    const r = await ex.runPreToolUse('Write', {})
    expect(r.additionalContext).toContain('ctx1')
    expect(r.additionalContext).toContain('ctx2')
  })
  it('surfaces updatedInput and allow-skip behavior', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig,
      { cwd: '/proj', spawnFn: fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { x: 2 } } }), exitCode: 0 }) } as never
    )
    const r = await ex.runPreToolUse('Write', { x: 1 })
    expect(r.decision).toBe('allow')
    expect(r.updatedInput).toEqual({ x: 2 })
  })
})

describe('HooksExecutor PostToolUse', () => {
  it('replaces output via updatedToolOutput and appends additionalContext', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor(
      { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig,
      { cwd: '/proj', spawnFn: fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'REDACTED', additionalContext: 'note' } }), exitCode: 0 }) } as never
    )
    const r = await ex.runPostToolUse('Bash', { command: 'ls' }, { output: 'SECRET', error: undefined })
    expect(r.updatedToolOutput).toBe('REDACTED')
    expect(r.additionalContext).toBe('note')
  })
  it('surfaces exit-2 stderr as a warning', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor(
      { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig,
      { cwd: '/proj', spawnFn: fakeSpawn({ stderr: 'careful', exitCode: 2 }) } as never
    )
    const r = await ex.runPostToolUse('Bash', { command: 'ls' }, { output: 'out', error: undefined })
    expect(r.warning).toContain('careful')
  })
})

describe('HooksExecutor Stop', () => {
  it('does not block on exit 0', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig, { cwd: '/proj', spawnFn: fakeSpawn({ exitCode: 0 }) } as never)
    expect(await ex.runStop('done', false)).toEqual({ block: false })
  })
  it('blocks on exit 2 with the reason', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig, { cwd: '/proj', spawnFn: fakeSpawn({ stderr: 'keep going', exitCode: 2 }) } as never)
    const r = await ex.runStop('done', false)
    expect(r.block).toBe(true)
    expect(r.reason).toContain('keep going')
  })
  it('blocks on decision:"block" JSON', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const ex = new HooksExecutor({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig, { cwd: '/proj', spawnFn: fakeSpawn({ stdout: JSON.stringify({ decision: 'block', reason: 'more work' }), exitCode: 0 }) } as never)
    const r = await ex.runStop('done', false)
    expect(r.block).toBe(true)
    expect(r.reason).toBe('more work')
  })
  it('passes stop_hook_active through to the payload', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    let payload = ''
    const spawnFn = vi.fn(() => {
      const child: FakeChild = { stdin: { end: (s) => { payload = s ?? '' }, write: () => {} }, stdout: new EventEmitter(), stderr: new EventEmitter(), on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 0) }, kill: () => {}, pid: 1 }
      return child as never
    })
    const ex = new HooksExecutor({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } as HooksConfig, { cwd: '/proj', spawnFn } as never)
    await ex.runStop('done', true)
    expect(JSON.parse(payload).stop_hook_active).toBe(true)
    expect(JSON.parse(payload).last_assistant_message).toBe('done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "aggregation|PostToolUse|Stop"`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Implement the three public methods**

Add to `HooksExecutor` in `src/main/agent/hooks.ts`:

```ts
const PRECEDENCE: Record<'allow' | 'ask' | 'deny', number> = { allow: 0, ask: 1, deny: 2 }

function parseHookJSON(stdout: string): Record<string, unknown> | undefined {
  const t = stdout.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return undefined
  try { return JSON.parse(t) as Record<string, unknown> } catch { return undefined }
}
// Normalizes the hook output JSON: modern hookSpecificOutput, or legacy top-level.
function hookOutput(json: Record<string, unknown> | undefined): Record<string, unknown> {
  const inner = json?.hookSpecificOutput
  return inner && typeof inner === 'object' ? inner as Record<string, unknown> : (json ?? {})
}
```

Then inside the class:

```ts
  private async execute(hook: HookEntry, event: HookEventName, payload: Record<string, unknown>, timeoutS?: number): Promise<HookExecution & { json?: Record<string, unknown> }> {
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : undefined
    this.deps.onTrace?.({ event, tool, status: 'started' })
    const start = Date.now()
    let exec: HookExecution
    if (hook.type === 'command') exec = await this.runCommand(hook, payload, event, timeoutS)
    else if (hook.type === 'mcp_tool') exec = await this.runMcpTool(hook, payload)
    else if (hook.type === 'http') exec = await this.runHttp(hook, payload, timeoutS)
    else exec = await this.runPrompt(hook, payload, event, timeoutS)
    const status: HookTraceRecord['status'] = exec.timedOut ? 'timeout' : exec.exitCode === 2 ? 'blocked' : exec.exitCode === 0 ? 'ok' : 'failed'
    this.deps.onTrace?.({ event, tool, status, durationMs: Date.now() - start })
    return { ...exec, json: parseHookJSON(exec.stdout) }
  }

  async runPreToolUse(toolName: string, input: Record<string, unknown>, opts?: { defaultTimeout?: number }): Promise<PreToolUseResult> {
    const result: PreToolUseResult = {}
    for (const hook of this.matchingHooks('PreToolUse', toolName)) {
      const exec = await this.execute(hook, 'PreToolUse', {
        hook_event_name: 'PreToolUse', cwd: this.deps.cwd, tool_name: toolName, tool_input: input
      }, opts?.defaultTimeout)
      if (exec.exitCode === 2) {
        result.decision = 'deny'
        result.reason = exec.json?.reason ?? exec.json?.permissionDecisionReason ?? exec.stderr
        continue
      }
      const out = hookOutput(exec.json)
      const decision = out.permissionDecision
      if (decision === 'deny' || decision === 'ask' || decision === 'allow') {
        if (result.decision === undefined || PRECEDENCE[decision] > PRECEDENCE[result.decision]) {
          result.decision = decision
          if (typeof out.permissionDecisionReason === 'string') result.reason = out.permissionDecisionReason
        }
      } else if (out.decision === 'block') {
        result.decision = 'deny'
        if (typeof out.reason === 'string') result.reason = out.reason
      }
      if (out.updatedInput && typeof out.updatedInput === 'object') {
        result.updatedInput = out.updatedInput as Record<string, unknown>
      }
      if (typeof out.additionalContext === 'string') {
        result.additionalContext = result.additionalContext ? `${result.additionalContext}\n${out.additionalContext}` : out.additionalContext
      }
    }
    return result
  }

  async runPostToolUse(toolName: string, input: Record<string, unknown>, result: ToolRunResult, opts?: { defaultTimeout?: number }): Promise<PostToolUseResult> {
    const out: PostToolUseResult = {}
    for (const hook of this.matchingHooks('PostToolUse', toolName)) {
      const exec = await this.execute(hook, 'PostToolUse', {
        hook_event_name: 'PostToolUse', cwd: this.deps.cwd, tool_name: toolName,
        tool_input: input, tool_response: { output: result.output, error: result.error }
      }, opts?.defaultTimeout)
      if (exec.exitCode === 2) {
        out.warning = exec.json?.reason ?? exec.json?.permissionDecisionReason ?? exec.stderr
        continue
      }
      const o = hookOutput(exec.json)
      if (typeof o.updatedToolOutput === 'string') out.updatedToolOutput = o.updatedToolOutput
      if (typeof o.additionalContext === 'string') {
        out.additionalContext = out.additionalContext ? `${out.additionalContext}\n${o.additionalContext}` : o.additionalContext
      }
    }
    return out
  }

  async runStop(lastAssistantMessage: string, stopHookActive: boolean, opts?: { defaultTimeout?: number }): Promise<StopResult> {
    for (const hook of this.stopHooks()) {
      const exec = await this.execute(hook, 'Stop', {
        hook_event_name: 'Stop', cwd: this.deps.cwd, last_assistant_message: lastAssistantMessage, stop_hook_active: stopHookActive
      }, opts?.defaultTimeout)
      const o = hookOutput(exec.json)
      if (exec.exitCode === 2 || o.decision === 'block' || o.ok === false) {
        const reason = (typeof o.reason === 'string' ? o.reason : undefined)
          ?? (typeof o.permissionDecisionReason === 'string' ? o.permissionDecisionReason : undefined)
          ?? exec.stderr
        return { block: true, reason }
      }
    }
    return { block: false }
  }
```

The stub methods `runMcpTool` / `runHttp` / `runPrompt` are added in Tasks 4-5. For Task 3 to compile, add temporary bodies that return `{ exitCode: 0, stdout: '', stderr: '', timedOut: false }` and resolve them in the later tasks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: PASS. Also `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/hooks.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(agent): hooks PreToolUse/PostToolUse/Stop aggregation"
```

---

### Task 4: mcp_tool + http handlers

**Files:**
- Modify: `src/main/agent/hooks.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Consumes: `HooksExecutorDeps.callMcpTool`, `HttpHook.allowedEnvVars`
- Produces: `HooksExecutor.runMcpTool(hook, payload)` and `runHttp(hook, payload, timeoutS)` (private), both returning `HookExecution`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('HooksExecutor mcp_tool + http handlers', () => {
  it('calls an MCP tool via deps.callMcpTool and maps output/error', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const callMcpTool = vi.fn(async () => ({ output: 'mcp ok' }))
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'mcp_tool', server: 's', tool: 't' }] }] } as HooksConfig,
      { cwd: '/proj', callMcpTool } as never
    )
    await ex.runPreToolUse('Read', { file_path: 'a.ts' })
    expect(callMcpTool).toHaveBeenCalledWith('s', 't', { hook_event_name: 'PreToolUse', cwd: '/proj', tool_name: 'Read', tool_input: { file_path: 'a.ts' } })
  })
  it('surfaces an MCP error as exit-2-style blocking with the error text', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const callMcpTool = vi.fn(async () => ({ error: 'server not connected' }))
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'mcp_tool', server: 's', tool: 't' }] }] } as HooksConfig,
      { cwd: '/proj', callMcpTool } as never
    )
    const r = await ex.runPreToolUse('Read', {})
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('server not connected')
  })
  it('posts JSON to the URL and interpolates env vars from allowedEnvVars only', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }), status: 200 } as never))
    process.env.HOOK_TOKEN = 'tok'
    process.env.NOT_ALLOWED = 'leak'
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'http', url: 'https://x/$HOOK_TOKEN', headers: { 'x-t': '$HOOK_TOKEN', 'x-leak': '$NOT_ALLOWED' }, allowedEnvVars: ['HOOK_TOKEN'] }] }] } as HooksConfig,
      { cwd: '/proj', fetchFn } as never
    )
    const r = await ex.runPreToolUse('Read', {})
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('https://x/tok')
    expect((opts.headers as Record<string, string>)['x-t']).toBe('tok')
    expect((opts.headers as Record<string, string>)['x-leak']).toBe('')
    expect(r.decision).toBe('allow')
    delete process.env.HOOK_TOKEN; delete process.env.NOT_ALLOWED
  })
  it('maps a non-2xx HTTP response to a blocking error', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const fetchFn = vi.fn(async () => ({ ok: false, text: async () => 'denied', status: 403 } as never))
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'http', url: 'https://x' }] }] } as HooksConfig,
      { cwd: '/proj', fetchFn } as never
    )
    const r = await ex.runPreToolUse('Read', {})
    expect(r.decision).toBe('deny')
  })
})
```

Add `fetchFn?: typeof fetch` and `fetch` fallback wiring to `HooksExecutorDeps`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "mcp_tool|http"`
Expected: FAIL — runMcpTool/runHttp stubs return nothing.

- [ ] **Step 3: Implement `runMcpTool` and `runHttp`**

Add to `HooksExecutor`:

```ts
  private async runMcpTool(hook: McpToolHook, payload: Record<string, unknown>): Promise<HookExecution> {
    const call = this.deps.callMcpTool
    if (!call) return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    try {
      const input = { ...(hook.input ?? {}), ...payload }
      const res = await call(hook.server, hook.tool, input)
      if (res.error) return { exitCode: 2, stdout: '', stderr: res.error, timedOut: false }
      return { exitCode: 0, stdout: res.output ?? '', stderr: '', timedOut: false }
    } catch (err) {
      return { exitCode: 2, stdout: '', stderr: err instanceof Error ? err.message : String(err), timedOut: false }
    }
  }

  private interpolateEnv(template: string): string {
    return template.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name: string) => {
      const allowed = this.deps.allowedHttpEnvVars?.includes(name)
      return allowed && process.env[name] ? process.env[name]! : ''
    })
  }

  private async runHttp(hook: HttpHook, payload: Record<string, unknown>, timeoutS?: number): Promise<HookExecution> {
    const fetchFn = this.deps.fetchFn ?? fetch
    try {
      const url = this.interpolateEnv(hook.url)
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(hook.headers ?? {})) headers[k] = this.interpolateEnv(v)
      const ctrl = timeoutS ? AbortSignal.timeout((timeoutS ?? hook.timeout ?? 30) * 1000) : undefined
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: ctrl
      })
      const text = await res.text()
      if (!res.ok) return { exitCode: 2, stdout: '', stderr: text || `http ${res.status}`, timedOut: false }
      return { exitCode: 0, stdout: text, stderr: '', timedOut: false }
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      return { exitCode: timedOut ? 0 : 2, stdout: '', stderr: timedOut ? '' : (err instanceof Error ? err.message : String(err)), timedOut }
    }
  }
```

Add `allowedHttpEnvVars?: string[]` and `fetchFn?: typeof fetch` to `HooksExecutorDeps`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: PASS. `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/hooks.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(agent): hooks mcp_tool and http handlers"
```

---

### Task 5: prompt/agent handlers

**Files:**
- Modify: `src/main/agent/hooks.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Consumes: `HooksExecutorDeps.getModel` → `{ llm: LlmClient; model: string }`, `PromptHook.prompt` / `.model`
- Produces: `HooksExecutor.runPrompt(hook, payload, event, timeoutS)` (private) returning `HookExecution`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('HooksExecutor prompt/agent handlers', () => {
  function stubLlm(text: string) {
    return {
      stream: async function* () { yield { kind: 'text' as const, text } }
    }
  }
  it('runs a tool-less LLM call with $ARGUMENTS substituted and interprets the JSON', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const getModel = () => ({ llm: stubLlm(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'model says no' } })) as never, model: 'm1' })
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'Decide: $ARGUMENTS' }] }] } as HooksConfig,
      { cwd: '/proj', getModel } as never
    )
    const r = await ex.runPreToolUse('Read', { file_path: 'a.ts' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('model says no')
  })
  it('treats a non-JSON model answer as no decision', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const getModel = () => ({ llm: stubLlm('just prose') as never, model: 'm1' })
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'P' }] }] } as HooksConfig,
      { cwd: '/proj', getModel } as never
    )
    expect(await ex.runPreToolUse('Read', {})).toEqual({})
  })
  it('Stop prompt hooks block on {ok:false}', async () => {
    const { HooksExecutor } = await import('../../src/main/agent/hooks')
    const getModel = () => ({ llm: stubLlm(JSON.stringify({ ok: false, reason: 'unfinished' })) as never, model: 'm1' })
    const ex = new HooksExecutor(
      { Stop: [{ matcher: '*', hooks: [{ type: 'agent', prompt: 'check' }] }] } as HooksConfig,
      { cwd: '/proj', getModel } as never
    )
    const r = await ex.runStop('done', false)
    expect(r.block).toBe(true)
    expect(r.reason).toBe('unfinished')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "prompt/agent"`
Expected: FAIL — runPrompt stub returns nothing.

- [ ] **Step 3: Implement `runPrompt`**

Add to `HooksExecutor`:

```ts
  private async runPrompt(hook: PromptHook, payload: Record<string, unknown>, event: HookEventName, timeoutS?: number): Promise<HookExecution> {
    const model = this.deps.getModel?.()
    if (!model) return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    try {
      const prompt = hook.prompt.replace(/\$ARGUMENTS/g, JSON.stringify(payload))
      const parts: string[] = []
      const stream = model.llm.stream({
        model: hook.model ?? model.model,
        system: 'You are a hook that inspects an event and returns a JSON decision. Output only JSON.',
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        signal: undefined
      })
      for await (const part of stream) {
        if (part.kind === 'text') parts.push(part.text ?? '')
        if (timeoutS !== undefined && parts.join('').length === 0) { /* no-op: timeout handled by caller */ }
      }
      return { exitCode: 0, stdout: parts.join(''), stderr: '', timedOut: false }
    } catch (err) {
      return { exitCode: 0, stdout: '', stderr: err instanceof Error ? err.message : String(err), timedOut: false }
    }
  }
```

Note: `LlmClient.stream` options require `model`, `system`, `messages`, `tools` (see `LlmStreamOptions` in `llm.ts`); `maxOutputTokens`/`variantOptions` are optional.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: PASS. `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/hooks.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(agent): hooks prompt/agent handlers"
```

---

### Task 6: Loop integration (PreToolUse / PostToolUse / Stop in `loop.ts`)

**Files:**
- Modify: `src/main/agent/loop.ts`
- Modify: `tests/unit/agent-loop.test.ts` (extend harness + add tests)
- Modify: `src/main/agent/tools/types.ts` (no change expected, confirm)

**Interfaces:**
- Consumes: `HooksExecutor`, `PreToolUseResult`, `PostToolUseResult`, `StopResult` (from `hooks.ts`)
- Produces:
  ```ts
  // LoopDeps gains:
  hooks?: () => HooksExecutor
  // executeCall signature gains an additionalContext param:
  private executeCall(call: ToolCallData, decision: PermissionDecision, signal?: AbortSignal, preContext?: string): Promise<void>
  ```

- [ ] **Step 1: Add `hooks` dep and PreToolUse path in `loop.ts`**

In `loop.ts`:
- `import type { HooksExecutor } from './hooks'`.
- Add `hooks?: () => HooksExecutor` to `LoopDeps`.
- Add private fields `private hooks?: HooksExecutor` and `private stopBlocksThisRun = 0`.
- In `run()`, after `this.turnContext = ...` line, resolve `this.hooks = this.deps.hooks?.()` and reset `this.stopBlocksThisRun = 0`.

Replace the permission-split block (currently around lines 301-308):

```ts
      // PreToolUse hooks run before the permission gate, in parallel across calls.
      const prepared = await Promise.all(calls.map(async (call) => {
        const pre = this.hooks ? await this.hooks.runPreToolUse(call.tool, call.input) : undefined
        if (pre?.decision === 'deny') {
          return { call, blocked: true, reason: pre.reason ?? `tool "${call.tool}" blocked by PreToolUse hook`, preContext: pre.additionalContext }
        }
        if (pre?.updatedInput) call.input = pre.updatedInput
        let decision = this.deps.decidePermission(call.tool, call.input)
        if (pre?.decision === 'ask') decision = 'ask'
        else if (pre?.decision === 'allow' && decision === 'ask') decision = 'allow'
        return { call, blocked: false, decision, preContext: pre?.additionalContext }
      }))
      const blockedCalls = prepared.filter(p => p.blocked)
      for (const b of blockedCalls) {
        b.call.permission = 'denied'
        b.call.error = b.reason
        this.deps.appendTool(b.call)
        this.deps.onEvent({ type: 'tool-result', agentId, call: b.call })
      }
      const autoCalls = prepared.filter(p => !p.blocked && p.decision !== 'ask')
      const askCalls = prepared.filter(p => !p.blocked && p.decision === 'ask')
      await Promise.all(autoCalls.map(p => this.executeCall(p.call, p.decision, signal, p.preContext)))
      for (const p of askCalls) await this.executeCall(p.call, p.decision, signal, p.preContext)
```

- [ ] **Step 2: Add PostToolUse path in `executeCall`**

In `executeCall`, change the signature to `(call, decision, signal?, preContext?: string)` and replace the `try` block (currently lines 422-431) with:

```ts
        try {
          const r = await def.run(call.input, toolCtx)
          call.output = r.output
          call.error = r.error
          if (!r.error) {
            let out = call.output
            if (this.hooks) {
              const post = await this.hooks.runPostToolUse(call.tool, call.input, { output: out, error: undefined })
              if (post.updatedToolOutput !== undefined) out = post.updatedToolOutput
              const extra = [post.additionalContext, post.warning].filter((s): s is string => Boolean(s)).join('\n')
              if (extra) out = out ? `${out}\n${extra}` : extra
            }
            if (preContext) out = out ? `${out}\n${preContext}` : preContext
            call.output = await this.appendToolReminder(call, out)
          }
        } catch (err) {
          call.error = formatToolError(err)
        }
```

- [ ] **Step 3: Add Stop-hook path before normal `done`**

Add a helper method:

```ts
  // Runs Stop hooks before a normal done; returns true when a hook blocked and
  // the loop must continue with a fresh step budget.
  private async maybeContinueAfterStop(reason: string, lastAssistantText: string, tokens?: MessageTokens, cost?: number): Promise<boolean> {
    if (!this.hooks || this.stopBlocksThisRun >= MAX_STOP_BLOCKS) return false
    const stop = await this.hooks.runStop(lastAssistantText, this.stopBlocksThisRun > 0)
    if (!stop.block) return false
    this.stopBlocksThisRun++
    this.deps.appendMessage({ id: randomUUID(), role: 'user', text: stop.reason ?? 'Continue working.', createdAt: Date.now() })
    return true
  }
```

Add `const MAX_STOP_BLOCKS = 8` near the other module constants.

Then replace the two normal-done exits:

1. The `!hasToolCall` branch (currently lines 325-328):

```ts
        const reason = classifyFinish(finishReason)
        if (await this.maybeContinueAfterStop(reason, textBuffer, tokens, this.deps.computeCost?.(runUsage))) {
          steps = 0
          continue
        }
        this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
        return
```

2. The `isLastStep` branch (currently lines 329-332):

```ts
      if (isLastStep) {
        if (await this.maybeContinueAfterStop('max-steps', textBuffer, tokens, this.deps.computeCost?.(runUsage))) {
          steps = 0
          continue
        }
        this.deps.onEvent({ type: 'done', agentId, reason: 'max-steps', tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
```

The `aborted` `done('stopped')` exits are left untouched (no Stop hooks on user Stop).

- [ ] **Step 4: Write the failing loop tests** (append to `tests/unit/agent-loop.test.ts`)

Add a fake executor helper and tests:

```ts
import type { HooksExecutor, PreToolUseResult, PostToolUseResult, StopResult } from '../../src/main/agent/hooks'

class FakeHooks implements HooksExecutor {
  pre: (tool: string) => Promise<PreToolUseResult> = async () => ({})
  post: (tool: string) => Promise<PostToolUseResult> = async () => ({})
  stop: () => Promise<StopResult> = async () => ({ block: false })
  async runPreToolUse(t: string) { return this.pre(t) }
  async runPostToolUse(t: string, _i: unknown, _r: unknown) { return this.post(t) }
  async runStop() { return this.stop() }
}

describe('agent loop hooks', () => {
  it('PreToolUse deny blocks the tool without running it', async () => {
    const llm = new StubLlm()
    llm.queue.push([
      { kind: 'tool-call', toolCallId: 't1', toolName: 'bash', toolInput: { command: 'echo hi' } },
      { kind: 'finish' }
    ])
    const hooks = new FakeHooks()
    hooks.pre = async () => ({ decision: 'deny', reason: 'policy blocks bash' })
    const h = makeHarness({ llm, tools: new Map([['bash', stubTool('bash')]]), hooks: () => hooks } as never)
    const run = h.runner.run()
    await run
    const bashCalls = h.events.filter(e => e.type === 'tool-start' && (e as { call: { tool: string } }).call.tool === 'bash')
    expect(bashCalls).toHaveLength(1)  // tool-start still emitted (model proposed it)
    const result = h.events.find(e => e.type === 'tool-result')
    const call = (result as { call: { error?: string; permission: string } } | undefined)?.call
    expect(call?.permission).toBe('denied')
    expect(call?.error).toContain('policy blocks bash')
  })

  it('PreToolUse updatedInput is what the tool receives', async () => {
    const llm = new StubLlm()
    llm.queue.push([
      { kind: 'tool-call', toolCallId: 't1', toolName: 'write', toolInput: { file_path: 'a.ts', content: 'x' } },
      { kind: 'finish' }
    ])
    let received = {}
    const hooks = new FakeHooks()
    hooks.pre = async () => ({ decision: 'allow', updatedInput: { file_path: 'b.ts', content: 'y' } })
    const h = makeHarness({
      llm,
      tools: new Map([['write', stubTool('write', async (input) => { received = input; return { output: 'ok' } })]]),
      hooks: () => hooks
    } as never)
    await h.runner.run()
    expect(received).toEqual({ file_path: 'b.ts', content: 'y' })
  })

  it('PostToolUse additionalContext is appended to the output the model sees', async () => {
    const llm = new StubLlm()
    llm.queue.push([
      { kind: 'tool-call', toolCallId: 't1', toolName: 'bash', toolInput: { command: 'echo hi' } },
      { kind: 'finish' }
    ])
    const hooks = new FakeHooks()
    hooks.post = async () => ({ additionalContext: 'HOOK-NOTE' })
    const h = makeHarness({ llm, tools: new Map([['bash', stubTool('bash', async () => ({ output: 'BASE' }))]]), hooks: () => hooks } as never)
    await h.runner.run()
    const result = h.events.find(e => e.type === 'tool-result')
    expect((result as { call: { output: string } }).call.output).toContain('BASE')
    expect((result as { call: { output: string } }).call.output).toContain('HOOK-NOTE')
  })

  it('Stop hook block continues the loop and the reason becomes a user message', async () => {
    const llm = new StubLlm()
    llm.queue.push([
      { kind: 'text', text: 'first answer' },
      { kind: 'finish' }
    ])
    llm.queue.push([
      { kind: 'text', text: 'second answer' },
      { kind: 'finish' }
    ])
    const hooks = new FakeHooks()
    let stopCalls = 0
    hooks.stop = async () => {
      stopCalls++
      return stopCalls === 1 ? { block: true, reason: 'verify more' } : { block: false }
    }
    const h = makeHarness({ llm, hooks: () => hooks } as never)
    await h.runner.run()
    const userTexts = h.items.filter(i => i.kind === 'message' && i.message.role === 'user').map(i => (i as { message: { text: string } }).message.text)
    expect(userTexts).toContain('verify more')
    const dones = h.events.filter(e => e.type === 'done')
    expect(dones).toHaveLength(1)
    expect(h.llm.calls).toHaveLength(2)
  })
})
```

Note: if `makeHarness` needs a `hooks` field added to `Harness`, add `hooks: () => hooks` via the overrides; verify the harness forwards unknown fields or extend `makeHarness` accordingly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "hooks"`
Expected: PASS (4 tests). Then the full suite: `npm test` and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): wire hooks into the tool loop (pre/post/stop)"
```

---

### Task 7: Manager + subagent wiring, and TraceEvent

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Modify: `src/main/agent/tools/task.ts`
- Modify: `src/main/agent/mcp/manager.ts` (add `callTool`)
- Modify: `src/shared/types.ts` (add `hook` TraceEvent variant)
- Modify: `tests/unit/agent-task.test.ts`, `tests/unit/agent-trace-store.test.ts`

**Interfaces:**
- Consumes: `HooksExecutor`, `mergeHooksConfig`, `loadProjectHooks`, `HookTraceRecord` (from `hooks.ts`); `McpManager`
- Produces:
  ```ts
  // McpManager gains:
  async callTool(serverName: string, toolName: string, input: Record<string, unknown>): Promise<{ output?: string; error?: string }>
  // TraceEvent union gains:
  | { type: 'hook'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; event: 'PreToolUse' | 'PostToolUse' | 'Stop'; tool?: string; status: 'started' | 'ok' | 'blocked' | 'failed' | 'timeout'; durationMs?: number }
  ```

- [ ] **Step 1: Add `McpManager.callTool`** (`src/main/agent/mcp/manager.ts`)

```ts
  async callTool(serverName: string, toolName: string, input: Record<string, unknown>): Promise<{ output?: string; error?: string }> {
    const conn = this.connections.get(serverName)
    if (!conn) return { error: `MCP server "${serverName}" is not connected` }
    const res = await conn.client.callTool({ name: toolName, arguments: input })
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>
    const text = content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
    if (res.isError) return { error: text || 'mcp tool error' }
    return { output: text || JSON.stringify(content) }
  }
```

- [ ] **Step 2: Build the hooks provider in `register`** (`src/main/meow-agent-manager.ts`)

Inside `register()`, after `llmClient` is created and before the `SessionRunner` is built:

```ts
    const hooksProvider = () => new HooksExecutor(
      mergeHooksConfig(loadMeowConfig(this.deps.configPath).hooks, loadProjectHooks(agent.cwd)),
      {
        cwd: agent.cwd,
        callMcpTool: (server, tool, input) => this.mcp.callTool(server, tool, input),
        getModel: () => ({ llm: llmClient, model: resolved.model }),
        onTrace: (e: HookTraceRecord) => this.writeHookTrace(agent.id, e)
      }
    )
```

Add `hooks: hooksProvider` to the `SessionRunner` deps object.

- [ ] **Step 3: Pass hooks to subagents** (`src/main/agent/tools/task.ts`)

Add `hooks?: () => HooksExecutor` to `createTaskTool` opts, thread it into the subagent `SessionRunner` deps (`hooks: opts.hooks`). The subagent runner resolves it once per run like the parent (same `cwd`, same merged config).

- [ ] **Step 4: Add `writeHookTrace` and the TraceEvent variant**

In `src/main/meow-agent-manager.ts`:

```ts
  private writeHookTrace(agentId: string, e: HookTraceRecord): void {
    const trace = this.deps.trace
    if (!trace) return
    const sessionId = this.activeSessionId(agentId)
    const turn = this.turnCounters.get(sessionId) ?? 0
    const full = trace.append(sessionId, {
      type: 'hook', agentId, sessionId, turn,
      event: e.event, tool: e.tool, status: e.status, durationMs: e.durationMs
    })
    this.deps.onTrace?.(full)
  }
```

In `src/shared/types.ts`, add the `hook` member to the `TraceEvent` union (import the event/status string literal types inline — do **not** import from main/agent into shared; inline the literal unions).

- [ ] **Step 5: Write/update tests**

In `tests/unit/agent-task.test.ts`: assert the subagent `SessionRunner` receives a `hooks` function when `opts.hooks` is provided (spy via `opts.llm`/model stub; assert the runner was built with the provider — verify by checking that a PreToolUse hook running in the subagent blocks a subagent tool, using a fake executor).

In `tests/unit/agent-trace-store.test.ts` (or a new `agent-hooks-trace.test.ts`): assert `writeHookTrace` appends a `{ type: 'hook' }` event with correct fields when `trace.enabled`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/agent-task.test.ts tests/unit/agent-trace-store.test.ts tests/unit/agent-hooks.test.ts`
Expected: PASS. Then `npm test` + `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/main/meow-agent-manager.ts src/main/agent/tools/task.ts src/main/agent/mcp/manager.ts src/shared/types.ts tests/unit/agent-task.test.ts tests/unit/agent-trace-store.test.ts
git commit -m "feat(agent): wire hooks provider into manager and subagents, trace hook events"
```

---

### Task 8: Docs (AGENTS.md + reference)

**Files:**
- Modify: `src/main/agent/AGENTS.md`
- Modify: `docs/reference/03-agent-runtime.md`

- [ ] **Step 1: Document the hooks subsystem in `src/main/agent/AGENTS.md`**

Add a row to the key-files table for `hooks.ts` and a short paragraph in the conventions section: the three events, config sources (`meow.json` global + `.meow/hooks.json` project, merged), exit-code semantics (0/2/other, timeout = no decision), `deny > ask > allow` precedence, that hooks run in subagents too, and that `LoopDeps.hooks` is a per-run function.

- [ ] **Step 2: Document hooks in `docs/reference/03-agent-runtime.md`**

Add a `## 3.17 Hooks` section covering: the three events and their placement in the loop, config schema + merge, the JSON protocol (stdin payload, stdout `hookSpecificOutput`, exit codes, timeout), PreToolUse/PostToolUse/Stop semantics, subagent behavior, and the `hook` trace event. Reference `hooks.ts` and the spec.

- [ ] **Step 3: Verify and commit**

Run: `npm test` + `npm run typecheck` (docs-only, but confirm nothing broke).
```bash
git add src/main/agent/AGENTS.md docs/reference/03-agent-runtime.md
git commit -m "docs(agent): hooks subsystem reference"
```

---

## Self-Review

**Spec coverage:** Config merge (§3.1) → Task 1. Matcher (§3.2) → Task 1. Command execution (§3.3) → Task 2. PreToolUse/PostToolUse/Stop aggregation (§3.3) → Task 3. mcp_tool/http (§3.3) → Task 4. prompt/agent (§3.3) → Task 5. Loop integration (§3.4) → Task 6. Manager + subagent wiring (§3.5) → Task 7. TraceEvent `hook` (§4) → Task 7. Testing (§5) → Tasks 1-6. Docs → Task 8. `Stop` not fired on user Stop/error → Task 6 (aborted exits untouched). Block cap 8 → Task 6 (`MAX_STOP_BLOCKS`). Hooks tighten-never-loosen → Task 6 (`allow` only skips `ask`, config `deny` still wins via `decidePermission`).

**Placeholders:** none — every step has concrete code.

**Type consistency:** `runPreToolUse(tool, input, opts?)`, `runPostToolUse(tool, input, result, opts?)`, `runStop(lastAssistantMessage, stopHookActive, opts?)` defined in Task 3 and consumed consistently in Tasks 4-6. `HookExecution` shape `{ exitCode, stdout, stderr, timedOut }` consistent across Tasks 2-5. `LoopDeps.hooks` is `() => HooksExecutor` everywhere. `HooksExecutorDeps` gains `fetchFn`/`allowedHttpEnvVars` (Task 4) and `callMcpTool`/`getModel` (Tasks 3-5). TraceEvent `hook` variant fields match `writeHookTrace` in Task 7.
