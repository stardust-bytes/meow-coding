import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import kill from 'tree-kill'
import { buildShellCommand } from './tools/bash'
import type { ResolvedShellCommand } from './tools/bash'

export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'Stop'

export const HOOK_EVENTS: readonly HookEventName[] = ['PreToolUse', 'PostToolUse', 'Stop']

export interface HooksConfig {
  PreToolUse?: HookGroup[]
  PostToolUse?: HookGroup[]
  // Stop hooks always fire; their matcher is ignored.
  Stop?: HookGroup[]
}

export interface HookGroup {
  matcher: string
  hooks: HookEntry[]
}

interface BaseHook {
  // Seconds. Defaults differ per event: a PreToolUse hook gates a tool call and
  // must not stall it, a PostToolUse/Stop hook may run a full test suite.
  timeout?: number
  statusMessage?: string
  // Fire-and-forget: spawned, never waited on, contributes no decision.
  async?: boolean
}

export interface CommandHook extends BaseHook {
  type: 'command'
  command: string
  // Exec form: skips the shell entirely. On Windows the command must be a real
  // executable, not a .cmd/.bat shim.
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
  // Only these env vars may be interpolated into the url/headers, so a hook
  // config cannot exfiltrate the whole environment to a remote endpoint.
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

// Claude Code's rule: a matcher of only word chars, separators and spaces is an
// exact name or a list; anything else is a regex.
const EXACT_OR_LIST = /^[\w\-,| ]+$/

export function matchHook(matcher: string, toolName: string): boolean {
  if (!matcher || matcher === '*') return true
  if (EXACT_OR_LIST.test(matcher)) {
    return matcher
      .split(/[|,]/)
      .map(s => s.trim())
      .filter(Boolean)
      .includes(toolName)
  }
  try {
    return new RegExp(matcher).test(toolName)
  } catch {
    // A malformed matcher must not take the turn down; it simply matches nothing.
    return false
  }
}

// A hooks file that is missing, unreadable or malformed yields no hooks rather
// than failing the turn — hooks are opt-in policy, not a hard dependency.
export function readHooksFile(filePath: string): HooksConfig {
  if (!existsSync(filePath)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as HooksConfig
  } catch {
    return {}
  }
}

export function loadProjectHooks(cwd: string): HooksConfig {
  return readHooksFile(path.join(cwd, '.meow', 'hooks.json'))
}

// Every scope's groups run: the merge concatenates rather than overrides, so a
// project cannot silently drop a global policy hook.
export function mergeHooksConfig(...configs: (HooksConfig | undefined)[]): HooksConfig {
  const out: HooksConfig = {}
  for (const event of HOOK_EVENTS) {
    const groups = configs.flatMap(c => c?.[event] ?? [])
    if (groups.length > 0) out[event] = groups
  }
  return out
}

export function normalizeHooks(raw: HooksConfig | undefined): HooksConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: HooksConfig = {}
  for (const event of HOOK_EVENTS) {
    const groups = raw[event]
    if (Array.isArray(groups) && groups.length > 0) out[event] = groups
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Hook stdout is fed back into the model's context, so it is capped the way tool
// output is: a runaway hook must not blow the context window.
const MAX_HOOK_OUTPUT = 64 * 1024

// A PreToolUse hook gates a tool call and must not stall the turn; a PostToolUse
// or Stop hook may legitimately run a full test suite.
const DEFAULT_TIMEOUT_S: Record<HookEventName, number> = {
  PreToolUse: 60,
  PostToolUse: 600,
  Stop: 600
}

const PRECEDENCE: Record<'allow' | 'ask' | 'deny', number> = { allow: 0, ask: 1, deny: 2 }

export interface HookTraceRecord {
  event: HookEventName
  tool?: string
  status: 'started' | 'ok' | 'blocked' | 'failed' | 'timeout'
  durationMs?: number
}

interface HookExecution {
  // null when the child never reported a code: a spawn failure, or a kill.
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface HooksExecutorDeps {
  cwd: string
  spawnFn?: typeof spawn
  killFn?: (pid: number, cb: () => void) => void
  onTrace?: (record: HookTraceRecord) => void
}

// Claude Code parses stdout as JSON only when it is a bare object, so a hook can
// print human-readable notes without them being read as a decision.
function parseHookJson(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

// Modern hooks nest their decision under hookSpecificOutput; older ones put it at
// the top level. Both are accepted.
function hookOutput(json: Record<string, unknown> | undefined): Record<string, unknown> {
  const inner = json?.hookSpecificOutput
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  return json ?? {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export class HooksExecutor {
  constructor(
    private readonly config: HooksConfig,
    private readonly deps: HooksExecutorDeps
  ) {}

  private matchingHooks(event: 'PreToolUse' | 'PostToolUse', toolName: string): HookEntry[] {
    return (this.config[event] ?? [])
      .filter(group => matchHook(group.matcher, toolName))
      .flatMap(group => group.hooks)
  }

  private resolveCommand(hook: CommandHook): ResolvedShellCommand {
    // Exec form: no shell, so nothing in the command string is interpreted.
    if (hook.args && hook.args.length > 0) return { command: hook.command, args: hook.args }
    if (hook.shell === 'powershell') {
      return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', hook.command] }
    }
    return buildShellCommand(hook.command, this.deps.cwd)
  }

  private spawnHook(resolved: ResolvedShellCommand, detached: boolean): ChildProcess {
    const doSpawn = this.deps.spawnFn ?? spawn
    return doSpawn(resolved.command, resolved.args, {
      cwd: this.deps.cwd,
      env: { ...process.env, MEOW_PROJECT_DIR: this.deps.cwd } as NodeJS.ProcessEnv,
      windowsHide: true,
      windowsVerbatimArguments: resolved.verbatim ?? false,
      stdio: detached ? 'ignore' : ['pipe', 'pipe', 'pipe']
    })
  }

  private runCommand(
    hook: CommandHook,
    payload: Record<string, unknown>,
    event: HookEventName
  ): Promise<HookExecution> {
    const resolved = this.resolveCommand(hook)

    // Fire-and-forget: the turn never waits, so the hook can never decide.
    if (hook.async) {
      try {
        const child = this.spawnHook(resolved, true)
        child.on('error', () => {})
        child.stdin?.end(JSON.stringify(payload))
        child.unref?.()
      } catch {
        // An async hook that cannot even spawn must not fail the turn.
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    }

    const limitMs = (hook.timeout ?? DEFAULT_TIMEOUT_S[event]) * 1000
    return new Promise<HookExecution>(resolve => {
      let child: ChildProcess
      try {
        child = this.spawnHook(resolved, false)
      } catch {
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false })
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const settle = (result: HookExecution): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const killIt = (): void => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
          settle({ exitCode: null, stdout, stderr, timedOut: true })
          return
        }
        try {
          const doKill = this.deps.killFn ?? kill
          doKill(child.pid, () => settle({ exitCode: null, stdout, stderr, timedOut: true }))
        } catch {
          settle({ exitCode: null, stdout, stderr, timedOut: true })
        }
      }
      const timer = setTimeout(killIt, limitMs)
      child.stdout?.on('data', (d: Buffer) => {
        if (stdout.length < MAX_HOOK_OUTPUT) stdout += d.toString()
      })
      child.stderr?.on('data', (d: Buffer) => {
        if (stderr.length < MAX_HOOK_OUTPUT) stderr += d.toString()
      })
      child.on('error', () => settle({ exitCode: null, stdout, stderr, timedOut: false }))
      child.on('close', (code: number | null) => settle({ exitCode: code, stdout, stderr, timedOut: false }))
      child.stdin?.end(JSON.stringify(payload))
    })
  }

  private async execute(
    hook: HookEntry,
    event: HookEventName,
    payload: Record<string, unknown>
  ): Promise<HookExecution & { json?: Record<string, unknown> }> {
    const tool = asString(payload.tool_name)
    this.deps.onTrace?.({ event, tool, status: 'started' })
    const startedAt = Date.now()
    const exec = hook.type === 'command'
      ? await this.runCommand(hook, payload, event)
      : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    const status: HookTraceRecord['status'] = exec.timedOut
      ? 'timeout'
      : exec.exitCode === 2
        ? 'blocked'
        : exec.exitCode === 0
          ? 'ok'
          : 'failed'
    this.deps.onTrace?.({ event, tool, status, durationMs: Date.now() - startedAt })
    return { ...exec, json: parseHookJson(exec.stdout) }
  }

  async runPreToolUse(toolName: string, input: Record<string, unknown>): Promise<PreToolUseResult> {
    const result: PreToolUseResult = {}
    for (const hook of this.matchingHooks('PreToolUse', toolName)) {
      const exec = await this.execute(hook, 'PreToolUse', {
        hook_event_name: 'PreToolUse',
        cwd: this.deps.cwd,
        tool_name: toolName,
        tool_input: input
      })
      const out = hookOutput(exec.json)
      // Exit 2 is the only blocking code; 1 and friends are just a broken hook.
      if (exec.exitCode === 2) {
        result.decision = 'deny'
        result.reason = asString(out.permissionDecisionReason) ?? asString(out.reason) ?? asString(exec.stderr)
        continue
      }
      const decision = out.permissionDecision
      if (decision === 'allow' || decision === 'ask' || decision === 'deny') {
        if (result.decision === undefined || PRECEDENCE[decision] > PRECEDENCE[result.decision]) {
          result.decision = decision
          result.reason = asString(out.permissionDecisionReason)
        }
      }
      if (out.updatedInput && typeof out.updatedInput === 'object') {
        result.updatedInput = out.updatedInput as Record<string, unknown>
      }
      const context = asString(out.additionalContext)
      if (context) {
        result.additionalContext = result.additionalContext ? `${result.additionalContext}\n${context}` : context
      }
    }
    return result
  }
}
