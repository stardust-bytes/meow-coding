# Retry-Error User Prompt — Design Spec

Date: 2026-08-30 · Status: awaiting review

## 1. Goal

When the LLM turn fails in a way that automatic retry cannot recover (a non-retryable error such as
a 400/auth/context-overflow, or a retryable error that exhausted the built-in retry budget), the
user should be asked whether to **Retry** (resume the step mid-stream, keeping all progress and
context) or **Stop**. This replaces the current behavior of immediately ending the turn with an
inline error row, discarding the streamed partial work.

The retry must be a true in-place resume: it does **not** re-send the user's message, does **not**
duplicate already-streamed text, and keeps the partial assistant output in the transcript so the
model continues from where it left off.

## 2. Scope & Decisions

| Topic | Decision |
|---|---|
| Trigger | Show the prompt only when the error is **not recoverable by the automatic retry** — i.e. after `withRetry` gives up (a retryable error exhausted its budget) or immediately for a non-retryable error. Never intercept errors the automatic `withRetry` can still recover. |
| Prompt kind | Reuse the existing `prompt-request` mechanism (like `permission`/`question`). Add `kind: 'retry'` to `ChatEvent.prompt-request` and `PendingPromptInfo`. |
| Choices | Two buttons only: **Retry** (resume in place) and **Stop**. No "Continue" button. |
| Resume semantics | `persistPartial()` keeps the real emitted output in the transcript; Retry appends a continuation user nudge (`RETRY_CONTINUE_PROMPT`) and `continue`s, so `buildMessages()` re-serializes from the transcript (source of truth) and the model continues from the partial. No user-message re-send, no text duplication. |
| User retry cap | `MAX_USER_RETRIES = 3` per turn, tracked by a new `retriesThisRun` counter reset at the top of `run()`. Past the cap the turn ends with `emit error` (never a silent loop). |
| Stop | `respondPrompt { allow: false }` → `askRetryOrStop` returns `false` → the loop `emit done('stopped')` + `return`. |
| Badge / notification | Treated like any pending prompt (`onPromptStateChange(true)` → sidebar badge, OS "Input needed" notification) so a waiting retry is visible and restorable on remount. |
| Remount restore | `getPendingPrompt` already restores a pending prompt on remount; `kind: 'retry'` flows through the same path. |
| Type surface | `ChatEvent.prompt-request.kind` already exists; widen the union. No new event type. |
| Docs language | English, per `AGENTS.md`. |

## 3. Architecture

### 3.1 Shared types (`src/shared/types.ts`)

Widen the `kind` union on the existing `prompt-request` event and on `PendingPromptInfo`:

```ts
// ChatEvent.prompt-request
| { type: 'prompt-request'; agentId: string; promptId: string
    kind: 'permission' | 'question' | 'retry'; call?: ToolCallData; question?: string
    options?: QuestionOption[]; multiple?: boolean; custom?: boolean
    taskId?: string; subagentType?: string }

// PendingPromptInfo
export interface PendingPromptInfo {
  promptId: string
  kind: 'permission' | 'question' | 'retry'
  call?: ToolCallData
  question?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
  taskId?: string
  subagentType?: string
}
```

### 3.2 Loop error points (`src/main/agent/loop.ts`)

Two error paths currently end the turn unconditionally; both become ask-then-decide:

1. **Error part** (`part.kind === 'error'`, `loop.ts:274-284`):
```ts
} else if (part.kind === 'error') {
  if (await this.tryRecoverFromReject(llmMessages, part.error, signal)) {
    steps--; recover = true; break
  }
  persistPartial()
  this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
  return
}
```
becomes: persist partial, then ask the user. If they choose Retry and the cap allows it, `continue`
the loop instead of returning; if Stop (or the cap is reached), end the turn.

2. **Thrown error** (`catch`, `loop.ts:285-303`): the `formatLlmError(err)` path with
`signal?.aborted` currently branches to `done('stopped')` and everything else to `error`. For the
non-abort case, ask the user instead of emitting `error` and returning.

A shared helper captures the ask-or-end logic so both paths are identical. Note the resume is the
same mechanism the truncation path already uses: the partial assistant text is in the transcript, so
a Retry appends a continuation nudge (`deps.appendMessage`) before `continue`, and the next
iteration's `buildMessages()` re-serializes from that transcript. This is why no user message is
re-sent and no text is duplicated.

```ts
// module scope / class constant
private readonly MAX_USER_RETRIES = 3
private retriesThisRun = 0
private readonly RETRY_CONTINUE_PROMPT =
  '<system-reminder>\nThe previous turn failed partway. Continue from where you left off, ' +
  'without repeating what you already wrote.\n</system-reminder>'

// new private method
private async askRetryOrStop(message: string, signal?: AbortSignal): Promise<boolean> {
  // returns true when the caller should continue the loop (Retry), false to end (Stop).
  if (this.retriesThisRun >= this.MAX_USER_RETRIES) return false
  const promptId = randomUUID()
  const resp = await this.deps.ask(promptId, undefined, {
    promptId,
    kind: 'retry',
    question: message
  })
  if (resp?.allow) {
    this.retriesThisRun++
    return true
  }
  return false
}
```

Caller for path 1 (Retry appends the continuation nudge, then `continue`):
```ts
persistPartial()
if (signal?.aborted) {
  this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
  return
}
if (await this.askRetryOrStop(part.error ?? 'llm error', signal)) {
  this.deps.appendMessage({ id: randomUUID(), role: 'user', text: this.RETRY_CONTINUE_PROMPT, createdAt: Date.now() })
  continue
}
this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
return
```

Caller for path 2 (non-abort only):
```ts
persistPartial()
if (signal?.aborted) {
  this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
  return
}
if (await this.askRetryOrStop(message, signal)) {
  this.deps.appendMessage({ id: randomUUID(), role: 'user', text: this.RETRY_CONTINUE_PROMPT, createdAt: Date.now() })
  continue
}
this.deps.onEvent({ type: 'error', agentId, message })
return
```

Reset `this.retriesThisRun = 0` at the top of `run()` next to the existing
`compactedThisRun`/`rejectRetriesThisRun`/`lengthResumesThisRun` resets (`loop.ts:118-119`).

### 3.3 Manager (`src/main/meow-agent-manager.ts`)

`awaitPrompt` (already generic, `meow-agent-manager.ts:1254`) stores any prompt in
`pendingPrompts`, flips `onPromptStateChange(agentId, true)` (sidebar badge), fires the OS "Input
needed" notification, and emits `prompt-request`. `kind: 'retry'` flows through unchanged — no
`tool` is attached, which is fine because `respondPrompt` only special-cases `resp.always` with a
tool (a retry prompt never sets `always`).

No change needed in `getPendingPrompt` / `listPendingPrompts` — they read the stored info as-is.

### 3.4 Renderer (`src/renderer/src/components/chat/ChatPanel.tsx`)

The `prompt-request` handler (`ChatPanel.tsx:518`) already stores `pendingPrompt` with `promptType:
e.kind`. Add a `kind === 'retry'` render branch alongside the existing permission/question UI:

- Render a question header + the error text (`pendingPrompt.question`) + two buttons: **Retry**
  (`respond(promptId, true)`) and **Stop** (`respond(promptId, false)`).
- Keyboard: Enter/1 → Retry, Esc/2 → Stop (mirror the permission-prompt key mapping where
  practical). Only active when `pendingPrompt.promptType === 'retry'`.
- `submitQuestion`/`runSelected`/`cycleAction` (permission-specific) must not be reused for
  `retry`; a retry prompt is a simple two-choice prompt.

No feed-item change: the retry prompt rides the existing `pendingPrompt` flow and is not persisted
as a transcript item.

## 4. Data Flow

```
loop.ts error point
  → persistPartial()                       (partial output kept in transcript)
  → ask(promptId, undefined, {kind:'retry', question: <error message>})
      → awaitPrompt (manager)              (store pendingPrompts, badge, notification, emit prompt-request)
          → ChatPanel shows Retry/Stop popup
              → respondPrompt {allow:true} → resolve → await resolves → askRetryOrStop returns true
                  → continue → buildMessages re-serializes from transcript (incl. partial) → resume
              → respondPrompt {allow:false} → resolve → askRetryOrStop returns false
                  → emit error (or done('stopped')) → return
```

## 5. Error Handling

- **User chooses Stop** (`allow:false`) or **prompt is aborted** (`null` response): `askRetryOrStop`
  returns `false`; the caller emits `done('stopped')` and returns — no loop, no error row.
- **Cap reached** (`retriesThisRun >= MAX_USER_RETRIES`): `askRetryOrStop` returns `false`; the
  caller emits `error` and returns — no prompt, no infinite loop.
- **Abort during prompt** (`signal.aborted` while waiting on `ask`): `awaitPrompt` already resolves
  `null` for an aborted prompt; `askRetryOrStop` treats a `null` response as Stop (returns `false`),
  so an external Stop always wins.
- **Non-retryable error**: still prompts (that is exactly the point — a 400/auth overflow should
  offer the user a Retry after they fix the underlying cause).
- **No partial output**: `persistPartial()` is a no-op when nothing was streamed; Retry appends the
  continuation nudge and re-runs the same step from the transcript (unchanged), which is equivalent
  to re-running the step.

## 6. Testing

- Unit (`tests/unit/agent-loop.test.ts`): using the model stub, force a non-retryable error part on
  the first step; assert that with `ask` returning `{allow:true}` the loop continues and re-emits
  output from a fresh stream, without duplicating the partial text; assert that `allow:false` ends
  the turn with `done('stopped')`; assert that 3 Retries then a 4th failure ends with `error`.
- Unit: `retriesThisRun` resets between separate `run()` calls.
- Typecheck + `npm test` must pass. Renderer has no unit tests; the e2e smoke
  (`npm run build && npm run e2e`) must not break.

## 7. Success Criteria

- A non-retryable or exhausted-retry error shows a Retry/Stop popup instead of ending the turn.
- Retry resumes the same step, keeps streamed partial output, and does not re-send the user message.
- Stop (from the popup) ends the turn cleanly and does not loop.
- At most 3 user-initiated retries per turn.
- The popup is treated as a pending prompt (sidebar badge + OS notification) and is restored on
  remount via `getPendingPrompt`.

## 8. Files Touched

- `src/shared/types.ts` — widen `kind` union (`prompt-request` + `PendingPromptInfo`).
- `src/main/agent/loop.ts` — `askRetryOrStop`, `retriesThisRun`, `MAX_USER_RETRIES`, wire into the
  two error paths, reset counter in `run()`.
- `src/main/meow-agent-manager.ts` — verification only (no change expected; `awaitPrompt` is generic).
- `src/renderer/src/components/chat/ChatPanel.tsx` — retry prompt render branch + key handling.
- `src/main/agent/AGENTS.md` + `src/renderer/src/components/chat/AGENTS.md` — update the
  loop/chat rows to mention the retry prompt.
- `docs/reference/03-agent-runtime.md` — update the turn-loop pseudocode and the `ask`/prompt table
  to describe the `kind: 'retry'` prompt; add the `MAX_USER_RETRIES` constant row.
