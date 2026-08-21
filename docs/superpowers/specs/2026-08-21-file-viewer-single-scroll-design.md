# File Viewer: Single Scrollbar (horizontal on the body) — Design

Date: 2026-08-21
Status: Approved (user confirmed design before writing this spec)

## Goal

Remove the nested horizontal scrollbar inside the file viewer content so there
is exactly **one** horizontal scrollbar, owned by the outer body
(`.viewer-body`). Wide content (long code lines, wide tables, raw text) should
stretch to its natural width instead of wrapping or scrolling in place, and the
body scrolls horizontally as a whole.

Decisions confirmed with the user:

- Applies to **all** viewer modes: highlighted code, raw text (`<pre>`), and
  markdown.
- Markdown: **paragraphs keep wrapping** to the window width; only wide blocks
  (code blocks, tables) stretch to natural width and push the horizontal
  scrollbar out to the body.

## Current behavior (root cause of the double scrollbar)

- `.viewer-body` — `overflow: auto` → the outer vertical **and** horizontal
  scrollbar.
- `.viewer-code` — `overflow-x: auto` → a **second**, nested horizontal
  scrollbar inside the highlighted code area.
- `.viewer-pre` — `white-space: pre-wrap; word-break: break-word` → raw text
  never overflows, so it never produces a horizontal scrollbar at all (wraps
  instead).

The result: highlighted code shows two stacked horizontal scrollbars (inner
scrolls the code, outer scrolls the body), and raw text wraps mid-line rather
than being read as a straight line.

## Approach

**Pure CSS** — no TSX/DOM changes (`src/renderer/src/styles.css` only).

### Changes

1. `.viewer-pre` (raw text):
   - `white-space: pre-wrap` → `white-space: pre` (no wrapping)
   - remove `word-break: break-word`
   - Long lines now overflow the body width; the body's own horizontal
     scrollbar handles them.

2. `.viewer-code` (highlighted Shiki output):
   - remove `overflow-x: auto` — the inner `pre`/code no longer scrolls in
     place; it stretches the body instead.

3. `.viewer-md` (markdown) — targeted at wide blocks only, keep paragraphs
   wrapping:
   - `.viewer-md .chat-md pre` — `width: max-content; min-width: 100%;`
     remove `overflow-x: auto` so code blocks span their natural width.
   - `.viewer-md .chat-md table` — `width: max-content; min-width: 100%` so a
     wide table widens the body instead of shrinking/overflowing the cell.
   - Paragraphs, lists, headings etc. are untouched → still wrap to the window
     width.

### Layout invariants (why it works)

- `.viewer-body { flex: 1; overflow: auto }` already exists; with all inner
  `overflow-x` removed, any content wider than the body creates exactly one
  horizontal scrollbar there (plus the existing vertical one).
- `width: max-content; min-width: 100%` on wide blocks makes them grow to
  natural width but never shrink below the body width, so short content still
  spans full width.

## Files touched

| File | Change |
| --- | --- |
| `src/renderer/src/styles.css` | `.viewer-pre`, `.viewer-code`, markdown pre/table rules |

No changes to: `FileViewer.tsx`, `MarkdownText.tsx`, IPC, main process.

## Testing

- `npm run typecheck` passes.
- `npm test` passes (no logic change; CSS only — existing suites unaffected).
- Manual smoke:
  - Open a file with a long line (>window width) in raw mode → no wrap, body
    shows exactly one horizontal scrollbar, no inner one.
  - Open a highlighted code file with long lines → no inner `.viewer-code`
    scrollbar; body scrolls horizontally.
  - Open a markdown file with a wide code block / wide table → paragraph wraps,
    wide block stretches and body scrolls horizontally.
- `npm run build` passes.
