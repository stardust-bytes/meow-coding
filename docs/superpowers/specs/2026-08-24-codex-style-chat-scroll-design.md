# Codex-Style Chat Scroll Design

**Date:** 2026-08-24

**Status:** Approved direction awaiting written-spec review

## Goal

Make the native chat feed behave like Codex: a newly submitted user turn moves to a stable reading position near the top of the feed, streaming output remains readable, and any deliberate user scroll immediately takes ownership of the viewport.

## Scope

### Included

- Anchor a newly started user turn 20px below the top edge of the chat viewport.
- Preserve useful space below the anchored turn so the response can grow into view.
- Follow streaming assistant, reasoning, tool, subagent, prompt, and status content only while automatic following is active.
- Stop all forced scrolling when the user deliberately scrolls away from the follow zone.
- Resume following when the user returns to the bottom follow zone or activates `Scroll to end`.
- Open or switch sessions at the true end of their stored transcript without animation.
- Keep scrolling instant for high-frequency streaming updates and reserve smooth scrolling for the single new-turn transition.
- Add deterministic automated coverage for anchoring, streaming follow, manual takeover, resume, and transcript restoration.

### Excluded

- Virtualizing the transcript.
- Persisting an arbitrary pixel scroll offset across application restarts.
- Changing message layout, provider execution, session ownership, or transcript persistence.
- Auto-following while the user is selecting text or reading older content.

## Current Behavior and Root Cause

`ChatPanel` currently models scrolling with one boolean, `stuckRef`, and an end sentinel. When the feed is considered at the bottom, every item update scrolls the sentinel into view. A new user message is therefore moved to the bottom edge rather than to a stable reading position near the top. Streaming deltas continue targeting the end sentinel, so there is no distinct new-turn reading phase.

The existing implementation correctly contains two valuable behaviors that must be retained:

- opening a long transcript repeatedly pins to the real bottom while `content-visibility` rows settle;
- scrolling more than 80px away from the bottom exposes a `Scroll to end` action and normally stops following.

The change replaces the overloaded boolean with explicit scroll intent while preserving these protections.

## Scroll State Model

The feed has three mutually exclusive modes:

```ts
type ChatScrollMode = 'anchoring-turn' | 'following' | 'manual'
```

### `anchoring-turn`

Entered when a non-queued user turn is appended to the visible transcript. The exact user message element becomes the active turn anchor. After React commits the row, the feed scrolls so the row's top is 20px below the feed's content viewport.

The anchor is identified by message ID, not by `last-child`, text, array index, or role. Replacing an optimistic `u-*` ID with the persisted message ID must preserve the same DOM anchor and must not cause a second visible jump.

Once the initial anchor position is applied, the mode changes to `following`. The position is calculated from the feed and row bounding rectangles plus the current `scrollTop`; it is clamped to the valid scroll range.

### `following`

The application owns scrolling. New streaming content is kept visible using instant scroll updates. No per-token smooth animation is allowed.

The active user anchor remains the conceptual start of the turn, but it is not forcibly held at the top forever. While the response fits below it, the viewport remains stable. Once response content reaches the lower follow zone, the viewport advances just enough to keep the latest content visible. This matches Codex's reading behavior: stable turn start first, progressive following only when needed.

### `manual`

The user owns scrolling. Transcript mutations, streaming deltas, tool updates, status rows, and content resizing must not alter `scrollTop`.

Manual mode is entered when a trusted user scroll interaction moves the feed outside the bottom follow zone. Relevant interactions include wheel, touch, scrollbar drag, Page Up/Down, Home/End, and keyboard scrolling while the feed is targeted. Programmatic anchoring and following must not be mistaken for manual interaction.

Manual mode exits only when:

- the user scrolls back within 80px of the true bottom; or
- the user activates `Scroll to end`.

Both actions enter `following` and hide the jump control.

## Turn Lifecycle

### Sending while idle

1. Append the optimistic user message with a stable client-side ID.
2. Record that ID as the pending active-turn anchor.
3. Enter `anchoring-turn` regardless of the previous scroll position. Sending is an explicit navigation to the newly created turn.
4. After layout, position the user row at the 20px top inset.
5. Enter `following` and allow output to grow below the row.

### Queued messages

A message that is only present in the queue does not change the transcript viewport. When it drains and its user row is appended, it becomes the new active-turn anchor and follows the same lifecycle as an idle send.

### Streaming

- Batched text/reasoning deltas retain the existing animation-frame batching.
- While in `following`, scroll only when the latest rendered content crosses the lower follow boundary.
- Tool and subagent height changes follow the same rule as text deltas.
- While in `manual`, no transcript update may call `scrollIntoView`, assign `scrollTop`, or otherwise reposition the feed.
- Completion does not force a final jump if the user is in `manual` mode.

### Session load and switch

Session load is not treated as a new turn. It uses the existing multi-frame bottom pin to account for deferred `content-visibility` layout, then enters `following`. It is instant and does not animate through transcript history.

If the user interacts during the settling window, the pin is cancelled immediately and the feed enters `manual`; the application must not fight the user's scroll.

### Compaction and errors

Compaction markers and terminal errors are ordinary turn content. They follow only in `following` mode and never override `manual` mode. A compaction event must not set a global force-jump flag after the user has taken control.

## Geometry and Layout

- Top anchor inset: 20px from the feed's visible content edge.
- Bottom follow zone: 80px from the true bottom, retaining the current tolerance.
- The feed provides enough trailing space for a short new turn to be positioned near the top. This space is layout-owned and must not corrupt `scrollHeight` tests or create a permanently blank transcript after a response becomes long.
- Geometry uses the feed viewport, not the browser window, because the composer, todo panel, and right panel can change available height.
- Calculations tolerate `content-visibility: auto` and delayed row-size settlement.
- Programmatic scroll writes are guarded so their resulting `scroll` events do not enter `manual` mode.

## Component Design

`ChatPanel` retains ownership of the behavior but delegates calculations and mode transitions to a small renderer-local scroll controller/hook. The controller owns:

- current mode;
- active and pending anchor message IDs;
- programmatic-scroll guard;
- session-load pin animation frame;
- bottom-zone detection;
- anchor and follow geometry operations;
- cancellation and cleanup.

Message rows expose a stable DOM locator derived from the safe internal message ID. The implementation must not query by raw user text. `FeedMessage` may receive a ref or wrapper data attribute; no Node/Electron API is introduced.

The existing `Scroll to end` button remains. It is visible in `manual` mode while outside the bottom zone and uses instant navigation before returning control to automatic following.

## Accessibility and Interaction

- Automatic motion is limited: only the one-time transition to a newly submitted turn may be smooth, and it must become instant under `prefers-reduced-motion: reduce`.
- Streaming never animates scrolling.
- `Scroll to end` remains keyboard reachable and retains an accessible label.
- Keyboard scrolling is treated as user intent.
- Text selection and copying older messages must remain stable during streaming.

## Performance Constraints

- Do not set React state for every scroll pixel; mode and button visibility update only when their boolean/enum value changes.
- Do not add per-token `ResizeObserver` instances to message rows.
- Reuse the existing requestAnimationFrame delta batching.
- At most one scheduled scroll reconciliation may be active for the feed.
- Keep `content-visibility: auto` and intrinsic row sizing on long transcripts.
- Cancel every scheduled animation frame on session change and component unmount.

## Test Strategy

### Unit tests

Extract pure geometry/state transitions where practical and verify:

- anchor target calculation with the 20px inset and scroll-range clamping;
- bottom follow-zone boundaries;
- `anchoring-turn` to `following` transition;
- deliberate scroll outside the zone enters `manual`;
- programmatic scroll events do not enter `manual`;
- returning to the bottom or invoking jump resumes `following`.

### Electron E2E tests

Extend chat scroll coverage with controlled transcripts/events:

1. Opening a long session lands at the true bottom after deferred row layout.
2. Sending from the bottom places the new user row approximately 20px below the feed top.
3. Sending while reading old history still navigates to and anchors the newly submitted row.
4. A short streaming response grows below the anchor without moving it unnecessarily.
5. A long streaming response advances the viewport and keeps its latest content visible.
6. User scrolling upward during streaming freezes the viewport across subsequent deltas and tool-card growth.
7. Returning within 80px of the bottom resumes following.
8. `Scroll to end` resumes following and hides itself.
9. Switching sessions uses instant bottom restoration and does not reuse the previous session's anchor.
10. Reduced-motion mode does not use animated scrolling.

Pixel assertions use a small tolerance for Chromium layout rounding. Tests must wait on observable state/geometry rather than fixed sleeps.

## Acceptance Criteria

- Every newly started visible turn is positioned 20px (within test tolerance) below the top of the chat feed.
- Short responses grow beneath the anchored user message without unnecessary viewport movement.
- Long responses remain followed while the user has not intervened.
- One deliberate upward scroll prevents all subsequent streaming and layout updates from moving the viewport.
- Auto-follow resumes only at the bottom follow zone or through `Scroll to end`.
- Opening and switching long sessions reliably lands at their real end.
- No smooth scroll runs per streaming delta.
- Existing long-transcript scrollbar behavior and `content-visibility` performance safeguards remain intact.
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run e2e` pass.

## Risks and Mitigations

- **Optimistic ID replacement causes a second jump:** preserve the anchor relationship when replacing the optimistic row rather than treating the echo as a new turn.
- **Programmatic scroll is classified as user intent:** guard writes and distinguish trusted input signals from the resulting scroll event.
- **Deferred layout moves the anchor:** perform one bounded post-layout reconciliation and cancel it on user input.
- **Trailing space distorts transcript height:** size it from the current feed viewport and exclude it from semantic content/count assertions.
- **Streaming causes layout thrash:** batch reconciliation with the existing animation-frame cadence and avoid smooth behavior.
- **Session-load pin fights the user:** cancel pinning on the first trusted manual interaction.
