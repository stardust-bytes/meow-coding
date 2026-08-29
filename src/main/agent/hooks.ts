import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
