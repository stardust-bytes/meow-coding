# Steering: Inject Queued Messages Into the Running Turn — Design

Date: 2026-08-21
Status: Approved (user confirmed design before writing this spec)

## Goal

When the user sends a message while the agent is mid-turn, the message should
be **injected into the running turn** at the next step boundary instead of
waiting for the turn to finish — the agent continues working with the new
instruction in context. This mirrors opencode v2's "steering".

## Verification findings (from opencode source at D:\Git\GitHub\opencode)

- opencode v2 (`packages/core`, branch dev): `prompt()` defaults
  `delivery = input.delivery ?? "steer"`. Steer rows are promoted at a **step
  boundary mid-work** (`promoteSteers`), the step counter resets
  (`currentStep = 1`), and the runner continues with a new provider turn that
  includes the steered messages. Queue is only used at the idle boundary.
- opencode v1.18 (stable, `packages/opencode`) still uses a serial queue —
  steering is a v2 feature. Claude Code / Codex docs were JS-rendered (could
  not read); both use queues + explicit Esc interrupt, not auto-steer.

## Current meow-coding behavior

- `send()` → if running, push to a per-agent queue (`MAX_QUEUE = 5`), emit
  `queue-updated`.
- `runTurn()` → on finish, `drainQueue()` runs the next queued message as a new
  turn. Queue is strictly serial.
- `loop.ts` `run()` has a `while(true)` step loop with clear step boundaries
  (after tool calls, before next provider turn) — the injection point.

## Decisions (confirmed with user)

- **Always steer**: every message sent while running is injected at the next
  step boundary. No per-message choice UI.
- **Keep the "queued" badge** in the chat feed while a steered message is
  pending; it becomes a normal user message once injected.
- **Keep MAX 5** pending steers (same limit as today).
- **Delete removes the bubble**: removing a pending steered message removes it
  from the pending buffer (never enters transcript); removing an already-
  injected user message removes it from the transcript too.

## Design

### 1. Main process — pending steers

Reuse the existing `queues` map and `QueuedMessage` type as the pending-steer
buffer (no structural change to `send()`, `MAX_QUEUE`, `removeQueued`,
`editQueued`, `emitQueue`).

### 2. Injection point — `src/main/agent/loop.ts`

Add a loop dependency `takeSteers?: () => QueuedMessage[]` (returns and clears
all pending steers atomically).

In `run()`, after tool execution and before the next `while` iteration (the
step boundary), check for steers:

```ts
// inside while(true), after tool calls finish:
const steers = this.deps.takeSteers?.()
if (steers && steers.length > 0) {
  for (const s of steers) {
    // append user message to transcript + emit user-message (reuse the same
    // code path runTurn uses: referenceHints, displayText, images)
  }
  steps = 0 // reset step budget like opencode's currentStep = 1
  continue
}
```

- Steers are injected **only at step boundaries** — never mid-stream.
- Each injected steer becomes a `user` message in the transcript (same as a
  normal user turn), so the next `buildMessages()` includes it.
- `steps = 0` gives the agent a fresh step budget for the continued work
  (opencode behavior: `currentStep = 1`).
- If a permission prompt is pending, wait for it to resolve before injecting
  the next steer (loop already blocks on `executeCall` for `ask` calls — the
  steer check runs after, so ordering is naturally safe).

### 3. Queue drain semantics

- `drainQueue()` stays for the idle case: if the turn ends with steers still
  pending (e.g. agent finished before the next boundary), they run as a new
  turn as today.
- `stopAndDrain()` unchanged (Stop → drain pending steers as new turns).

### 4. Remove message from transcript

New `SessionStore.removeMessage(sessionId, messageId)`:
filter items via existing `replaceItems()` dropping the matching user message.

- `removeQueued(agentId, id)`:
  - If the id is still in the pending-steer buffer → just remove (never
    entered transcript) — current behavior.
  - If the id is an already-injected message → also call
    `removeMessage(activeSessionId, id)`.
- The renderer's existing remove button handles both cases through the same
  IPC (`ChatQueueRemove`), now backed by both paths in main.

### 5. Renderer — `ChatPanel.tsx`

- Keep the pending badge ("queued") for pending steers (existing UI).
- On `user-message` event for a steered message → it renders as a normal user
  message (existing flow); the pending row disappears because main removes it
  from the queue on injection.
- On remove: call existing `removeQueued`; main handles transcript removal; a
  new event (`EventMessageRemoved` or reuse an error-free generic event) tells
  the renderer to drop the message row from the feed.

### 6. IPC/shared

- Add `removeQueued` already exists; add transcript-removal support behind it
  (main-side change only).
- New event `EventMessageRemoved: 'chat:message-removed'` with
  `{ agentId, messageId }` so the feed drops the row.
- No changes to `Channels` names that exist; add one event channel.

## Files touched

| File | Change |
| --- | --- |
| `src/main/agent/loop.ts` | `takeSteers` dep + injection at step boundary |
| `src/main/meow-agent-manager.ts` | wire `takeSteers`, handle remove-injected-message, emit removed event |
| `src/main/agent/session.ts` | `removeMessage()` |
| `src/main/index.ts` | IPC handler for the removed event if needed |
| `src/shared/ipc.ts` | `EventMessageRemoved` channel |
| `src/shared/types.ts` | event payload type (if inline) |
| `src/renderer/src/components/chat/ChatPanel.tsx` | drop message row on removed event |
| `src/preload/index.ts` | expose `onMessageRemoved` |

## Testing

- `npm run typecheck` passes.
- `npm test` passes (add unit tests: `takeSteers` injection in loop,
  `removeMessage` in session store).
- Manual smoke:
  - Send a long-running task; while running, send a second instruction → it
    appears with the queued badge, then becomes a normal user message at the
    next step boundary and the agent continues (step count resets).
  - Remove a pending steer → nothing appears in the transcript.
  - Remove an already-injected message → the bubble disappears from the feed
    and transcript.
  - Stop mid-run → pending steers drain as new turns.
