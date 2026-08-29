# Meow Agent Hooks System — Design Spec

Date: 2026-08-29 · Status: awaiting review

## 1. Goal

Add a **hooks subsystem** to the native Meow agent: `PreToolUse`, `PostToolUse`, and `Stop`
hooks that run **outside the context window** — spawned as subprocesses (or MCP-tool / HTTP /
LLM handlers), with only a bounded result fed back into the LLM context. Modeled on Claude Code's
hooks semantics, simplified to the three events the harness needs.

This is the next step in the Claude Code ↔ Meow harness comparison series (harness prompt in
`2026-08-29-meow-agent-full-harness-prompt`, tool loop in `2026-08-29-meow-tool-loop-design`).

## 2. Scope & Decisions

| Topic | Decision |
|---|---|
| Events | `PreToolUse`, `PostToolUse`, `Stop` only. No `UserPromptSubmit`/`SessionStart`/`SessionEnd`/`PreCompact`/`PostCompact`/`Notification`, no `PostToolUseFailure`/`PostToolBatch`/`PermissionRequest`/`PermissionDenied` (phase 2). |
| Config location | `meow.json` top-level `hooks` key (global) **merged** with `<cwd>/.meow/hooks.json` (project). Both scopes run; aggregation precedence `deny > ask > allow`. Read again every turn. |
| PreToolUse | Full protocol: `permissionDecision: allow\|deny\|ask`, `updatedInput` (replaces whole input), `additionalContext`, exit 2 = block. Runs **before** the permission gate, in parallel across concurrent tool calls. |
| PostToolUse | `updatedToolOutput` (replace output), `additionalContext` (append), exit 2 stderr → warning fed to the model. |
| Stop | Runs once per turn before a normal `done` (complete/length/refusal/max-steps). Can **block** (exit 2 or `decision:'block'`) → loop continues with the reason as the next instruction; capped at `MAX_STOP_BLOCKS = 8`. Not fired on user Stop (aborted) or LLM error. |
| Handler types | All four: `command` (build first), then `mcp_tool`, `http`, `prompt`/`agent` (build order in plan). |
| Subagents | Hooks apply to subagent runners too (`task.ts` runs its own `SessionRunner` with the same cwd → same merged config). |
| UI visibility | Claude-Code-like: hook stdout is invisible unless it blocks (message to user/model), injects context (`additionalContext` next to the tool result), or fails. A transient `statusMessage` spinner while running. Hook execution recorded in `TraceStore` + log, not in the transcript. |
| Config reload | Hooks config re-read every turn (resolved once per `SessionRunner.run`, like the `system` function). |
| Out of scope | `if` per-handler filter, `asyncRewake`, `defer` decision, `disableAllHooks`, plugin/skill frontmatter hooks. |

## 3. Architecture

### 3.1 Config schema

```ts
export interface HooksConfig {
  PreToolUse?: HookGroup[]
  PostToolUse?: HookGroup[]
  Stop?: HookGroup[]            // matcher ignored — always fires
}

export interface HookGroup {
  matcher: string               // "*" | "" = all; letters/digits/_/-/,/| = exact/list; else unanchored regex
  hooks: HookEntry[]
}

export type HookEntry = CommandHook | McpToolHook | HttpHook | PromptHook | AgentHook

interface BaseHook {
  timeout?: number              // seconds; default PreToolUse 60, PostToolUse/Stop 600
  statusMessage?: string        // transient spinner text
  async?: boolean               // fire-and-forget, no timeout, no wait
}
interface CommandHook extends BaseHook {
  type: 'command'
  command: string               // shell form (default)
  args?: string[]               // exec form — no shell; real .exe on Windows
  shell?: 'bash' | 'powershell' // Windows
}
interface McpToolHook extends BaseHook {
  type: 'mcp_tool'
  server: string                // must be a connected server
  tool: string
  input?: Record<string, unknown>
}
interface HttpHook extends BaseHook {
  type: 'http'
  url: string                   // must match allowedHttpHookUrls allowlist
  headers?: Record<string, string>
  allowedEnvVars?: string[]
}
interface PromptHook extends BaseHook {
  type: 'prompt' | 'agent'
  prompt: string                // $ARGUMENTS = hook input JSON
  model?: string
}
```

- `meow.json`: add `hooks?: HooksConfig` to `MeowConfig`; normalize + merge in `mergeDefaults`
  (like `permission`/`mcp`).
- `.meow/hooks.json`: `loadProjectHooks(cwd)` reads `<cwd>/.meow/hooks.json` if present.
- Merge: for each event, `[...globalGroups, ...projectGroups]`. All matching hooks run.
  Aggregation precedence `deny > ask > allow`; `additionalContext` concatenated from every hook.

### 3.2 Matcher

`matchHook(matcher, toolName)` — mirrors Claude Code:
- `*`, `''`, omitted → match all
- Only `[A-Za-z0-9_\-,| ]` → exact string or `|`/`,`-separated list
- Anything else → `new RegExp(matcher)` (unanchored), tested against the tool name
- Case-sensitive

### 3.3 HooksExecutor (new file `src/main/agent/hooks.ts`)

```ts
export class HooksExecutor {
  constructor(cfg: HooksConfig, deps: {
    cwd: string
    callMcpTool?: (server: string, tool: string, input: Record<string, unknown>) => Promise<{ output?: string; error?: string }>
    getModel?: () => LlmClient | undefined   // for prompt/agent handlers
    spawn?: typeof spawn                       // injectable for tests
  })

  runPreToolUse(toolName: string, input: Record<string, unknown>): Promise<PreToolUseResult>
  runPostToolUse(toolName: string, input: Record<string, unknown>, result: ToolRunResult): Promise<PostToolUseResult>
  runStop(lastAssistantMessage: string, stopHookActive: boolean): Promise<StopResult>
}
```

Result types:

```ts
interface PreToolUseResult {
  decision?: 'allow' | 'deny' | 'ask'
  reason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}
interface PostToolUseResult {
  updatedToolOutput?: string
  additionalContext?: string
  warning?: string             // exit-2 stderr → fed to the model
}
interface StopResult { block: boolean; reason?: string }
```

**Command handler execution:**

- Event JSON written to the child's stdin:
  `{ hook_event_name, cwd, permission_mode, tool_name, tool_input, tool_use_id, last_assistant_message?, stop_hook_active? }`
- Spawn via `buildShellCommand` (bash.ts) for shell form: Git Bash `bash -lc` on Windows / `sh -c`
  on Unix; exec form (`args`) spawns directly; `shell: 'powershell'` uses PowerShell. cwd = agent
  cwd; env = `process.env` + `MEOW_PROJECT_DIR`.
- stdout collected (cap `MAX_HOOK_OUTPUT = 64 KiB`), parsed as JSON **only if** it starts with `{`
  and ends with `}` (surrounding whitespace allowed); otherwise treated as plain text (debug log only).
- Exit code control: `0` = no decision; `2` = blocking (stdout JSON blocking-decision reason, else
  stderr); anything else = non-blocking (stdout JSON decides; first stderr line prefixed
  `Failed with non-blocking status code:`).
- Timeout: kill after `timeout` seconds; timed-out hook yields **no decision** — a timed-out
  PreToolUse gate does not block; the tool proceeds through normal permission flow.
- `async: true`: spawn and detach, do not wait, no timeout.

**mcp_tool handler:** call `callMcpTool(server, tool, input)` with the event JSON as input;
treat result like command stdout/exit-code. **http handler:** POST to `url` (must match
`allowedHttpHookUrls`); headers interpolate `$VAR`/`${VAR}` from env (only `allowedEnvVars`).
**prompt/agent handler:** LLM call with `prompt` (`$ARGUMENTS` = event JSON); `{ok: true}` allows,
`{ok: false, reason}` blocks.

### 3.4 Loop integration (`src/main/agent/loop.ts`)

`LoopDeps.hooks?: () => HooksExecutor` — a **function** re-resolved once per `run()` (like
`system`), so hook config edits take effect on the next turn.

**PreToolUse** — replace the current permission-split block (loop.ts:301-308):

```
prepared = await Promise.all(calls.map(call => {
  pre = hooks.runPreToolUse(call.tool, call.input)
  if pre.decision === 'deny'       → return { call, blocked: true, reason: pre.reason }
  if pre.updatedInput              → call.input = pre.updatedInput   (replaces whole input)
  decision = decidePermission(call.tool, call.input)
  if pre.decision === 'ask'        → decision = 'ask'
  if pre.decision === 'allow' && decision === 'ask' → decision = 'allow'   // skip prompt; config deny still wins
  return { call, blocked: false, decision, additionalContext: pre.additionalContext }
}))
blocked calls → mark permission:'denied', error = reason, append + emit tool-result (no tool run)
auto calls (decision !== 'ask') → Promise.all(executeCall with pre.additionalContext)
ask calls → serial executeCall with pre.additionalContext
```

`executeCall` appends `additionalContext` (concatenated from every PreToolUse hook) to the tool
output after the run, alongside the PostToolUse context — same `<system-reminder>`-adjacent
placement as the existing `appendToolReminder`.

**PostToolUse** — in `executeCall`, after `def.run(...)` (loop.ts:422-428):

```
r = await def.run(call.input, toolCtx)
post = await hooks.runPostToolUse(call.tool, call.input, { output: r.output, error: r.error })
if post.updatedToolOutput → r.output = post.updatedToolOutput
if post.additionalContext → r.output = appendHookContext(r.output, post.additionalContext)
if post.warning           → append to output (feedback for the model)
then existing appendToolReminder + append + emit tool-result
```

**Stop** — centralize the normal `done` emission into a helper that runs Stop hooks before
emitting, only for `complete`/`length`/`refusal`/`max-steps`:

```
async emitDone(reason, tokens, cost) {
  if !signal.aborted {
    stop = await hooks.runStop(lastAssistantMessage, stopBlocksThisRun > 0)
    if stop.block && stopBlocksThisRun < MAX_STOP_BLOCKS {
      stopBlocksThisRun++
      appendMessage(user, reason)          // persisted; feeds Claude the reason
      steps = 0                            // fresh budget, like steering
      return   // loop continues
    }
  }
  onEvent(done); return
}
```

- User Stop (`aborted`) and LLM errors skip Stop hooks entirely (those are `StopFailure` in
  Claude Code — out of scope).
- `MAX_STOP_BLOCKS = 8` — after 8 consecutive blocks with no progress, force the `done` anyway.

### 3.5 Manager + subagent wiring

- `MeowAgentManager.register` builds a `hooks` provider for the parent runner:
  `() => new HooksExecutor(mergeConfigs(loadMeowConfig(...).hooks, loadProjectHooks(agent.cwd)), { cwd: agent.cwd, callMcpTool, getModel })`.
- Pass the same provider into `createTaskTool(...)` so the subagent `SessionRunner` in `task.ts`
  gets `hooks` too (same cwd → same merged config).
- `subagent-roles`/frontmatter hooks are out of scope; only the merged file config applies.

## 4. Data / events / trace

- No new `ChatEvent` and nothing persisted to the transcript for hooks themselves.
- Trace: extend `TraceEvent` with `{ type: 'hook'; seq; ts; agentId; sessionId; turn; event; tool?; status: 'started'|'ok'|'blocked'|'failed'|'timeout'; durationMs?; }` written via the existing
  `TraceStore` when `trace.enabled`. Hook stdout (plain text, non-blocking) goes to the per-agent
  log file, not the transcript.
- Blocking messages surface naturally: PreToolUse deny → `tool-result` with `call.error`; Stop
  block reason → a persisted user message in the feed.

## 5. Testing

Unit (`tests/unit/agent-hooks.test.ts`) — `HooksExecutor` with injected fake spawn:
- Config load + merge (global + project, project appended; missing file → global only)
- Matcher: `*`, exact, `|` list, regex, case-sensitivity
- Exit-code semantics: 0 / 2 / other / timeout (timeout → no decision)
- stdout JSON parse boundary (`{`…`}`), plain-text fallback, output cap
- PreToolUse result: deny/ask/allow precedence across multiple hooks, `additionalContext`
  concatenation, `updatedInput` passthrough
- PostToolUse: `updatedToolOutput` vs `additionalContext` vs warning
- Stop: block vs no-block; `stop_hook_active` flag

Loop (`tests/unit/agent-loop.test.ts`, extend `makeHarness` with a `hooks` dep / fake executor):
- PreToolUse deny → tool not run, `call.error = reason`
- `updatedInput` → tool receives modified input
- allow → prompt skipped, tool runs
- PostToolUse `additionalContext`/`updatedToolOutput` → output reflects it
- Stop block → loop continues, reason becomes a user message, respects cap
- Stop no-block → `done` emitted normally
- Parallel calls: hooks run concurrently, results ordered

## 6. Out of scope (phase 2 candidates)

- Events: `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`,
  `Notification`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`
- `if` per-handler permission-rule filter
- `asyncRewake`
- `defer` permission decision (non-interactive only)
- Plugin/skill/subagent-frontmatter hooks
- `disableAllHooks` managed-settings control
