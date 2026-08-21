# Steering: Inject Queued Messages Into the Running Turn — Implementation Plan

Date: 2026-08-21
Status: Ready to execute
Spec: `docs/superpowers/specs/2026-08-21-steering-inject-queued-messages-design.md`

## Context for the engineer

Meow Coding's native agent runs a `while(true)` step loop in
`src/main/agent/loop.ts` (`SessionRunner.run()`). Today, messages sent while an
agent is running go into a per-agent serial queue (`MeowAgentManager.queues`,
max 5) and only run as a **new turn** after the current turn finishes
(`drainQueue`). This plan implements **steering** (opencode v2 style): pending
messages are injected into the running turn at the **step boundary**, the step
counter resets, and the agent continues with the new instruction in context.

Key files & facts:

- `src/main/agent/loop.ts` — `LoopDeps` interface (line 17); `run()` loop with
  a clear step boundary after tool calls (`executeCall`) and before the next
  `while` iteration.
- `src/main/meow-agent-manager.ts` — `queues` map + `send()/removeQueued()/
  editQueued()/drainQueue()/emitQueue()`; builds `SessionRunner` deps (~line
  815); `runTurn()` appends user message + emits `user-message`.
- `src/main/agent/session.ts` — `SessionStore`; has `replaceItems()`, no
  `removeMessage()` yet.
- `src/shared/ipc.ts` — `Channels` + `AgentApi` + event types; `ChatQueueRemove`
  exists.
- `src/preload/index.ts` — exposes `window.api`.
- `src/renderer/src/components/chat/ChatPanel.tsx` — feed state; renders queued
  badge; `removeQueued` handler.

## Approach summary

1. Add `takeSteers` to `LoopDeps` — returns & clears pending steers atomically.
2. In `run()`, at the step boundary: if steers exist, append each as a user
   message (reuse `runTurn`-style append + `user-message` emit), reset `steps
   = 0`, `continue`.
3. Wire `takeSteers` in `MeowAgentManager` (drain `this.queues`), and extend
   `removeQueued` to also remove an already-injected message from the
   transcript; emit a `message-removed` event.
4. Add `SessionStore.removeMessage()`.
5. Renderer: subscribe to `message-removed`, drop the row.
6. TDD: unit tests for `takeSteers` injection and `removeMessage`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/main/agent/loop.ts` | `takeSteers` dep + injection at step boundary |
| `src/main/meow-agent-manager.ts` | wire `takeSteers`, remove-injected-message, emit removed event |
| `src/main/agent/session.ts` | `removeMessage()` |
| `src/shared/ipc.ts` | `EventMessageRemoved` channel + api method |
| `src/shared/types.ts` | `MessageRemovedEvent` type |
| `src/preload/index.ts` | expose `onMessageRemoved` |
| `src/renderer/src/components/chat/ChatPanel.tsx` | drop row on removed event |
| `tests/unit/...` | tests for loop injection + session removeMessage |

---

## Task 1 — TDD: unit tests first

**File: `tests/unit/agent-loop-steering.test.ts`** (new)

Mirror the existing loop test setup (`tests/unit/agent-loop.test.ts` — check
how it builds a `SessionRunner` with a stub `LlmClient`). Add:

1. **Injects a pending steer at the step boundary**: stub LLM returns one tool
   call turn then a finish; `takeSteers` returns one `QueuedMessage`; assert the
   runner calls `appendMessage` with a `user` message containing the steer text,
   and `onEvent` got `user-message`.
2. **Resets the step counter after injecting**: configure `maxSteps` small (e.g.
   2); after a steer injection the agent is allowed more steps than `maxSteps`
   would otherwise permit.
3. **No injection when no steers**: `takeSteers` returns `[]` → loop behaves
   exactly as before (no extra user message).

**File: `tests/unit/session-store-remove.test.ts`** (new) — or add to existing
session-store tests:

4. **removeMessage drops the matching message and keeps the rest**.
5. **removeMessage with unknown id is a no-op** (no crash, items unchanged).

Run `npx vitest run tests/unit/agent-loop-steering.test.ts tests/unit/session-store-remove.test.ts` — red (features not implemented).

Commit: `test(agent): steering injection + session removeMessage` (test-only).

## Task 2 — SessionStore.removeMessage

**File: `src/main/agent/session.ts`**

```ts
removeMessage(id: string, messageId: string): void {
  const all = this.loadSessions()
  const idx = all.findIndex(s => s.id === id)
  if (idx < 0) return
  const before = all[idx].items
  const after = before.filter(it => !(it.kind === 'message' && it.message.id === messageId))
  if (after.length === before.length) return
  all[idx].items = after
  all[idx].updatedAt = this.nextUpdatedAt()
  this.saveSessions(all)
}
```

Run the session-store test — green.

Commit: `feat(session): removeMessage in SessionStore`.

## Task 3 — Loop injection (`src/main/agent/loop.ts`)

1. Add to `LoopDeps`:
```ts
takeSteers?: () => { id: string; text: string; displayText?: string; images?: ImageAttachment[] }[]
```
(import `ImageAttachment` type already available in the file's type imports;
`QueuedMessage` from shared types is the natural shape — use it.)

2. In `run()` after the tool-execution block and before the next `while`
   iteration (right after the `if (signal?.aborted)` check at the top of the
   loop body is fine too — the step boundary is *before* `buildMessages`), add:

```ts
const steers = this.deps.takeSteers?.()
if (steers && steers.length > 0) {
  for (const s of steers) {
    const msg: ChatMessage = {
      id: s.id,
      role: 'user',
      text: s.text,
      displayText: s.displayText ?? s.text,
      images: s.images,
      createdAt: Date.now()
    }
    this.deps.appendMessage(msg)
    this.deps.onEvent({ type: 'user-message', agentId: this.deps.agentId, message: msg })
  }
  steps = 0
  continue
}
```

Placement note: must run **before** `buildMessages(isLastStep)` so the injected
messages appear in the LLM context. The `while` loop re-checks `signal.aborted`
first, then injects, so a Stop still wins.

Run `npx vitest run tests/unit/agent-loop-steering.test.ts` — green.

Commit: `feat(loop): inject steered messages at step boundary`.

## Task 4 — Wire MeowAgentManager + remove-injected + event

**File: `src/main/meow-agent-manager.ts`**

1. In the `SessionRunner` deps, add:
```ts
takeSteers: () => {
  const q = this.queues.get(agent.id)
  if (!q || q.length === 0) return []
  this.queues.delete(agent.id)
  this.emitQueue(agent.id)
  return q
}
```
2. Extend `removeQueued(agentId, id)`:
```ts
removeQueued(agentId: string, id: string): void {
  // (existing buffer removal first)
  ...
  // If the message was already injected into the transcript, drop it there too.
  const sessionId = this.activeSessionId(agentId)
  this.deps.store.removeMessage(sessionId, id)
  this.emit({ type: 'message-removed', agentId, messageId: id })
}
```
3. Ensure `ChatEvent` includes the new event type.

**File: `src/shared/types.ts`** — add:
```ts
export interface MessageRemovedEvent { agentId: string; messageId: string }
```
and to `ChatEvent` union: `| { type: 'message-removed'; agentId: string; messageId: string }`.

**File: `src/shared/ipc.ts`** — add channel + api:
```ts
EventMessageRemoved: 'chat:message-removed',
```
In `AgentApi`: `onMessageRemoved(cb: (e: MessageRemovedEvent) => void): () => void`.

**File: `src/preload/index.ts`** — implement `onMessageRemoved` via `subscribe`.

Run typecheck + existing tests.

Commit: `feat(agent): wire steering into manager, remove injected messages`.

## Task 5 — Renderer drops removed message row

**File: `src/renderer/src/components/chat/ChatPanel.tsx`**

1. Subscribe (alongside the other chat event subscriptions):
```ts
useEffect(() => window.api.onMessageRemoved(({ messageId }) => {
  setItems(prev => prev.filter(i => !(i.kind === 'message' && i.id === messageId)))
}), [])
```
2. The existing `removeQueued` click handler still calls `window.api.removeQueued`;
   main now handles both pending and injected cases.

Run typecheck + build.

Commit: `feat(chat): drop removed message row from feed`.

## Task 6 — Verify

- `npm run typecheck` (all 4 projects) passes.
- `npm test` passes (new tests green; 10 pre-existing officecli failures are
  env-related, unrelated).
- `npm run build` passes.
- Manual smoke (dev):
  1. Run a long task; send a second instruction while running → appears with
     "queued" badge → becomes a normal user message at the next step boundary;
     agent continues (step budget resets).
  2. Remove a pending steered message → nothing in transcript.
  3. Remove an injected user message → bubble disappears from feed + transcript.
  4. Stop mid-run → pending steers drain as new turns (existing `stopAndDrain`).
