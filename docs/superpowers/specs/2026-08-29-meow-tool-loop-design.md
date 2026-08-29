# Meow Agent Tool-Calling Loop — Design Spec

Date: 2026-08-29 · Status: awaiting review

## 1. Goal

Part 2 of the 4-part Claude Code ↔ Meow comparison series (part 1: harness system prompt,
implemented in `2026-08-29-meow-agent-full-harness-prompt`). This part compares the
**tool-calling loop** — tool-use → tool_result, stop_reason, parallel tool use, error wrapping,
retry — between Claude Code's agent loop and Meow's current `loop.ts` / `llm.ts`, and applies the
gaps that are worth closing.

The comparison was already done and reported in-session (with SDK-level verification). This spec
records the **applied** improvements only. The findings, distilled:

- **tool-use → tool_result flow** is Anthropic-correct already (assistant tool-call blocks, then
  tool-result messages) — no change needed.
- **Parallel tool use** is a strength (`Promise.all` for auto-approved calls, serial for
  permission-asking) — needs test coverage, not code.
- **Error wrapping** uses `String(err)` — loses `Error.message` to `[object Object]` and drops
  partial tool output when a tool returns both `output` and `error`.
- **Retry** is at near-parity with Claude CLI (unbounded network/server retries, 10 attempts for
  rate limits, Retry-After capped at 60s, `reduceBudget` on `max_tokens` rejects) — the `retry`
  UI event it feeds is **already implemented end-to-end** (see §2, P4).
- **stop_reason handling** is the biggest gap: `'length'` (max_tokens) truncation stops the turn
  with a "cut off" error instead of resuming it; `'refusal'`/`content_filter` is silently reported
  as `complete`.

## 2. Scope & Decisions

| Topic | Decision |
|---|---|
| P1 · Resume on truncation | When the provider cuts the answer at the output cap (`length`/`max_tokens`) **with no tool calls**, append a persisted continuation user message and continue the loop, capped at `MAX_LENGTH_RESUMES = 3` consecutive resumes per run. After the cap, emit `done('length')` exactly as today (ChatPanel's existing "cut off" error stays the last-resort). |
| P1 · continuation message | A real user message persisted to the transcript (so replay + later turns stay correct), wrapped in `<system-reminder>` for consistency with the harness's reminder convention. Not surfaced as a new UI bubble — the running assistant bubble keeps appending, so the user sees a seamless continued answer (Claude-Code-like). |
| P2 · error wrapping | New `formatToolError(err)` helper used where tools throw (`loop.ts:391`): `Error.message` for `Error`, the string itself for strings, JSON-safe stringify otherwise (fallback to `String`). |
| P2 · partial output + error | `message.ts` serialization: when a tool returns both `output` and `error`, the `error-text` value carries `output + '\n\nERROR: ' + error` instead of dropping the output. |
| P3 · stop_reason taxonomy | New `classifyFinish(reason)` mapping: `stop`/`end_turn`/`stop_sequence`/`pause_turn` → `complete`; `length`/`max_tokens` → truncated (P1 path); `refusal`/`content_filter`/`content-filter` → **`done('refusal')`** — a distinct reason, never `complete`. |
| P3 · refusal UI | ChatPanel gets a small notice row for `done.reason === 'refusal'`. |
| P4 · retry UI feedback | **Already implemented** — `ChatEvent 'retry'` (`types.ts:201`), emitted at `meow-agent-manager.ts:1014-1015`, rendered at `ChatPanel.tsx:458`. Out of scope except a verification test (see §5). |
| P5 · parallel tool-use coverage | New loop tests: multiple auto calls in one assistant message run concurrently with ordered results; auto + ask mix runs auto first then prompts; a throwing parallel call doesn't block the others. New message tests: N tool-calls → N ordered tool results; error-text carries partial output. |
| Type surface | No `types.ts` change: `done.reason` is already `string`. |
| Docs language | English, per `AGENTS.md`. |

## 3. Architecture

### 3.1 P1 — Resume on truncation (`loop.ts`)

Currently the loop's no-tool-call exit (`loop.ts:282-289`) maps any non-`length` finish to
`complete` and always terminates:

```ts
if (!hasToolCall) {
  const reason = finishReason === 'length' ? 'length' : 'complete'
  this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
  return
}
```

Change to: when the finish is truncated (`'length'`/`'max_tokens'`), no tool calls were made, and
`lengthResumesThisRun < MAX_LENGTH_RESUMES`, append a continuation user message and `continue`
the loop instead of terminating.

```ts
// module scope
const MAX_LENGTH_RESUMES = 3
const CONTINUE_TRUNCATED_PROMPT =
  '<system-reminder>\nYour previous answer was cut off at the output token limit. ' +
  'Continue from where you stopped, without repeating what you already wrote.\n</system-reminder>'

// in run()
if (!hasToolCall) {
  if (classifyFinish(finishReason) === 'length' && this.lengthResumesThisRun < MAX_LENGTH_RESUMES) {
    this.lengthResumesThisRun++
    this.deps.appendMessage({ id: randomUUID(), role: 'user', text: CONTINUE_TRUNCATED_PROMPT, createdAt: Date.now() })
    continue
  }
  const reason = classifyFinish(finishReason)
  this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
  return
}
```

Reset `lengthResumesThisRun = 0` at the top of `run()` next to the existing
`compactedThisRun`/`rejectRetriesThisRun` resets (`loop.ts:118-119`).

Why it works:

- The partial assistant text is already appended (`loop.ts:262-271`) before this branch, so the
  next step's serialization shows the model exactly what it wrote, followed by the continuation
  nudge.
- The continuation message is persisted via `deps.appendMessage` → the session store, so replay
  and later turns keep the full context (Claude Code does the same — the nudge is part of the
  transcript).
- The cap bounds cost: each resume is a new LLM call. `maxSteps` also bounds the total loop, but
  the dedicated cap is the primary guard for the consecutive-truncation case.
- `done('length')` after the cap preserves today's ChatPanel "cut off" error as the last resort.

Edge — truncated finish **with** tool calls (`hasToolCall` true): the loop already continues and
feeds the collected tool results back; unchanged.

### 3.2 P3 — stop_reason taxonomy (`loop.ts`, `ChatPanel.tsx`)

New module-level helper:

```ts
function classifyFinish(reason: string | undefined): 'complete' | 'length' | 'refusal' {
  if (reason === 'length' || reason === 'max_tokens') return 'length'
  if (reason === 'refusal' || reason === 'content_filter' || reason === 'content-filter') return 'refusal'
  return 'complete'
}
```

Used at the no-tool-call exit (§3.1) so `refusal` surfaces as its own `done` reason instead of
`complete`. The `'tool_use'`/`'tool_calls'` finishes never reach this branch (they imply
`hasToolCall`); if a provider reports a tool finish without delivering a tool-call part, the
default `complete` is a safe termination.

ChatPanel (`ChatPanel.tsx:489-495`) already handles `done.reason === 'length'`. Add a sibling
branch:

```ts
} else if (e.reason === 'refusal') {
  setItems(prev => [...prev, {
    kind: 'error',
    id: 'refusal-' + Date.now(),
    text: 'The model declined to answer.'
  }])
}
```

### 3.3 P2 — error wrapping (`loop.ts`, `message.ts`)

**Thrown errors.** `loop.ts:390-392` currently does `call.error = String(err)`, which turns an
`Error` into its `toString()` (often `Error: boom` — fine) but objects into `[object Object]`
(useless to the model). Add a helper and use it:

```ts
// module scope
export function formatToolError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    const json = JSON.stringify(err)
    if (json !== undefined) return json
  } catch {
    // circular references — fall through
  }
  return String(err)
}

// in executeCall's catch
} catch (err) {
  call.error = formatToolError(err)
}
```

Exported so tests can assert it directly. The `run`-returned `{ error: '...' }` path is already a
string and is untouched.

**Partial output + error.** `message.ts:133-136` currently drops the output whenever an error is
present. Change the error-text value to include the (possibly truncated) output:

```ts
const error = item.tool.error
const output: { type: 'text'; value: string } | { type: 'error-text'; value: string } =
  error
    ? { type: 'error-text', value: item.tool.output ? `${value}\n\nERROR: ${error}` : error }
    : { type: 'text', value }
```

`value` at that point already carries truncation/`truncate` handling, so the model sees the partial
output (capped when old) plus the error — context for a tool that produced output then failed.

### 3.4 P5 — parallel tool-use test coverage

The parallel execution path (`loop.ts:276-280`) is implemented but thinly tested. Add:

- **Loop** (`tests/unit/agent-loop.test.ts`):
  1. Two auto-approved tool calls in one assistant message → both `run` spies fire, both results
     land in the transcript, and the second LLM call carries two `tool` messages in order.
  2. One auto call + one ask call → the auto call's `tool-result` event precedes the ask call's
     `prompt-request` (auto completes before the ask prompt, proving no concurrent ask), and both
     tools run.
  3. A throwing tool in a parallel batch does not block its sibling → both calls execute, the
     thrower's `call.error` is `formatToolError`-formatted (`err.message`), and the run still
     reaches a `done`.
- **Message** (`tests/unit/agent-message.test.ts`):
  4. Three tool calls after one assistant message → three `tool` messages in call order, mixed
     `text`/`error-text` output types.
  5. A tool with both `output` and `error` → `error-text` value is `output + '\n\nERROR: ' + error`.
- **Retry verification** (P4, no code): a loop/manager-level assertion that the `'retry'` event is
  emitted on a rate-limit error already exists indirectly via `meow-agent-manager.test.ts`; extend
  `agent-llm-retry.test.ts` only if the manager-level wiring is not covered — otherwise note in the
  plan that P4 is verification-only.

### 3.5 Documentation

Docs-sync rule applies. Update:

- `src/main/agent/AGENTS.md` — `loop.ts` / `message.ts` rows: note resume-on-truncation,
  `formatToolError`, and the refusal reason.
- `docs/reference/03-agent-runtime.md` — the loop's finish-reason section: `length` resume
  behavior, `refusal` reason, error formatting.

## 4. Files

- `src/main/agent/loop.ts` — P1 (constant, counter, resume branch, reset), P2 (`formatToolError`,
  catch site), P3 (`classifyFinish`, done reason).
- `src/main/agent/message.ts` — P2 (error-text includes partial output).
- `src/renderer/src/components/chat/ChatPanel.tsx` — P3 (`refusal` notice branch).
- `tests/unit/agent-loop.test.ts` — P1 resume tests, P3 refusal test, P5 parallel tests.
- `tests/unit/agent-message.test.ts` — P2 partial-output+error test, P5 ordered-results test.
- `tests/unit/agent-loop.test.ts` — `formatToolError` unit assertions (exported helper).
- `src/main/agent/AGENTS.md`, `docs/reference/03-agent-runtime.md` — docs-sync.
- **No** `src/shared/types.ts` change (`done.reason` is already `string`).

## 5. Error handling

- P1 resume failures need no new handling: the continuation message append cannot throw (same
  shape as every other `appendMessage`); the loop's existing error paths are untouched.
- A tool that throws inside a parallel batch: `formatToolError` catches and formats it; the sibling
  call completes; `hasToolCall` keeps the loop going (the error is fed back as `error-text`).
- The refusal path is a normal `done`, not an error event — the ChatPanel notice is purely
  informational.

## 6. Testing

- Unit tests per §3.4. All use the existing `makeHarness` / `StubLlm` / `textParts` test utilities
  in `tests/unit/agent-loop.test.ts` and the existing `msg`/`toolCall` helpers in
  `tests/unit/agent-message.test.ts` — no new harness code.
- After every task: `npm run typecheck` and `npm test` must pass (current baseline: 102 files /
  1050 tests). No E2E test is required; the loop is fully unit-covered.

## 7. Success criteria

- A `length`/`max_tokens` finish with no tool calls resumes up to 3 times, then emits `done('length')`;
  the continuation message is persisted and visible to the model on the next step.
- A `refusal` finish emits `done('refusal')` and the ChatPanel shows the refusal notice.
- Tool errors are `Error.message`-formatted; a tool returning both output and error gives the model
  both.
- Parallel tool use has ordering + failure-isolation coverage.
- Typecheck and the full test suite pass.
