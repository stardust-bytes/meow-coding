# Codex-Style Chat Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new native-chat turn start at a stable 20px top reading position, follow growing output only while the application owns scrolling, and immediately yield control to deliberate user scrolling.

**Architecture:** Extract scroll geometry and transitions into a renderer-local pure module, then introduce one `useChatScroll` hook as the sole owner of feed refs, animation frames, anchoring, following, manual takeover, and session restoration. `ChatPanel` supplies stable message IDs and lifecycle signals; CSS supplies a shrinking tail region that allows a short response to grow below the anchored user turn without moving the viewport.

**Tech Stack:** React 19 hooks, TypeScript strict mode, Vitest, Playwright Electron E2E, existing Electron preload IPC.

---

## File Map

- Create `src/renderer/src/components/chat/chat-scroll-geometry.ts`: pure constants, geometry calculations, and scroll-mode transitions.
- Create `src/renderer/src/components/chat/useChatScroll.ts`: DOM-aware scroll controller hook; the only new file allowed to write `feed.scrollTop`.
- Modify `src/renderer/src/components/chat/ChatPanel.tsx`: identify message rows, signal new-turn/session events, render content/boundary/tail nodes, and connect interaction handlers.
- Modify `src/renderer/src/styles.css`: preserve current feed sizing while adding the content wrapper and non-semantic shrinking tail.
- Create `tests/unit/chat-scroll-geometry.test.ts`: deterministic boundary and transition tests.
- Modify `tests/e2e/chat-scrollbar.spec.ts`: retain the long-transcript regression and add real viewport geometry/manual-control coverage.

## Task 1: Pure Geometry and State Contract

**Files:**
- Create: `src/renderer/src/components/chat/chat-scroll-geometry.ts`
- Create: `tests/unit/chat-scroll-geometry.test.ts`

- [ ] **Step 1: Write failing geometry and transition tests**

Create `tests/unit/chat-scroll-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CHAT_BOTTOM_FOLLOW_ZONE,
  CHAT_TURN_TOP_INSET,
  anchorScrollTop,
  isInBottomFollowZone,
  nextChatScrollMode,
  tailSpacerHeight
} from '../../src/renderer/src/components/chat/chat-scroll-geometry'

describe('chat scroll geometry', () => {
  it('positions the active user row at the 20px top inset', () => {
    expect(anchorScrollTop({
      currentScrollTop: 600,
      feedTop: 100,
      rowTop: 360,
      scrollHeight: 1800,
      clientHeight: 700
    })).toBe(840)
    expect(CHAT_TURN_TOP_INSET).toBe(20)
  })

  it('clamps anchor targets to the valid scroll range', () => {
    expect(anchorScrollTop({ currentScrollTop: 0, feedTop: 100, rowTop: 80, scrollHeight: 400, clientHeight: 300 })).toBe(0)
    expect(anchorScrollTop({ currentScrollTop: 900, feedTop: 0, rowTop: 500, scrollHeight: 1000, clientHeight: 300 })).toBe(700)
  })

  it('uses an inclusive 80px bottom follow zone', () => {
    expect(isInBottomFollowZone({ scrollHeight: 1000, scrollTop: 620, clientHeight: 300 })).toBe(true)
    expect(isInBottomFollowZone({ scrollHeight: 1000, scrollTop: 619, clientHeight: 300 })).toBe(false)
    expect(CHAT_BOTTOM_FOLLOW_ZONE).toBe(80)
  })

  it('shrinks turn tail space as rendered output grows', () => {
    expect(tailSpacerHeight({ clientHeight: 600, anchorTop: 20, latestBottom: 220 })).toBe(380)
    expect(tailSpacerHeight({ clientHeight: 600, anchorTop: 20, latestBottom: 760 })).toBe(0)
  })

  it('transitions only through explicit scroll intent', () => {
    expect(nextChatScrollMode('following', 'start-turn')).toBe('anchoring-turn')
    expect(nextChatScrollMode('anchoring-turn', 'anchor-applied')).toBe('following')
    expect(nextChatScrollMode('following', 'user-away')).toBe('manual')
    expect(nextChatScrollMode('manual', 'content-updated')).toBe('manual')
    expect(nextChatScrollMode('manual', 'user-bottom')).toBe('following')
    expect(nextChatScrollMode('manual', 'jump-end')).toBe('following')
    expect(nextChatScrollMode('manual', 'session-load')).toBe('following')
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`

Expected: FAIL because `chat-scroll-geometry.ts` does not exist.

- [ ] **Step 3: Implement the pure contract**

Create `src/renderer/src/components/chat/chat-scroll-geometry.ts`:

```ts
export const CHAT_TURN_TOP_INSET = 20
export const CHAT_BOTTOM_FOLLOW_ZONE = 80
export const CHAT_FOLLOW_BOTTOM_INSET = 14

export type ChatScrollMode = 'anchoring-turn' | 'following' | 'manual'
export type ChatScrollEvent =
  | 'start-turn'
  | 'anchor-applied'
  | 'user-away'
  | 'user-bottom'
  | 'jump-end'
  | 'session-load'
  | 'content-updated'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function anchorScrollTop(input: {
  currentScrollTop: number
  feedTop: number
  rowTop: number
  scrollHeight: number
  clientHeight: number
}): number {
  const target = input.currentScrollTop + input.rowTop - input.feedTop - CHAT_TURN_TOP_INSET
  return clamp(target, 0, Math.max(0, input.scrollHeight - input.clientHeight))
}

export function isInBottomFollowZone(input: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight <= CHAT_BOTTOM_FOLLOW_ZONE
}

export function tailSpacerHeight(input: {
  clientHeight: number
  anchorTop: number
  latestBottom: number
}): number {
  const turnExtent = Math.max(0, input.latestBottom - input.anchorTop)
  return Math.max(0, input.clientHeight - CHAT_TURN_TOP_INSET - turnExtent)
}

export function nextChatScrollMode(mode: ChatScrollMode, event: ChatScrollEvent): ChatScrollMode {
  if (event === 'session-load' || event === 'jump-end' || event === 'user-bottom') return 'following'
  if (event === 'start-turn') return 'anchoring-turn'
  if (event === 'anchor-applied' && mode === 'anchoring-turn') return 'following'
  if (event === 'user-away') return 'manual'
  return mode
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the pure contract**

```powershell
git add -- src/renderer/src/components/chat/chat-scroll-geometry.ts tests/unit/chat-scroll-geometry.test.ts
git commit -m "test: define Codex chat scroll contract"
```

## Task 2: Scroll Controller Hook

**Files:**
- Create: `src/renderer/src/components/chat/useChatScroll.ts`
- Modify: `tests/unit/chat-scroll-geometry.test.ts`

- [ ] **Step 1: Add failing tests for follow overflow**

Extend the import and test suite in `tests/unit/chat-scroll-geometry.test.ts`:

```ts
import { followScrollDelta } from '../../src/renderer/src/components/chat/chat-scroll-geometry'

it('does not move until current turn content crosses the lower reading boundary', () => {
  expect(followScrollDelta({ feedBottom: 700, latestBottom: 680 })).toBe(0)
  expect(followScrollDelta({ feedBottom: 700, latestBottom: 701 })).toBe(15)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`

Expected: FAIL because `followScrollDelta` is not exported.

- [ ] **Step 3: Add the minimal overflow calculation**

Append to `chat-scroll-geometry.ts`:

```ts
export function followScrollDelta(input: { feedBottom: number; latestBottom: number }): number {
  return Math.max(0, input.latestBottom - (input.feedBottom - CHAT_FOLLOW_BOTTOM_INSET))
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`

Expected: 6 tests PASS.

- [ ] **Step 5: Implement the DOM-aware hook**

Create `src/renderer/src/components/chat/useChatScroll.ts`. The hook must expose this exact interface:

```ts
export interface ChatScrollController {
  feedRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  latestRef: RefObject<HTMLDivElement | null>
  tailRef: RefObject<HTMLDivElement | null>
  endRef: RefObject<HTMLDivElement | null>
  showJumpToEnd: boolean
  startTurnAnchor(messageId: string): void
  replaceActiveAnchorId(messageId: string): void
  reconcile(): void
  pinSessionToEnd(): void
  jumpToEnd(): void
  onScroll(): void
  onWheel(event: WheelEvent<HTMLDivElement>): void
  onTouchMove(): void
  onPointerDown(event: PointerEvent<HTMLDivElement>): void
  onPointerUp(event: PointerEvent<HTMLDivElement>): void
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void
}
```

Implement it with these invariants:

```ts
const modeRef = useRef<ChatScrollMode>('following')
const activeAnchorIdRef = useRef<string | null>(null)
const pendingAnchorIdRef = useRef<string | null>(null)
const programmaticRef = useRef(false)
const scrollbarDragRef = useRef(false)
const reconcileRafRef = useRef<number | null>(null)
const pinRafRef = useRef<number | null>(null)
```

Use one guarded writer for every programmatic movement:

```ts
const writeScrollTop = useCallback((top: number) => {
  const feed = feedRef.current
  if (!feed) return
  programmaticRef.current = true
  feed.scrollTop = top
  requestAnimationFrame(() => { programmaticRef.current = false })
}, [])
```

Resolve anchors only by safe internal message ID:

```ts
const findAnchor = useCallback(() => {
  const id = activeAnchorIdRef.current
  if (!id) return null
  return Array.from(feedRef.current?.querySelectorAll<HTMLElement>('[data-chat-message-id]') ?? [])
    .find(row => row.dataset.chatMessageId === id) ?? null
}, [])
```

`reconcile()` schedules at most one animation frame. Inside that frame:

1. Return without writing scroll position when `modeRef.current === 'manual'`.
2. Find the active anchor and calculate/update `tailRef.current.style.height` with `tailSpacerHeight`; update only when the pixel string changed.
3. If a pending anchor exists, calculate `anchorScrollTop`, write it, clear the pending ID, and transition through `anchor-applied`.
4. Otherwise calculate `followScrollDelta` from `latestRef` and feed rectangles and advance only by that positive delta.

`startTurnAnchor(id)` cancels session pinning, stores both active and pending IDs, resets tail height to `0px`, transitions through `start-turn`, hides the jump button, and schedules reconciliation. `replaceActiveAnchorId(id)` updates both active and pending IDs without scheduling another anchor transition.

`pinSessionToEnd()` clears active/pending anchors and tail height, transitions through `session-load`, and runs the existing bounded 60-frame `scrollTop = scrollHeight` settling loop. The loop must stop immediately if a trusted user interaction enters manual mode.

Interaction rules must be implemented exactly:

```ts
const enterManual = useCallback(() => {
  if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
  pinRafRef.current = null
  modeRef.current = nextChatScrollMode(modeRef.current, 'user-away')
  setShowJumpToEnd(true)
}, [])

const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
  if (event.deltaY < 0 || !isAtBottom()) enterManual()
}, [enterManual, isAtBottom])

const onTouchMove = useCallback(() => { enterManual() }, [enterManual])
```

`onPointerDown` sets `scrollbarDragRef` only when the pointer is within the scrollbar gutter (`rect.right - max(offsetWidth - clientWidth, 12)`). It captures the pointer; `onPointerUp` clears the flag and releases capture. `onKeyDown` enters manual for `ArrowUp`, `ArrowDown`, `PageUp`, `PageDown`, `Home`, `End`, and Space. `onScroll` ignores programmatic writes, resumes `following` and hides the button inside the 80px bottom zone, and otherwise enters manual only when a trusted wheel/touch/keyboard/scrollbar interaction has occurred.

Attach one `ResizeObserver` to `contentRef` and call `reconcile`; disconnect it on cleanup. Cleanup also cancels both animation frames and clears programmatic/pin flags. Do not observe individual messages.

- [ ] **Step 6: Typecheck the controller**

Run: `npm run typecheck`

Expected: PASS with no React event/native event type collision and no nullable-ref errors.

- [ ] **Step 7: Commit the controller**

```powershell
git add -- src/renderer/src/components/chat/chat-scroll-geometry.ts src/renderer/src/components/chat/useChatScroll.ts tests/unit/chat-scroll-geometry.test.ts
git commit -m "feat: add explicit chat scroll controller"
```

## Task 3: Integrate Turn Anchoring into ChatPanel

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Replace the legacy scroll refs and effect**

Import `useLayoutEffect` and `useChatScroll`, instantiate `const scroll = useChatScroll()`, and delete these legacy fields and callbacks:

```ts
endRef
feedRef
shouldJumpToEnd
pinRafRef
pinningToEndRef
prevLastIdRef
stuckRef
showJumpToEnd
onFeedScroll
jumpToEnd
```

Delete the old `[items]` effect that calls the end sentinel's `scrollIntoView`. Retain delta batching unchanged.

- [ ] **Step 2: Give every message row a stable DOM identity**

Add `messageId: string` to `FeedMessage` props and render:

```tsx
<div className={`chat-msg ${role}`} data-chat-message-id={messageId}>
```

Pass `messageId={item.id}` at the call site. Never put raw message text into a selector or attribute.

- [ ] **Step 3: Signal every visible new turn before appending it**

For an idle send, create the optimistic ID once and signal it before state mutation:

```ts
const optimisticId = 'u-' + Date.now()
scroll.startTurnAnchor(optimisticId)
setItems(prev => [...prev, {
  kind: 'message', id: optimisticId, role: 'user', text: trimmed, images
}])
```

For a queued message that starts, compute `const optimisticId = 'u-' + started.id`, call `scroll.startTurnAnchor(optimisticId)`, and append with that exact ID. Before replacing an optimistic row in the `user-message` event, call `scroll.replaceActiveAnchorId(e.message.id)` so the persisted echo keeps the current anchor without a second jump.

Remove compaction assignments to `shouldJumpToEnd`; compaction and error rows are reconciled like other content and cannot override manual mode.

- [ ] **Step 4: Render the content boundary and shrinking tail**

Replace the feed structure with:

```tsx
<div
  className="chat-feed"
  ref={scroll.feedRef}
  tabIndex={0}
  onScroll={scroll.onScroll}
  onWheel={scroll.onWheel}
  onTouchMove={scroll.onTouchMove}
  onPointerDown={scroll.onPointerDown}
  onPointerUp={scroll.onPointerUp}
  onKeyDown={scroll.onKeyDown}
>
  <div className="chat-feed-content" ref={scroll.contentRef}>
    {renderedItems}
    {running && <div className="chat-running">Bs is working…</div>}
    {renderedQueue}
    <div className="chat-latest-boundary" ref={scroll.latestRef} aria-hidden="true" />
    <div className="chat-turn-tail" ref={scroll.tailRef} aria-hidden="true" />
    <div ref={scroll.endRef} aria-hidden="true" />
  </div>
</div>
```

Keep the current JSX maps inline if extracting `renderedItems`/`renderedQueue` would reduce readability; the required structural order is content, latest boundary, shrinking tail, end sentinel.

Call reconciliation after committed layout changes:

```ts
useLayoutEffect(() => {
  scroll.reconcile()
}, [items, running, queue, scroll.reconcile])
```

On transcript load, call `scroll.pinSessionToEnd()` after `setItems`. Session/project changes and `resetView` must not retain an old active anchor.

- [ ] **Step 5: Update feed CSS without changing visual design**

Change the direct-child spacing selector and add non-semantic layout nodes:

```css
.chat-feed {
  flex: 1; min-height: 0; overflow-y: auto; padding: 14px;
  overflow-anchor: none;
}
.chat-feed:focus { outline: none; }
.chat-feed-content { min-height: 100%; }
.chat-feed-content > * + * { margin-top: 10px; }
.chat-latest-boundary, .chat-turn-tail { height: 0; margin: 0 !important; pointer-events: none; }
.chat-turn-tail { min-height: 0; }
```

Retain `.chat-msg` `content-visibility` and intrinsic sizing unchanged.

- [ ] **Step 6: Connect the existing jump control**

Render it from `scroll.showJumpToEnd` and use `scroll.jumpToEnd`. Add `aria-label="Scroll to end"`; retain the existing visible text and icon.

- [ ] **Step 7: Run focused checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`

Expected: 6 tests PASS.

- [ ] **Step 8: Commit the integration**

```powershell
git add -- src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css
git commit -m "feat: anchor new chat turns while streaming"
```

## Task 4: Electron Geometry and Manual-Takeover Regression Tests

**Files:**
- Modify: `tests/e2e/chat-scrollbar.spec.ts`

- [ ] **Step 1: Refactor fixture creation without weakening the existing test**

Extract local helpers inside the spec file for workspace/session JSON setup and Electron launch. Preserve the existing assertions: 120 `.chat-msg` rows, transcript height greater than eight viewports, and final bottom distance below 4px.

- [ ] **Step 2: Add the failing new-turn anchor test**

Create a second E2E case with a long stored transcript. Open the project, scroll to an older position, submit `anchor this turn` through `.chat-input-field`, find the last `.chat-msg.user`, and assert:

```ts
await expect.poll(() => window.locator('.chat-msg.user').last().evaluate((row) => {
  const feed = row.closest('.chat-feed')!
  return row.getBoundingClientRect().top - feed.getBoundingClientRect().top
})).toBeGreaterThanOrEqual(18)

await expect.poll(() => window.locator('.chat-msg.user').last().evaluate((row) => {
  const feed = row.closest('.chat-feed')!
  return row.getBoundingClientRect().top - feed.getBoundingClientRect().top
})).toBeLessThanOrEqual(22)
```

The provider may subsequently emit a configuration error; the assertion targets the optimistic visible turn before that terminal event and does not require network access.

- [ ] **Step 3: Run the new E2E and verify RED**

Run: `npm run build && npx playwright test tests/e2e/chat-scrollbar.spec.ts`

Expected: existing long-transcript test PASS; new anchor test FAIL because the legacy implementation places the row near the bottom.

- [ ] **Step 4: Add follow/manual/resume coverage using real layout growth**

In the same case, use `window.evaluate` to insert a test-only block immediately before `.chat-latest-boundary`. This exercises the production `ResizeObserver` and geometry without mocking IPC:

```ts
await window.evaluate(() => {
  const boundary = document.querySelector('.chat-latest-boundary')!
  const block = document.createElement('div')
  block.className = 'e2e-stream-growth'
  block.style.height = '900px'
  boundary.parentElement!.insertBefore(block, boundary)
})
```

Assert the feed advances while following. Then dispatch a real wheel-up action with Playwright, record `scrollTop`, increase the block height to `1400px`, and assert the value remains within 1px. Assert `Scroll to end` is visible. Click it, increase the block to `1800px`, and assert the feed resumes advancing and the button is hidden.

- [ ] **Step 5: Add session restoration and reduced-motion assertions**

Keep the existing true-bottom assertion as the session-load regression. In a reduced-motion context (`window.emulateMedia({ reducedMotion: 'reduce' })`), submit a new turn and assert the same 18–22px geometry; no timed animation wait or fixed sleep is allowed.

- [ ] **Step 6: Run the focused E2E and verify GREEN**

Run: `npm run build && npx playwright test tests/e2e/chat-scrollbar.spec.ts`

Expected: all tests in the file PASS, including the original content-visibility test.

- [ ] **Step 7: Commit E2E coverage**

```powershell
git add -- tests/e2e/chat-scrollbar.spec.ts
git commit -m "test: cover Codex-style chat scroll ownership"
```

## Task 5: Full Verification and Evidence Audit

**Files:**
- Modify only if verification reveals a scoped defect in the files listed in the File Map.

- [ ] **Step 1: Audit forbidden legacy scrolling paths**

Run:

```powershell
rg -n "scrollIntoView|scrollTop\s*=|shouldJumpToEnd|stuckRef|pinningToEndRef" src/renderer/src/components/chat
```

Expected: no legacy `ChatPanel` scroll path remains; `scrollTop` writes exist only in `useChatScroll.ts`; `ChatInput` may retain unrelated menu `scrollIntoView({ block: 'nearest' })` behavior.

- [ ] **Step 2: Run required static and unit checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm test`

Expected: all Vitest files and tests PASS.

- [ ] **Step 3: Run production build and the complete Electron suite**

Run: `npm run build && npm run e2e`

Expected: production build PASS and every Playwright Electron test PASS.

- [ ] **Step 4: Inspect the final diff and worktree scope**

Run:

```powershell
git diff --check
git status --short
git log --oneline -6
```

Expected: no whitespace errors; only planned source/test/docs changes belong to this work; existing user-owned logo/icon modifications remain unstaged and untouched.

- [ ] **Step 5: Commit any verification-only correction**

Only if Step 2 or Step 3 required a scoped correction:

```powershell
git add -- src/renderer/src/components/chat/chat-scroll-geometry.ts src/renderer/src/components/chat/useChatScroll.ts src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css tests/unit/chat-scroll-geometry.test.ts tests/e2e/chat-scrollbar.spec.ts
git commit -m "fix: harden Codex-style chat scrolling"
```

If no correction was required, do not create an empty commit.

## Spec Coverage Audit

- Stable 20px new-turn anchor: Tasks 1, 3, and 4.
- Short response remains below stable anchor: Tasks 2–4 through shrinking tail geometry.
- Long response follows without per-token smooth animation: Tasks 2–4.
- Manual wheel/touch/keyboard/scrollbar ownership: Tasks 2 and 4.
- Resume at 80px bottom zone or jump button: Tasks 1, 2, and 4.
- Queue and optimistic/persisted ID replacement: Task 3.
- Tool/subagent/content resize: Tasks 2 and 4 through one content observer.
- Session open/switch true-bottom restoration: Tasks 2–4.
- Reduced motion and accessibility: Tasks 2–4.
- Long-transcript `content-visibility` and performance safeguards: Tasks 3–5.
- Required repository gates: Task 5.
