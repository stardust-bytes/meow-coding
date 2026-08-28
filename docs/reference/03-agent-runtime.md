# 03 — Native Agent Runtime

How a chat turn of the native "Meow" agent actually executes. Primary sources:
`src/main/meow-agent-manager.ts` (orchestration) and `src/main/agent/loop.ts` (`SessionRunner`).

## 3.1 Object model

```
MeowAgentManager                      one per app; owns every native agent
 ├─ agents:      agentId → AgentConfig
 ├─ resolved:    agentId → ResolvedAgentConfig (provider, model, apiKey, baseUrl, systemPrompt)
 ├─ runners:     agentId → SessionRunner
 ├─ controllers: agentId → AbortController (current turn)
 ├─ running:     Set<agentId>
 ├─ queues:      agentId → QueuedMessage[]   (max 5)
 ├─ activeSessions: agentId → sessionId
 ├─ backgroundTasks: agentId → taskId → { sessionId, cancel }
 ├─ turnPromises: agentId → Promise<void>    (in-flight turn, awaited before the next one)
 └─ redoStacks:  agentId → [{ items, turn }]
```

`SessionRunner` is stateless between turns except for a few per-run counters; it reads and writes
the session transcript through callbacks (`getItems`, `appendMessage`, `appendTool`,
`replaceItems`) supplied by the manager, so the store stays the single source of truth.

## 3.2 Registration (`MeowAgentManager.register`)

Called on `init`, `addAgent`, and after any change that invalidates the runner (mode, variant,
model, settings reload). Steps:

1. Bump `registrationVersion` for the agent — a late async result from a superseded registration is
   discarded by comparing versions.
2. Load `meow.json`, `resolveAgentConfig(cfg, agentName, env, agentModel, getSecret, {accountId, resolveEndpoint})`
   → provider, model, apiKey, baseUrl, systemPrompt.
3. `LimitsService.resolveLimits` → `{ context, output }` (see [3.9](#39-context-and-output-limits)).
4. `resolveOutputTokens(...)` → the **output reserve** used for budgeting (distinct from the wire value).
5. Collect skills (`collectSkills`) and instruction files (`loadInstructions`).
6. Create the `LlmClient` with retry hooks:
   - `onReducedBudget(realLimit)` → `learnedLimits.recordMaxTokensLimit`
   - `onRetry({attempt,maxAttempts,delayMs})` → emits a `retry` `ChatEvent` so the UI can show "Retrying…"
7. Build the `task` tool via `createTaskTool(...)` with the parent's permission resolver, ask
   bridge, snapshot store, role names, subagent model resolver, and background callbacks.
8. Assemble the runner tool map: default tools + user tools + MCP tools, then override `task`,
   `revert`, and (when `lsp.enabled`) `lsp`.
9. Resolve `variantOptions` (Codex accounts ask the connections manager; otherwise the catalog's
   variant body). An invalid variant is cleared and, for Codex, `onVariantInvalidated` fires so the
   workspace record is updated too.
10. Construct the `SessionRunner`.

The `system` prompt is passed as a **function**, re-resolved once per run:

```ts
system: () => resolved.systemPrompt
  + modeNote                                    // plan-mode instructions, or ''
  + instructionsText(loadInstructions(agent.cwd))
  + skillListText(collectSkills(...))
```

so a newly added skill or an edited `AGENTS.md` takes effect on the next turn without a reload.

## 3.3 Sending a message

`send(agentId, text, images?, displayText?)`:

- If a turn is running → `enqueueMessage` (cap `MAX_QUEUE = 5`; over the cap emits an English
  `[meow]` error) and return.
- Otherwise `runTurn(...)`, then `drainQueue(...)` recursively until the queue empties.

`runTurn` first awaits `turnPromises.get(agentId)` if present. This matters: a turn aborted mid-tool
is still winding down after `running` was cleared (killing a process tree takes time and the tool's
result is appended when the kill settles). Appending the next user message first would leave an
orphan tool item and providers reject the whole conversation with
`400 tool message without a preceding tool_calls`.

`runTurnInner`:

1. Build the user `ChatMessage`; `text` gets `referenceHints(cwd, text)` appended (resolved
   `@path` mentions), `displayText` keeps the raw input the user typed.
2. Append to the active session, emit `user-message`.
3. If no API key is resolved, emit an error and stop.
4. Ensure a runner exists, create an `AbortController`, mark running, increment the turn counter,
   emit `turn-started`, clear the redo stack, `snapshots.beginTurn`.
5. `await runner.run(signal)`.
6. `finally`: `snapshots.commitTurn`, clear running/controller, resolve any pending prompt with
   `null`.

## 3.4 The turn loop (`SessionRunner.run`)

```
resolve system prompt (once per run)
resolve compaction knobs from the model context window (once per run)
loop:
  if aborted            → emit done{reason:'stopped'}; return
  steers = takeSteers()
  if steers.length > 0  → append each as a user message, emit user-message,
                          reset steps = 0, continue        ← steering
  steps++
  isLastStep = steps >= maxSteps
  await compactIfOverThreshold(signal)
  llmMessages = toLlmMessages(items, opts)  (+ MAX_STEPS_PROMPT when isLastStep)
  stream = llm.stream({ model, system, messages, tools: isLastStep ? [] : visibleToolDefs(),
                        signal, maxOutputTokens: maxOutputTokensWire, variantOptions })
  for each part:
    text      → append to buffer, emit text-delta
    reasoning → append to buffer, emit reasoning-delta
    tool-call → record ToolCallData(permission:'pending'), emit tool-start
    finish    → capture tokens + finishReason, accumulate run usage, emit onUsage per step
    error     → tryRecoverFromReject(); if recovered: steps--, retry the step
                otherwise persist partial text, emit error, return
  if aborted → persist partial, emit done{reason:'stopped'}; return
  append the assistant message (text + reasoning + tokens) if anything was produced
  decide permissions for every call
  run auto-approved calls in PARALLEL (Promise.all)
  run 'ask' calls SERIALLY afterwards (so two prompts never appear at once)
  if no tool call → emit done{reason: finishReason === 'length' ? 'length' : 'complete'}; return
  if isLastStep   → emit done{reason:'max-steps'}; return
```

Notable details:

- `visibleToolDefs()` filters out tools whose permission decision is `deny`, so a denied tool is not
  even advertised to the model.
- On the last step, tools are removed entirely and a final user message is appended:
  `"Final step: wrap up and provide your final answer now. Tool calls are disabled."`
- `finishReason === 'length'` is reported as `done{reason:'length'}` rather than `complete`, so the
  UI can tell the user the answer was cut off at the output cap.
- Usage is emitted **per step**, not only at the end, so cost is recorded even if the user hits Stop.

### Constants

| Constant | Value | Where |
|---|---|---|
| `DEFAULT_MAX_STEPS` (loop fallback) | 50 | `loop.ts` |
| `DEFAULT_MAX_STEPS` (config default, what is actually passed) | 100 | `config.ts` |
| `DEFAULT_SUBAGENT_MAX_STEPS` | 30 | `config.ts` |
| `MAX_COMPACT_PER_RUN` | 2 | `loop.ts` |
| `DEFAULT_KEEP_FULL_TURNS` | 2 | `loop.ts` |
| `MAX_QUEUE` | 5 | `meow-agent-manager.ts` |

## 3.5 Tool execution (`SessionRunner.executeCall`)

1. Resolve the decision: `allow` → run; `deny` → refuse with
   `tool "<name>" is not permitted in the current mode`; `ask` → emit `prompt-request`
   (`kind: 'permission'`) and await the user's `PromptResponse`. The pending prompt's content is
   stored in the manager so a remounted chat panel (tab switch) can restore it via `getPendingPrompt`
   instead of leaving the agent waiting forever.
2. On denial the call is marked `permission: 'denied'` with an error string; it is still appended to
   the transcript so the model sees the refusal.
3. On allow, build the `ToolContext`:

| Field | Purpose |
|---|---|
| `cwd` | The agent's working directory |
| `signal` | Abort signal of the current turn |
| `agentId`, `taskId`, `turn` | Identity/trace correlation |
| `snapshots`, `snapshotAgentId` | Undo support; a subagent snapshots under the **parent's** id |
| `diagnostics(filePath, text)` | LSP diagnostics, injected only when `lsp.enabled` |
| `setTodos(todos)` | Todo sink (absent for subagents, which is why they never get `todowrite`) |
| `emitSubagent(taskId, e)` | Bubbles subagent progress up as `subagent-event` |
| `ask(question)` | Emits `prompt-request` (`kind: 'question'`) and awaits the answer |
| `onFileRead(filePath)` | Returns a `<system-reminder>` block with nearby `AGENTS.md`/`CLAUDE.md` content, deduped across the session |
| `onArtifact(entry)` | Records a created/edited file for the Artifacts panel |

4. `await def.run(input, ctx)` → `{ output?, error? }`; thrown errors become `call.error`.
5. Append the tool item to the transcript and emit `tool-result`.

### Instruction attachment on read

`onFileRead` implements opencode's behavior: when the model reads a file, the nearest
`AGENTS.md`/`CLAUDE.md` files walking up to the repo root are appended to that tool's output inside
`<system-reminder>` tags. Files already inlined into the system prompt
(`systemInstructionPaths`) or already attached earlier this session (`attachedInstructions`) are
skipped, so instructions are never repeated.

## 3.6 Permissions

`src/main/agent/permission.ts`.

```
decide(ctx, toolName, input):
  if mode === 'plan' and tool === 'bash' and isWriteBashCommand(input.command) → 'deny'
  combined = { ...ctx.rules, ...rulesForMode(ctx.mode) }      // plan rules win
  if any matching pattern maps to 'deny'                       → 'deny'
  if mode !== 'plan' and ctx.isSavedAllow(tool)                → 'allow'
  if any matching pattern maps to 'allow'                      → 'allow'
  else                                                          → 'ask'
  finally: if 'ask' and !ctx.canPrompt                          → 'deny'
```

- **Patterns**: exact name, `prefix*` (e.g. `browser_*`), or `*`.
- **`canPrompt: false` means deny.** No channel to ask through is not permission to proceed. This is
  what makes background subagents safe.
- **Plan mode** (`PLAN_RULES`) allows `read`, `glob`, `grep`, `webfetch`, `websearch`, `skill`,
  `question`, `task`; asks for `bash` and `browser_*`; denies `write`, `edit`, `apply-patch`,
  `revert`, `git`, `todowrite`.
- **Bash is the leak.** A model denied `write` will happily run `sed -i`, `echo > file`, or
  `node -e "fs.writeFileSync(...)"`. `isWriteBashCommand` detects write redirects, write-ish command
  tokens (`sed -i`, `perl -i`, `tee`, `dd`, `mv`, `rm`, `cp`, `mkdir`, `touch`, `chmod`, `chown`,
  `install`, `truncate`, `mkfifo`, `unlink`, `rmdir`, `apply-patch`) and Node/Python write APIs, and
  those are **denied outright in plan mode**, not merely asked about.
- **Saved allows** ("always allow" in the prompt UI) are persisted per project+tool in
  `permissions.json` and deliberately do **not** bypass plan mode.

Defaults from `DEFAULT_MEOW_CONFIG.permission`:

| Rule | Tools |
|---|---|
| `allow` | `read`, `write`, `edit`, `glob`, `grep`, `apply-patch`, `todowrite`, `task`, `revert`, `skill`, `question`, `browser_*` |
| `ask` | `bash`, `office` |

Tools not listed anywhere fall through to `ask` (this is how MCP and user tools behave until a rule
is added).

## 3.7 Message queue and steering

Two different behaviors share one queue:

- **Queued** — the user sent a message while a turn was running. It shows as a `queued` badge row in
  the feed; `removeQueued` / `editQueued` manage it (`Channels.ChatQueueRemove` / `ChatQueueEdit`).
- **Steering** — at the top of every loop iteration, `takeSteers()` drains the whole queue into the
  running turn as user messages and **resets `steps` to 0**, giving the continued work a fresh step
  budget (mirroring opencode's `currentStep` reset).

`removeQueued` also calls `store.removeMessage(...)` and emits `message-removed`, so deleting a
message that was already injected removes its bubble everywhere.

`stopAndDrain` (what the Stop button calls) aborts the turn but **keeps the queue** and immediately
starts the next queued message.

## 3.8 Context compaction

`src/main/agent/compact.ts` + `SessionRunner.compactIfOverThreshold`.

### Budget

```
usableContextTokens(limit, buffer, outputReserve) = limit - buffer - outputReserve
```

- `buffer` covers what the transcript estimate cannot see: system prompt and tool definitions.
- `outputReserve` covers what the model is still going to write. Omitting it let a prompt fill the
  window and then be rejected mid-answer.
- If `usable <= 0` (tiny context window), compaction still runs against the hard ceiling
  `limit - reserve` so self-healing is never disabled.

### Auto knobs

`resolveCompactionSettings(raw, contextLimit, outputReserve)` fills any knob left `undefined` from
ratios of the model's context window, with floors:

| Knob | Ratio | Floor |
|---|---|---|
| `buffer` | 0.15 | 10 000 |
| `keepTokens` | 0.06 | 4 000 (also clamped to ≤ half the usable context) |
| `toolOutputMaxChars` | 0.015 | 1 500 |

Explicitly configured values pass through unchanged as overrides.

### Trigger

At the start of every step:

```
estimate        = estimateUsage(toLlmMessages(items, opts))     // ~3.5 chars/token
providerTokens  = last reported total from the provider
usedTokens      = max(estimate, providerTokens)
if usedTokens < usable → return
```

The provider count is trusted because it includes the system prompt and tool definitions, but it
lags behind tool outputs appended after the last response — hence the `max`.

### Ladder

1. **Prune** (`pruneToolOutputs`, enabled by `compaction.prune`): clears the `output` of completed
   tool calls older than the last two turns, replacing it with `[Old tool result content cleared]`.
   Protects the newest ~9% of the context window worth of tool output and only fires if it can free
   more than ~4.5%. `skill` outputs are never pruned. Re-checks against a fresh estimate afterwards.
2. **LLM summarization** (`compact`):
   - `selectHeadTail(items, keepTokens, tailTurns)` splits the transcript; the tail is the most
     recent `tailTurns` turns that fit in `keepTokens` (always at least one turn).
   - Any previous compaction pair is stripped from the head and its summary is passed separately as
     `<previous-summary>` so it is updated rather than re-summarized.
   - `fitHeadToBudget` drops the oldest turns until the summary prompt itself fits the window.
   - `compactTranscript` runs a tool-less LLM call with `COMPACTION_SYSTEM` and a fixed markdown
     template (Objective / Important Details / Work State {Completed, Active, Blocked} / Next Move /
     Relevant Files).
   - On success the transcript is replaced with `[marker user message, summary assistant message,
     ...tail]` and `compacted` is emitted. The marker text is the constant
     `COMPACTION_MARKER = 'What did we do so far?'`.
   - On failure `compaction-failed` is emitted and the ladder falls through to step 3.
3. **Hard truncate** (`hardTruncate`) — last resort when the head is empty, the per-run compaction
   budget (`MAX_COMPACT_PER_RUN = 2`) is spent, or the summary call failed: clear every tool output,
   then drop the oldest turns, always keeping the final turn even if it alone exceeds the target.

### Self-healing on provider rejection

If the provider rejects the request with a context-overflow error
(`classifyContextOverflowError`), `tryRecoverFromReject`:

1. Records the learned ceiling (`parseContextLimitFromError(message) ?? estimateUsage(prompt)`) via
   `onContextOverflow` → `LearnedLimitsStore.recordContextOverflow`.
2. Runs `forceCompact` (the ladder, ignoring the threshold).
3. Returns `true`, and the loop retries the same step without consuming a step
   (`steps--`). Bounded by `MAX_COMPACT_PER_RUN` so a genuinely oversized prompt surfaces an error
   instead of looping.

### Idle compaction

`MeowAgentManager` runs a 20-second timer (`maybeCompactIdle`). For each registered agent that is
not running and not already compacting, with at least 60s since its last attempt, it compares the
last reported usage against the threshold and calls `runner.compactIfOverThreshold()`. Without this,
a session parked over its limit would only compact when the user sent the next message.

### Tool-output caps (two different mechanisms)

| Mechanism | Scope | Config | Effect |
|---|---|---|---|
| `TruncationStore.truncate` | At prompt-build time, per tool result | `toolOutput.maxBytes` (51 200), `toolOutput.maxLines` (2 000) | Writes the full output to `userData/truncation/<agentId>-<toolId>.txt` and puts a head+tail preview with the file path in the prompt |
| `toolOutputMaxChars` | Older tool results only | auto or explicit | Recent tail turns (`keepFullTurns = tailTurns`) reach the model at full size; older ones are capped, so a `read` or a test run stays useful while it matters |
| MCP output cap | MCP tools only | `mcpOutput.maxTokens` (default 25 000) | Same head/tail + file preview, applied inside the MCP `run` wrapper |

## 3.9 Context and output limits

`src/main/agent/limits.ts`, `learned-limits.ts`, `config.ts`.

`LimitsService.resolveLimits({provider, model, baseUrl, apiKey, overrides})` resolves in priority
order and returns `{ context: number, output: number | null }`:

1. **Override** — `maxContextTokens` / `maxOutputTokens` from `meow.json`. `maxOutputTokens` is an
   optional override; when absent it resolves to `output: null` (omit `max_tokens`), letting the
   provider decide.
2. **Learned** — `learned-limits.json`, keyed `baseUrl|model`. Only ever tightens, never raises.
3. **Live `/models`** — fetched in the background from an OpenAI-compatible endpoint, cached per
   `baseUrl|apiKey` with a TTL.
4. **Catalog** — models.dev via `ModelsCatalog.getModelLimit`.
5. **Default** — `DEFAULT_MAX_CONTEXT_TOKENS = 128000`.

`output: null` means *omit `max_tokens` entirely* and let the provider choose — that request can
never fail with "max_tokens exceeds".

Two distinct output numbers exist and must not be confused:

| Name | Meaning |
|---|---|
| `maxOutputTokensWire` | The verified value actually sent to the provider as `max_tokens`; `undefined` = omit |
| `maxOutputTokens` (the **reserve**) | `resolveOutputTokens(...)` — used only for budgeting: subtracted from the context window for compaction and shown in the UI footer |

`resolveOutputTokens(modelLimit, contextLimit, fallback)` =
`min(modelLimit.output ?? fallback, MAX_OUTPUT_HARD_CAP (131 072), floor(contextLimit / 2))`.
The half-context guard exists because some catalog entries claim 1M output tokens, which would push
the auto-compact threshold to zero.

## 3.10 LLM client, retries and budget reduction

`src/main/agent/llm.ts`.

### Providers

| `provider` value | SDK | Notes |
|---|---|---|
| `anthropic` | `@ai-sdk/anthropic` | Adds `cacheControl: ephemeral` at the top level (caches the system prompt) plus message-level cache breakpoints |
| `google` | `@ai-sdk/google` | — |
| anything else | `@ai-sdk/openai-compatible` | `baseURL` defaults to `https://api.openai.com/v1`; DeepSeek endpoints get `includeUsage: true` and a custom usage converter for `prompt_cache_hit_tokens` |

**Anthropic cache breakpoints** (`withCacheBreakpoints`): the end of the stable prefix and the last
message are tagged. For a compacted transcript the break is placed *after the summary*, not on the
one-line marker, since the summary is the most valuable stable prefix.

**API key validation**: keys must be printable ASCII (`/^[\x21-\x7E]+$/`). A non-ASCII key would
otherwise blow up inside undici with `Cannot convert argument to a ByteString`; both
`connectProvider` and the stream entry point reject it with a readable message.

### Retry policy (`withRetry`)

Re-runs a stream that failed **before producing anything**. Once any part has been yielded the
attempt is not repeated (replaying would duplicate text the caller already consumed).

| Setting | Value |
|---|---|
| `maxAttempts` | 10 (rate-limit responses only) |
| `baseDelayMs` | 1000, exponential (`base * 2^(attempt-1)`) |
| `MAX_RETRY_AFTER_MS` | 60 000 — caps a large provider `Retry-After` |
| Sleep | `abortableSleep` — Stop interrupts a backoff immediately |

Retryable: HTTP `408, 409, 425, 429, 500, 502, 503, 504, 529`, and socket errors
`ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, ENOTFOUND, EAI_AGAIN, UND_ERR_SOCKET`. `AI_RetryError`
is unwrapped and its inner cause classified. `AbortError` is never retried.

Server (5xx) and socket errors are classified as **unbounded**: the turn keeps retrying past
`maxAttempts` until the network/API comes back (Claude CLI-style), with only success or Stop as a way
out. Rate limits (408/409/425/429) retry up to `maxAttempts` (10) and then surface the error.

`onRetry` fires before each real retry, and the manager turns it into a `retry` `ChatEvent` so the
chat shows a transient "Retrying…" line. That line lives only in renderer feed state — it is never
written to the transcript.

### Budget reduction

A non-retryable 400 can still be recoverable. When the catalog overstates a model's real output cap,
the provider answers `max_tokens (N) exceeds model's maximum output tokens (M)`.
`reduceBudgetForMaxTokensError` parses `M`, the stream is re-run with that budget, and
`onReducedBudget(M)` persists it in `learned-limits.json` so the next turn starts correct.

## 3.11 Subagents (the `task` tool)

`src/main/agent/tools/task.ts`.

### Roles

Discovery order, first-wins by name: `<cwd>/.meow/agents/*.md` → `userData/agents/*.md` →
`BUILTIN_ROLES`.

Frontmatter keys: `name`, `description`, `tools` (comma-separated, filtered to tools that actually
exist), `model` (`provider/model`), `deny`, `ask`. **There is no `allow` key** — a role file can only
*narrow* what the user's own rules already grant. The body is the role's system prompt.

| Built-in role | Tools | Purpose |
|---|---|---|
| `research` | `read`, `glob`, `grep`, `webfetch` | Read-only investigation. The **only** role permitted in plan mode. |
| `general` | `read`, `glob`, `grep`, `webfetch`, `write`, `edit`, `apply-patch`, `bash`, `git`, `skill` | Implements changes; returns a status line `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` |
| `reviewer` | `read`, `glob`, `grep`, `git`, `webfetch` | Reviews a diff read-only; returns `APPROVED` / `CHANGES_REQUESTED` plus severity-tagged findings |

### Permission derivation

`deriveSubagentContext(parent, role, { background })`:

- Starts from the parent's rules, then applies the role's rules **only where they are stricter**
  (`allow < ask < deny`).
- `canPrompt = parent.canPrompt && !background` — a background subagent cannot ask, so anything that
  would ask is denied.
- Re-resolved on every tool call, so a mode switch or a newly saved always-allow reaches a subagent
  that is already running.
- Without a `permission` resolver the fallback is `NO_PERMISSION` (rules `{}`, `canPrompt: false`) —
  a caller that forgets to wire permissions gets a subagent that can do nothing, not everything.

### Execution

- The subagent gets its own `SessionRunner` with `agentId = sub-<role>-<taskId>`, its own transcript
  array, `maxSteps` from `subagentMaxSteps` (default 30), and the parent's compaction/tool-output
  budget.
- `todowrite` is always removed (a subagent runner has no `setTodos` sink).
- `task` is **not** in the tool map handed to `createTaskTool`, so subagents cannot nest.
- Edits snapshot under `snapshotAgentId = parentAgentId`, so parent undo/revert reaches them.
- Usage is reported with the subagent's *own* model so tokens are priced correctly, and it does
  **not** overwrite `lastUsageByAgent` (that drives the parent's overflow check, and the subagent
  runs in a separate context).
- Progress is surfaced as `subagent-event` (`start` / `delta` / `tool` / `done`) with
  `parentTaskId`, so the UI can draw a subagent tree.
- Sessions are resumable via `task_id` and bounded at `DEFAULT_MAX_SESSIONS = 20` (LRU).
- Result rendering: `<task id="..." state="completed|incomplete" reason="max-steps|length">…</task>`,
  where the text is the last non-empty assistant message.

### Background subagents

`background: true` returns immediately with `Subagent <id> (<role>) running in background.` The
subagent gets its own `AbortController` (the turn's controller is gone once the turn ends);
`onBackgroundStart` hands the manager a cancel handle, and `onBackgroundResult` appends the result
as an assistant message **to the session that spawned it** — not whichever session is active when it
finishes.

## 3.12 Undo / redo

- `snapshots.beginTurn(agentId)` at turn start; write tools record pre-change content via
  `ToolContext.snapshots`; `commitTurn` stores `{ before, after }` for the turn. Capped at
  `MAX_SNAPSHOTS = 50` turns.
- `undo(agentId)`: stop the turn, await it winding down, pop the snapshot turn (restoring `before`
  contents), then `store.truncateFromLastUser(sessionId)` and push the removed items + turn onto the
  redo stack.
- `redo(agentId)`: write back the `after` contents, push the turn back onto the snapshot stack, and
  re-append the removed transcript items.
- The redo stack is cleared whenever a new turn starts.
- The `revert` tool exposes the same snapshot store to the model.

## 3.13 Slash commands

`src/main/agent/commands.ts`, dispatched by `MeowAgentManager.runCommand`.

Sources merged by `listCommands(projectPath)` (first wins): user commands (`commands.json`) →
project commands (`.meow/commands/*.md` with frontmatter `name`/`description`), plus the built-ins
from `CommandStore`.

Built-ins:

| Command | Type | Behavior |
|---|---|---|
| `/init` | prompt | Create or improve the project's `AGENTS.md` |
| `/review` | prompt | Review uncommitted changes read-only |
| `/new` | **system** | Creates a new session and emits `session-created` — never reaches the LLM |
| `/frontend-design` | prompt | Invokes the `frontend-design` skill with `$ARGUMENTS` |
| `/sp-<name>` ×14 | prompt | Invokes the corresponding Superpowers skill: `brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills` |

Built-in commands cannot be removed. Template resolution (`resolveCommandTemplate`):

- `$ARGUMENTS` → the whole argument string.
- `$1..$N` → quote-aware tokens; the **highest referenced index slurps the rest**.
- Backtick shell interpolation runs each embedded command in `cmd.exe /d /s /c` (Windows) or `sh -c`
  with a **10s timeout**; failures are inlined as `(shell error: …)`.

The UI shows the raw `/cmd args` (as `displayText`) while the LLM receives the resolved prompt.

## 3.14 Modes

| Mode | System prompt addendum | Permissions |
|---|---|---|
| `build` (default) | none | Config rules only |
| `plan` | "You are in PLAN MODE: read-only analysis. Do NOT create, edit, or delete files. write/edit/apply-patch/revert/git/todowrite tools are unavailable, and do NOT use the bash tool to modify the filesystem either. Produce a plan or analysis instead." | `PLAN_RULES` layered on top; write-shaped bash denied; only the `research` subagent may run |

`setMode` rebuilds the runner **even while a turn is running** — the in-flight runner keeps its own
reference, but the next turn must see the new mode.

## 3.15 Trace

Enabled by `trace.enabled` in `meow.json` (default `false`). When on, `MeowAgentManager.writeTrace`
mirrors `ChatEvent`s into `TraceStore` as `TraceEvent`s, with two refinements:

- Text/reasoning deltas accumulate into one pending assistant `message` event and are flushed at the
  next event boundary — the trace shows full content, not one row per delta.
- Tool durations are measured from `tool-start` to `tool-result`.
- PTY agents also contribute `pty-run` events (start ts, end ts, exit code, duration, log path).

When tracing is disabled at startup, `userData/traces` is deleted outright so nothing lingers.
