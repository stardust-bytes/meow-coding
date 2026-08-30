# Retry-Error User Prompt — Implementation Plan

Date: 2026-08-30 · Spec: `docs/superpowers/specs/2026-08-30-retry-error-user-prompt-design.md`

## File Structure

| File | Change |
|---|---|
| `src/shared/types.ts` | Widen the `kind` union on `prompt-request` and `PendingPromptInfo` to include `'retry'`. |
| `src/main/agent/loop.ts` | Add `retriesThisRun`/`MAX_USER_RETRIES`/`RETRY_CONTINUE_PROMPT`; replace the two error-path `emit error + return` with prompt-then-decide. |
| `src/renderer/src/components/chat/ChatPanel.tsx` | Render a Retry/Stop branch for `pendingPrompt.promptType === 'retry'`; reject the permission/question keyboard handlers for it. |
| `tests/unit/agent-loop.test.ts` | Add retry-prompt cases; update the existing "surfaces an llm error event" test (default `ask` returns `null` → Stop → `done('stopped')`). |
| `src/main/agent/AGENTS.md` | Update the `loop.ts` row + constants table to mention the retry prompt. |
| `docs/reference/03-agent-runtime.md` | Update the turn-loop pseudocode, the `ask` table, and add `MAX_USER_RETRIES`. |

No change to `src/main/meow-agent-manager.ts` — `awaitPrompt`/`getPendingPrompt`/`respondPrompt` are
already generic over `kind`. No new IPC channel.

---

## Task 1 — Widen the shared `kind` union

**File:** `src/shared/types.ts`

`ChatEvent.prompt-request` (near line 190):

```ts
| { type: 'prompt-request'; agentId: string; promptId: string
    kind: 'permission' | 'question' | 'retry'; call?: ToolCallData; question?: string
    options?: QuestionOption[]; multiple?: boolean; custom?: boolean
    taskId?: string; subagentType?: string }
```

`PendingPromptInfo` (near line 277):

```ts
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

**Verify:** `npm run typecheck`.

---

## Task 2 — Loop: prompt on unrecoverable error

**File:** `src/main/agent/loop.ts`

Add module constants next to `CONTINUE_TRUNCATED_PROMPT` (line ~98):

```ts
const MAX_USER_RETRIES = 3
const RETRY_CONTINUE_PROMPT =
  '<system-reminder>\nThe previous turn failed partway. Continue from where you left off, ' +
  'without repeating what you already wrote.\n</system-reminder>'
```

Add a private field next to `lengthResumesThisRun` (line ~141):

```ts
private retriesThisRun = 0
```

Reset it at the top of `run()` next to the other resets (line ~167):

```ts
this.retriesThisRun = 0
```

Add the helper method (place with the other private helpers, e.g. near `blockedByStopHook`):

```ts
// Asks the user whether to resume a step that failed after automatic retry
// gave up. Returns true to continue the loop (Retry), false to end (Stop).
private async askRetryOrStop(message: string, signal?: AbortSignal): Promise<boolean> {
  if (this.retriesThisRun >= MAX_USER_RETRIES) return false
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

Replace the **error-part** branch (lines ~274-284). The `recover` case stays; the tail becomes
prompt-then-decide:

```ts
} else if (part.kind === 'error') {
  if (await this.tryRecoverFromReject(llmMessages, part.error, signal)) {
    steps--; recover = true; break
  }
  persistPartial()
  if (signal?.aborted) {
    this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
    return
  }
  const continueRun = await this.askRetryOrStop(part.error ?? 'llm error', signal)
  if (continueRun) {
    this.deps.appendMessage({
      id: randomUUID(),
      role: 'user',
      text: RETRY_CONTINUE_PROMPT,
      createdAt: Date.now()
    })
    continue
  }
  this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
  return
}
```

Replace the **throw** branch (lines ~285-303). Keep the `recover`/`continue` path; the non-abort
tail becomes prompt-then-decide:

```ts
} catch (err) {
  const message = formatLlmError(err)
  if (await this.tryRecoverFromReject(llmMessages, message, signal)) {
    steps--; continue
  }
  persistPartial()
  if (signal?.aborted) {
    this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
    return
  }
  const continueRun = await this.askRetryOrStop(message, signal)
  if (continueRun) {
    this.deps.appendMessage({
      id: randomUUID(),
      role: 'user',
      text: RETRY_CONTINUE_PROMPT,
      createdAt: Date.now()
    })
    continue
  }
  this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
  return
}
```

**Note:** when the cap is reached (`retriesThisRun >= MAX_USER_RETRIES`), `askRetryOrStop` returns
`false`, so the turn ends with `done('stopped')` rather than looping. This keeps the behavior
consistent with the user's choice semantics and avoids a silently infinite loop.

**Verify:** `npm run typecheck`. The existing `agent-loop.test.ts` test
`surfaces an llm error event` will now fail — handled in Task 4.

---

## Task 3 — Renderer: Retry/Stop prompt

**File:** `src/renderer/src/components/chat/ChatPanel.tsx`

1. Widen the `pendingPrompt.promptType` type (`PendingPrompt` interface, line ~26):

```ts
promptType: 'permission' | 'question' | 'retry'
```

2. The existing `prompt-request` handler (line ~518) already sets `promptType: e.kind`; no change.

3. Guard the permission/question keyboard handlers so they do nothing for `retry`:
   - `handleKeyDown` permission branch (line ~682) and the question branch (line ~699) already
     check `promptType !== 'permission'` / `!== 'question'`. Confirm the `retry` type falls through
     and is handled by a new `retry` branch (add it next).

4. Add a `retry` render branch in the `chat-prompt` block (line ~937). Insert it before the
   permission/question ternary. A minimal two-button prompt:

```tsx
{pendingPrompt.promptType === 'retry' ? (
  <>
    <div className="chat-prompt-text">
      {pendingPrompt.question}
    </div>
    <div className="chat-prompt-actions">
      <button
        className="allow"
        onClick={() => respond(pendingPrompt.promptId, true)}
      >
        Retry
      </button>
      <button
        onClick={() => respond(pendingPrompt.promptId, false)}
      >
        Stop
      </button>
    </div>
    <div className="chat-prompt-hint">Enter to retry, Esc to stop</div>
  </>
) : pendingPrompt.promptType === 'permission' ? (
  /* existing permission JSX */
) : (
  /* existing question JSX */
)}
```

5. Add a `retry` keyboard branch in `handleKeyDown` (so Enter = Retry, Esc = Stop). Place it before
   the permission/question branches:

```ts
if (pendingPrompt.promptType === 'retry') {
  const key = e.key
  if (key === 'Enter') { e.preventDefault(); respond(pendingPrompt.promptId, true) }
  else if (key === 'Escape') { e.preventDefault(); respond(pendingPrompt.promptId, false) }
  return
}
```

**Verify:** `npm run typecheck`.

---

## Task 4 — Tests

**File:** `tests/unit/agent-loop.test.ts`

The default harness `ask` is `vi.fn(async () => null)` (line ~52). After Task 2, an unrecoverable
error with a `null` promise resolves to Stop → `done('stopped')`. Update/extend:

1. **Update** `surfaces an llm error event` (line ~231) — the no-answer default now means Stop:

```ts
it('ends a failed llm turn with stopped when the user chooses Stop', async () => {
  const h = makeHarness()
  h.llm.queue = [[{ kind: 'error', error: 'rate limited' }]]
  h.runner.run()
  await new Promise(r => setTimeout(r, 20))
  expect(h.events).toEqual([{ type: 'done', agentId: 'a1', reason: 'stopped' }])
})
```

2. **Add** a Retry case (no partial text, `ask` returns allow):

```ts
it('continues the loop when the user chooses Retry', async () => {
  const h = makeHarness()
  h.ask.mockImplementation(async () => ({ allow: true }))
  h.llm.queue = [
    [{ kind: 'error', error: 'rate limited' }],
    [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
  ]
  h.runner.run()
  await new Promise(r => setTimeout(r, 20))
  expect(h.events.some(e => e.type === 'text-delta' && e.delta === 'ok')).toBe(true)
  expect(h.ask).toHaveBeenCalledTimes(1)
  expect(h.ask.mock.calls[0][2].kind).toBe('retry')
})
```

3. **Add** a Partial-text resume case (verifies no duplication + a nudge was appended):

```ts
it('keeps partial output and appends a resume nudge on Retry', async () => {
  const h = makeHarness()
  h.ask.mockImplementation(async () => ({ allow: true }))
  h.llm.queue = [
    [{ kind: 'text', text: 'partial' }, { kind: 'error', error: 'boom' }],
    [{ kind: 'text', text: 'continued' }, { kind: 'finish' }]
  ]
  h.runner.run()
  await new Promise(r => setTimeout(r, 30))
  const assistant = h.items.filter((i): i is { kind: 'message'; message: ChatMessage } =>
    i.kind === 'message' && i.message.role === 'assistant')
  // partial was persisted, then the resumed stream produced its own assistant message
  expect(assistant).toHaveLength(2)
  expect(assistant[0].message.text).toContain('partial')
  expect(assistant[1].message.text).toContain('continued')
  // a user nudge was appended between the two attempts
  const userNudges = h.items.filter((i): i is { kind: 'message'; message: ChatMessage } =>
    i.kind === 'message' && i.message.role === 'user' && i.message.text.includes('<system-reminder>'))
  expect(userNudges.length).toBeGreaterThan(0)
})
```

4. **Add** a cap test:

```ts
it('ends the turn after MAX_USER_RETRIES retries', async () => {
  const h = makeHarness()
  h.ask.mockImplementation(async () => ({ allow: true }))
  h.llm.queue = [
    [{ kind: 'error', error: 'boom' }],
    [{ kind: 'error', error: 'boom' }],
    [{ kind: 'error', error: 'boom' }],
    [{ kind: 'text', text: 'x' }, { kind: 'finish' }]
  ]
  h.runner.run()
  await new Promise(r => setTimeout(r, 30))
  // 3 allows then Stop on the 4th failure (the run ends, no 4th stream call)
  expect(h.ask).toHaveBeenCalledTimes(3)
  expect(h.llm.calls.length).toBe(3)
  expect(h.events.some(e => e.type === 'done' && e.reason === 'stopped')).toBe(true)
})
```

5. Confirm the paused-prompt path still works (there is already a test for a mid-turn error plus
   `getPendingPrompt`; rely on `meow-agent-manager.test.ts` for `kind:'retry'` round-trip if present).

**Verify:** `npm test` (focus: `agent-loop`), then full `npm test`.

---

## Task 5 — Docs & AGENTS.md sync

**File:** `src/main/agent/AGENTS.md` — update the `loop.ts` row: add "an unrecoverable stream error
(the built-in retry gave up, or a non-retryable error) asks the user Retry/Stop via a
`kind: 'retry'` prompt; Retry resumes with a continuation nudge (max 3 per run), Stop ends the turn
as `done('stopped')`."

**File:** `docs/reference/03-agent-runtime.md`:
- Update the turn-loop pseudocode `error` line to: `error → tryRecoverFromReject(); if recovered: steps--, retry; else persist partial, ask kind:'retry' (Retry → append nudge + continue / Stop → done('stopped'))`.
- Update the `ask` row in the deps table (line ~169): mention it also emits `kind: 'retry'`.
- Add a `MAX_USER_RETRIES` row to the constants table (line ~141 area).

**Verify:** grep the docs for consistency; no build impact.

---

## Task 6 — Full verification

Run, in order:

```bash
npm run typecheck
npm test
```

If any renderer/e2e behavior changed: `npm run build && npm run e2e`.

## Acceptance criteria

- A non-retryable or exhausted-retry error shows a Retry/Stop popup instead of ending the turn.
- Retry resumes the same step, keeps the streamed partial output, and does not re-send the user message.
- Stop (from the popup) ends the turn cleanly as `done('stopped')`, no loop.
- At most 3 user-initiated retries per turn.
- The popup is a pending prompt: sidebar badge, OS notification, restored on remount via `getPendingPrompt`.
