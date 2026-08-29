# Meow Agent Tool-Calling Loop Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between Claude Code's tool-calling loop and Meow's: resume answers cut off at the output cap, report `refusal` distinctly, wrap tool errors structurally while preserving partial output, and lock in parallel tool-use behavior with tests.

**Architecture:** Four self-contained tasks. T1 changes the loop's no-tool-call exit to resume truncated turns (capped) and to classify finish reasons (`complete`/`length`/`refusal`), plus the ChatPanel refusal notice. T2 adds `formatToolError` and preserves partial tool output in error results. T3 is test coverage only (parallel execution ordering, error isolation, and a verification test for the already-implemented retry UI event). T4 syncs the module `AGENTS.md` and `03-agent-runtime.md`.

**Tech Stack:** TypeScript, Electron, Vitest, AI SDK v6 (`streamText` finishReason values).

**Spec:** `docs/superpowers/specs/2026-08-29-meow-tool-loop-design.md` — the binding authority. The plan argues from it; any conflict resolves against the spec.

## Global Constraints

- Docs and new code comments in **English**; match the surrounding file's style (the touched regions of `loop.ts` / `ChatPanel.tsx` use English comments).
- No unnecessary comments; keep the density of the code being modified.
- After **every task**, `npm run typecheck` and `npm test` must pass (baseline: 102 files / 1050 tests).
- Only the main process spawns processes.
- Tests use the existing stubs (`StubLlm`, `makeHarness`, `textParts` in `tests/unit/agent-loop.test.ts`; `msg`/`toolCall` in `tests/unit/agent-message.test.ts`) — never hit a real LLM API.
- **No change to `src/shared/types.ts`**: `done.reason` is already `string`, so `'refusal'` needs no type change.
- T1 replaces one existing test in `agent-loop.test.ts` (`reports a cut-off answer instead of calling it complete`) — its behavior changes by design. Every other existing test must keep passing unchanged.
- P4 (retry UI event) is **already implemented** end-to-end (`types.ts:201` → `meow-agent-manager.ts:1014-1015` → `ChatPanel.tsx:458`). T3 only verifies it with a test; no production code.
- Commit after each task. Commit messages below; end every commit with the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

---

### Task 1: Finish-reason handling — resume on truncation (P1) + distinct refusal reason (P3)

**Files:**
- Modify: `src/main/agent/loop.ts` (new constants/helper after `MAX_STEPS_PROMPT`; new field near `rejectRetriesThisRun`; reset in `run()`; replace the `!hasToolCall` branch at ~282-289)
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` (done/error branch ~489-496)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: existing `SessionRunner.run`, `LoopDeps.appendMessage`/`onEvent`, the `StubLlm`/`makeHarness`/`textParts` test utilities in `agent-loop.test.ts`.
- Produces: module-level `classifyFinish(reason): 'complete' | 'length' | 'refusal'`, `MAX_LENGTH_RESUMES = 3`, `CONTINUE_TRUNCATED_PROMPT`, private `lengthResumesThisRun` on `SessionRunner`.

- [ ] **Step 1: Write the failing tests (replace one existing test, add two)**

In `tests/unit/agent-loop.test.ts`, in `describe('SessionRunner finish reasons')`, **delete** the test `reports a cut-off answer instead of calling it complete` (it now behaves differently: a single `length` finish resumes instead of finishing) and **replace** it with these three tests:

```ts
  it('resumes a truncated answer by continuing the turn', async () => {
    const h = makeHarness()
    h.llm.queue = [
      [{ kind: 'text', text: 'half an ans' }, { kind: 'finish', finishReason: 'length' }],
      textParts('...the rest')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    // Two LLM calls: the truncated step plus the continuation step.
    expect(h.llm.calls.length).toBe(2)
    // The continuation nudge is persisted to the transcript as a user message.
    const userTexts = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message' && i.message.role === 'user')
      .map(i => i.message.text)
    expect(userTexts.some(t => t.includes('cut off'))).toBe(true)
    // The model sees the nudge on the next step.
    expect(JSON.stringify(h.llm.calls[1]?.messages ?? [])).toContain('cut off')
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('complete')
  })

  it('stops resuming after three consecutive truncations and reports length', async () => {
    const h = makeHarness()
    h.llm.queue = [
      [{ kind: 'text', text: 'a' }, { kind: 'finish', finishReason: 'length' }],
      [{ kind: 'text', text: 'b' }, { kind: 'finish', finishReason: 'length' }],
      [{ kind: 'text', text: 'c' }, { kind: 'finish', finishReason: 'length' }],
      [{ kind: 'text', text: 'd' }, { kind: 'finish', finishReason: 'length' }]
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('length')
    expect(h.llm.calls.length).toBe(4)
    const userTexts = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message' && i.message.role === 'user')
      .map(i => i.message.text)
    expect(userTexts.filter(t => t.includes('cut off'))).toHaveLength(3)
  })

  it('reports a distinct reason when the model refuses', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'text', text: 'I cannot do that' }, { kind: 'finish', finishReason: 'refusal' }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('refusal')
  })
```

- [ ] **Step 2: Run the loop tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: the three new tests FAIL — the resume test sees 1 LLM call (not 2) and no continuation message; the cap test finishes after 1 call (not 4); the refusal test reports `complete` (not `refusal`). Existing tests still pass (the `still reports complete` and `keeps max-steps` tests are unaffected).

- [ ] **Step 3: Implement in `src/main/agent/loop.ts`**

3a. After the `MAX_STEPS_PROMPT` constant (line ~89), add:

```ts
const MAX_LENGTH_RESUMES = 3
const CONTINUE_TRUNCATED_PROMPT =
  '<system-reminder>\nYour previous answer was cut off at the output token limit. ' +
  'Continue from where you stopped, without repeating what you already wrote.\n</system-reminder>'

function classifyFinish(reason: string | undefined): 'complete' | 'length' | 'refusal' {
  if (reason === 'length' || reason === 'max_tokens') return 'length'
  if (reason === 'refusal' || reason === 'content_filter' || reason === 'content-filter') return 'refusal'
  return 'complete'
}
```

3b. Add the per-run counter next to `private rejectRetriesThisRun = 0` (line ~99):

```ts
  // Consecutive truncation resumes in one run; caps the cost when the model
  // keeps hitting the output limit.
  private lengthResumesThisRun = 0
```

3c. Reset it in `run()` next to the other resets (lines ~118-119):

```ts
    this.lengthResumesThisRun = 0
```

3d. Replace the whole `if (!hasToolCall)` block (lines ~282-289):

```ts
      if (!hasToolCall) {
        // The provider cut the answer at the output cap without calling a tool.
        // Resume the turn with a continuation nudge up to MAX_LENGTH_RESUMES
        // times; past the cap, report 'length' so the UI can tell the user the
        // answer is cut off.
        if (classifyFinish(finishReason) === 'length' && this.lengthResumesThisRun < MAX_LENGTH_RESUMES) {
          this.lengthResumesThisRun++
          this.deps.appendMessage({
            id: randomUUID(),
            role: 'user',
            text: CONTINUE_TRUNCATED_PROMPT,
            createdAt: Date.now()
          })
          continue
        }
        const reason = classifyFinish(finishReason)
        this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
```

- [ ] **Step 4: Run the loop tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: PASS (all existing + the 3 new/updated).

- [ ] **Step 5: Implement the refusal notice in `ChatPanel.tsx`**

In `src/renderer/src/components/chat/ChatPanel.tsx`, inside the `done`/`error` handler (~line 487), after the existing `else if (e.reason === 'length')` block (which ends with `}])\n}`), add:

```ts
      } else if (e.reason === 'refusal') {
        setItems(prev => [...prev, {
          kind: 'error',
          id: 'refusal-' + Date.now(),
          text: 'The model declined to answer.'
        }])
      }
```

`done.reason` is already `string`, so no type change anywhere. This branch has no renderer test infra (the repo has no ChatPanel tests) — it is verified by typecheck.

- [ ] **Step 6: Run typecheck and the full suite**

Run: `npm run typecheck` and `npm test`
Expected: both PASS (102 files; the suite grows by the 3 new/updated loop tests).

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/loop.ts src/renderer/src/components/chat/ChatPanel.tsx tests/unit/agent-loop.test.ts
git commit -m "feat(agent): resume truncated answers and report refusal distinctly

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Structured tool error wrapping + partial output preserved (P2)

**Files:**
- Modify: `src/main/agent/loop.ts` (new exported `formatToolError` helper; catch site at ~390-392)
- Modify: `src/main/agent/message.ts` (error-text value at ~133-136)
- Test: `tests/unit/agent-loop.test.ts`
- Test: `tests/unit/agent-message.test.ts`

**Interfaces:**
- Consumes: `formatToolError` (produced in this task, used at the `executeCall` catch site); `toLlmMessages` + the `msg`/`toolCall` test helpers.
- Produces: exported `formatToolError(err: unknown): string`.

- [ ] **Step 1: Write the failing tests**

1a. In `tests/unit/agent-loop.test.ts`, update the import on line 6 to also bring in `formatToolError`:

```ts
import { formatToolError, SessionRunner } from '../../src/main/agent/loop'
```

Add a new top-level describe:

```ts
describe('formatToolError', () => {
  it('returns Error.message for Error instances', () => {
    expect(formatToolError(new Error('boom'))).toBe('boom')
  })

  it('passes plain strings through', () => {
    expect(formatToolError('boom')).toBe('boom')
  })

  it('JSON-stringifies plain objects instead of "[object Object]"', () => {
    expect(formatToolError({ code: 42, msg: 'x' })).toBe('{"code":42,"msg":"x"}')
  })

  it('falls back to String() for unserializable values', () => {
    expect(formatToolError(null)).toBe('null')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatToolError(circular)).toBe('[object Object]')
  })
})
```

1b. Add this loop-level test inside `describe('SessionRunner', ...)` — it proves the catch site uses `formatToolError` and doubles as the parallel failure-isolation coverage (spec §3.4 item 3):

```ts
  it('feeds back a thrown tool error as its message and still runs the sibling', async () => {
    const boom = vi.fn(async () => { throw new Error('boom') })
    const ok = vi.fn(async () => ({ output: 'ok result' }))
    const h = makeHarness({
      tools: new Map([
        ['read', stubTool('read', ok)],
        ['write', stubTool('write', boom)]
      ])
    })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} },
        { kind: 'tool-call', toolCallId: 'tc2', toolName: 'write', toolInput: {} },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const writeItem = h.items.find(i => i.kind === 'tool' && i.tool.tool === 'write') as Extract<TranscriptItem, { kind: 'tool' }>
    expect(writeItem.tool.error).toBe('boom')
    const readItem = h.items.find(i => i.kind === 'tool' && i.tool.tool === 'read') as Extract<TranscriptItem, { kind: 'tool' }>
    expect(readItem.tool.output).toBe('ok result')
    // The sibling call still runs and the turn reaches a done.
    expect(ok).toHaveBeenCalled()
    expect(h.events.some(e => e.type === 'done')).toBe(true)
  })
```

1c. In `tests/unit/agent-message.test.ts`, inside `describe('toLlmMessages')`, add:

```ts
  it('keeps partial output alongside the error in an error-text result', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'x') },
      { kind: 'message' as const, message: msg('assistant', '') },
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}), output: 'partial', error: 'boom' } }
    ]
    const llm = toLlmMessages(items)
    expect((llm[2] as { content: { output: { type: string; value: unknown } }[] }).content[0].output)
      .toEqual({ type: 'error-text', value: 'partial\n\nERROR: boom' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-message.test.ts`
Expected: the `formatToolError` tests FAIL to import (function not exported yet); the throwing-tool test FAILS (`String(err)` yields `Error: boom`, expected `boom`); the message test FAILS (current error-text drops the output, value is `boom`).

- [ ] **Step 3: Implement `formatToolError` and use it at the catch site**

In `src/main/agent/loop.ts`, add at module scope (next to `classifyFinish`):

```ts
// Tool run() calls can throw; normalize to a string the model can read instead
// of String(err), which turns plain objects into "[object Object]".
export function formatToolError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    const json = JSON.stringify(err)
    if (json !== undefined) return json
  } catch {
    // circular reference — fall through
  }
  return String(err)
}
```

Change the catch in `executeCall` (lines ~390-392):

```ts
        } catch (err) {
          call.error = formatToolError(err)
        }
```

- [ ] **Step 4: Implement the message.ts change**

In `src/main/agent/message.ts`, replace lines ~133-136:

```ts
      const error = item.tool.error
      const output: { type: 'text'; value: string } | { type: 'error-text'; value: string } =
        error
          ? { type: 'error-text', value: item.tool.output ? `${value}\n\nERROR: ${error}` : error }
          : { type: 'text', value }
```

Note: `value` at that point already carries `toolOutputMaxChars`/`truncate` handling, so the model sees the partial (capped-when-old) output plus the error.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-message.test.ts`
Expected: PASS (all existing + the new ones).

- [ ] **Step 6: Run typecheck and the full suite**

Run: `npm run typecheck` and `npm test`
Expected: both PASS (102 files; the suite grows by the 6 new tests).

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/loop.ts src/main/agent/message.ts tests/unit/agent-loop.test.ts tests/unit/agent-message.test.ts
git commit -m "feat(agent): structured tool error formatting and partial output preserved

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Parallel tool-use coverage + retry-event verification (P5 + P4)

**Files:**
- Modify: `tests/unit/agent-loop.test.ts` (2 tests)
- Modify: `tests/unit/agent-message.test.ts` (1 test)
- Modify: `tests/unit/meow-agent-manager.test.ts` (harness capture + 1 test)

**Interfaces:**
- Consumes: existing parallel execution in `loop.ts` (`Promise.all` for auto-approved, serial for ask); existing manager `onRetry` wiring (`meow-agent-manager.ts:1014-1015`); the `makeManager` harness in `meow-agent-manager.test.ts`.
- Produces: `onRetryCaptured` in `makeManager`'s returned object.

The loop/message tests below lock in existing behavior (they pass against current code). The manager test is real TDD: it fails until the harness captures `onRetry`.

- [ ] **Step 1: Write the failing manager test**

In `tests/unit/meow-agent-manager.test.ts`, inside `describe('MeowAgentManager', ...)`, add:

```ts
  it('emits a retry ChatEvent when the LLM client reports a retry', async () => {
    const { manager, events, onRetryCaptured } = await makeManager({
      partsQueue: [[{ kind: 'text', text: 'hi' }, { kind: 'finish' }]]
    })
    await manager.send('a1', 'hi')
    onRetryCaptured?.({ attempt: 2, maxAttempts: 10, delayMs: 300, unbounded: true })
    expect(events).toContainEqual({
      type: 'retry', agentId: 'a1', attempt: 2, maxAttempts: 10, delayMs: 300, unbounded: true
    })
  })
```

- [ ] **Step 2: Run the manager test to verify it fails**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "emits a retry ChatEvent"`
Expected: FAIL — `makeManager` does not return `onRetryCaptured` (type error), because the harness's `createLlm` stub ignores the `onRetry` option.

- [ ] **Step 3: Update the `makeManager` harness to capture `onRetry`**

In `tests/unit/meow-agent-manager.test.ts`:

3a. Near `const llmModels: string[] = []` (line ~90), add:

```ts
  let onRetryCaptured: ((info: { attempt: number; maxAttempts: number; delayMs: number; unbounded?: boolean }) => void) | undefined
```

3b. Change the `createLlm` stub (line ~93) to accept and capture the options object (the 4th argument from `register()`, `meow-agent-manager.ts:1012`):

```ts
  const createLlm = vi.fn((_provider?: unknown, _apiKey?: unknown, _baseUrl?: unknown, opts?: { onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; unbounded?: boolean }) => void }): LlmClient => {
    onRetryCaptured = opts?.onRetry
```

(The stub body after the opening line is unchanged.)

3c. Add `onRetryCaptured` to the returned object (line ~145):

```ts
  return { manager, store, events, createLlm, savedPermissions, llmCalls, llmSystems, llmMessages, llmVariants, llmModels, hangState, onRetryCaptured }
```

- [ ] **Step 4: Run the manager test to verify it passes**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "emits a retry ChatEvent"`
Expected: PASS.

- [ ] **Step 5: Add the parallel tool-use tests**

5a. In `tests/unit/agent-loop.test.ts`, inside `describe('SessionRunner', ...)`, add:

```ts
  it('runs multiple auto-approved tool calls in parallel and feeds all results back in order', async () => {
    const a = vi.fn(async () => ({ output: 'A' }))
    const b = vi.fn(async () => ({ output: 'B' }))
    const h = makeHarness({
      tools: new Map([
        ['read', stubTool('read', a)],
        ['glob', stubTool('glob', b)]
      ])
    })
    h.llm.queue = [
      [
        { kind: 'text', text: 'working...' },
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} },
        { kind: 'tool-call', toolCallId: 'tc2', toolName: 'glob', toolInput: {} },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
    const results = h.items
      .filter((i): i is Extract<TranscriptItem, { kind: 'tool' }> => i.kind === 'tool')
      .map(i => i.tool)
    expect(results.map(r => r.id)).toEqual(['tc1', 'tc2'])
    expect(results.map(r => r.output)).toEqual(['A', 'B'])
    // The second LLM call carries one assistant with two tool-calls, then two
    // ordered tool messages.
    const secondMessages = h.llm.calls[1]?.messages ?? []
    const toolMsgs = secondMessages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect((toolMsgs[0].content as Array<{ toolCallId: string }>)[0].toolCallId).toBe('tc1')
    expect((toolMsgs[1].content as Array<{ toolCallId: string }>)[0].toolCallId).toBe('tc2')
  })

  it('runs auto-approved calls before prompting for an ask call', async () => {
    const a = vi.fn(async () => ({ output: 'auto' }))
    const h = makeHarness({
      tools: new Map([
        ['read', stubTool('read', a)],
        ['bash', stubTool('bash')]
      ]),
      decidePermission: (tool) => (tool === 'bash' ? 'ask' : 'allow'),
      ask: vi.fn(async () => ({ allow: true }))
    })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} },
        { kind: 'tool-call', toolCallId: 'tc2', toolName: 'bash', toolInput: { command: 'ls' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const readResult = h.events.find(e => e.type === 'tool-result' && e.call.tool === 'read')
    const bashPrompt = h.events.find(e => e.type === 'prompt-request' && e.call?.tool === 'bash')
    expect(readResult).toBeDefined()
    expect(bashPrompt).toBeDefined()
    // The auto call completes before the ask prompt is shown (no concurrent ask).
    expect(h.events.indexOf(readResult!)).toBeLessThan(h.events.indexOf(bashPrompt!))
    expect(a).toHaveBeenCalled()
  })
```

5b. In `tests/unit/agent-message.test.ts`, inside `describe('toLlmMessages')`, add:

```ts
  it('emits one ordered tool message per call, mixing text and error-text outputs', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'go') },
      { kind: 'message' as const, message: msg('assistant', 'a') },
      { kind: 'tool' as const, tool: { ...toolCall('read', {}, 't1'), output: 'x' } },
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}, 't2'), error: 'boom' } },
      { kind: 'tool' as const, tool: { ...toolCall('glob', {}, 't3') } },
      { kind: 'message' as const, message: msg('assistant', 'b') }
    ]
    const llm = toLlmMessages(items)
    const assistant = llm[1] as { content: Array<{ type: string; toolCallId: string }> }
    expect(assistant.content.filter(p => p.type === 'tool-call').map(p => p.toolCallId)).toEqual(['t1', 't2', 't3'])
    const toolMsgs = llm.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(3)
    expect((toolMsgs[0].content as Array<{ output: { type: string } }>)[0].output.type).toBe('text')
    expect((toolMsgs[1].content as Array<{ output: { type: string } }>)[0].output.type).toBe('error-text')
    expect((toolMsgs[2].content as Array<{ output: { type: string } }>)[0].output.type).toBe('text')
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-message.test.ts tests/unit/meow-agent-manager.test.ts`
Expected: PASS (all new tests pass; the parallel tests lock in behavior already implemented).

- [ ] **Step 7: Run typecheck and the full suite**

Run: `npm run typecheck` and `npm test`
Expected: both PASS (102 files; the suite grows by the 4 new tests).

- [ ] **Step 8: Commit**

```bash
git add tests/unit/agent-loop.test.ts tests/unit/agent-message.test.ts tests/unit/meow-agent-manager.test.ts
git commit -m "test(agent): parallel tool execution, ordering, and retry-event coverage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Documentation sync

**Files:**
- Modify: `src/main/agent/AGENTS.md` (loop.ts row, message.ts row)
- Modify: `docs/reference/03-agent-runtime.md` (loop pseudo-code, notable-details bullets, §3.5 step 4, constants table)

**Interfaces:** None — documentation only. Reflects the behavior added in Tasks 1-2.

- [ ] **Step 1: Update `src/main/agent/AGENTS.md`**

1a. In the `loop.ts` row (line 11), after `"MEMORY.md sync after write/edit into the memory dir"`, append (before the closing `)`):

```markdown
a truncated answer (length/max_tokens, no tool call) resumes with a continuation nudge up to 3× per run then reports `done('length')`; a refusal finish reports `done('refusal')`; thrown tool errors are formatted by `formatToolError`.
```

1b. In the `message.ts` row (line 13), after `"ToLlmOptions.turnContext prepends a per-turn <system-reminder> user message at transform time (never written to the store)."`, append:

```markdown
A tool result with both output and error serializes as `error-text` carrying the partial output plus the error.
```

- [ ] **Step 2: Update `docs/reference/03-agent-runtime.md`**

2a. Replace the line `if no tool call → emit done{reason: finishReason === 'length' ? 'length' : 'complete'}; return` (line ~119) with:

```markdown
  if no tool call:
    if length/max_tokens and resumes < MAX_LENGTH_RESUMES → append continuation nudge (user msg), continue
    emit done{reason: classifyFinish(finishReason)}; return   ('complete' | 'length' | 'refusal')
```

2b. Replace the bullet (lines ~129-130):

```markdown
- A truncated answer (`finishReason === 'length'`/`'max_tokens'`, no tool calls) resumes the turn by
  appending a continuation `<system-reminder>` user message, up to `MAX_LENGTH_RESUMES` (3) times per
  run; past the cap it reports `done{reason:'length'}` so the UI can tell the user the answer was cut
  off. A `refusal`/`content_filter` finish reports `done{reason:'refusal'}` — never `complete`.
```

2c. In §3.5 step 4 (line ~168), change `thrown errors become call.error.` to:

```markdown
thrown errors become `call.error` formatted by `formatToolError` (Error.message / string / JSON, never `[object Object]`).
```

2d. Add to the Constants table (after `MAX_COMPACT_PER_RUN`):

```markdown
| `MAX_LENGTH_RESUMES` | 3 | `loop.ts` |
```

- [ ] **Step 3: Run typecheck and the full suite**

Run: `npm run typecheck` and `npm test`
Expected: both PASS — documentation-only change.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/AGENTS.md docs/reference/03-agent-runtime.md
git commit -m "docs(agent): document tool-loop resume, refusal, and error formatting

Co-Authored-By: Claude <noreply@anthropic.com>"
```
