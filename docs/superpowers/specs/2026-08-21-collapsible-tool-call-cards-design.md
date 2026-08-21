# Collapsible Tool Call Cards — Design

Date: 2026-08-21
Status: Approved (user confirmed design before writing this spec)

## Goal

Tool-call cards in the chat feed (bash, edit, apply-patch, read, write, …) take
a lot of vertical space with their full input JSON, diffs and output. After a
tool finishes, collapse the card to just a compact header line that describes
what the tool did; the user can click the header to expand it again to see the
details.

Decisions confirmed with the user:

- **Auto-collapse when done**: while the tool is `pending` (running) the card
  stays expanded so the user can watch live output; once it finishes
  (`allowed`/`denied`) it collapses to the header. User can re-expand anytime.
- **Header shows tool name + short input summary** (e.g. `edit src/main/index.ts`,
  `bash npm run build`, `read package.json`).
- **Interaction**: clicking anywhere on the header toggles expand/collapse, with
  a chevron icon showing the state (rotated when expanded).

## Current implementation

- `ToolCallCard.tsx` — memoized component; renders `.tool-call` with
  `.tool-call-header` (tool name + "running…") and full body: apply-patch diff,
  DiffView (edit), input JSON, output, error.
- Call objects are replaced wholesale on `tool-start`/`tool-result`, so memo
  keeps finished cards from re-rendering on stream deltas.
- CSS: `.tool-call { overflow: hidden; content-visibility: auto; … }`,
  `.tool-call-input/.output/.error { max-height: 220px; overflow-y: auto }`.
- There is already a collapsible pattern in the codebase: `<details>/<summary>`
  for `chat-reasoning` ("Thinking").

## Approach

Use native `<details>/<summary>` — the browser gives us toggle behavior,
keyboard accessibility and no state management.

### 1. DOM structure (`ToolCallCard.tsx`)

```tsx
<details className="tool-call" open={call.permission === 'pending'}>
  <summary className="tool-call-header">
    <ChevronRight className="tool-call-chevron" />
    <span className={`tool-call-name ${call.permission}`}>{call.tool}</span>
    <span className="tool-call-summary">{describeInput(call)}</span>
    {pending && <span className="tool-call-running">running…</span>}
  </summary>
  {/* existing body unchanged: patch / DiffView / input JSON / output / error */}
</details>
```

- `open={call.permission === 'pending'}` — controlled: running → expanded,
  finished → collapsed. Because the whole `call` object is replaced on
  `tool-result` and the component is memoized, the `open` prop change alone
  collapses the card; no `useEffect` needed.
- The body is exactly what renders today (patch, DiffView, JSON, output,
  error) — unchanged semantics, just moved inside the `<details>`.
- Status indicator on the header (small ✓ / ✗ next to the name, colored by
  `call.permission`) lets the user see the outcome without expanding.

### 2. Header summary — `describeInput(call)`

Short, single-line description derived from `call.input`:

| tool | summary |
| --- | --- |
| `edit`, `apply-patch`, `write`, `read` | `file_path` / `path` value |
| `bash`, `terminal`, `cmd` | first line of `command`, truncated ~60 chars + `…` |
| `websearch`, `webfetch` | `url` / `query` |
| `glob`, `grep`, `ls`, `dir` | `pattern` / `path` value |
| others | first non-empty input value, truncated |

- Truncation via CSS `text-overflow: ellipsis` + `max-width` (one line, no
  wrapping) — not JS slicing, so no hard char limits in logic.
- Empty summary → the span renders nothing (keeps layout stable).

### 3. CSS (`styles.css`)

- Hide the default disclosure marker:
  `.tool-call summary { list-style: none; cursor: pointer; }`
  `.tool-call summary::-webkit-details-marker { display: none; }`
- Chevron rotation: `.tool-call .tool-call-chevron { transition: transform 120ms ease; }`
  `.tool-call[open] .tool-call-chevron { transform: rotate(90deg); }`
- Summary line: `.tool-call-summary { flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim);
  font-family: var(--font-mono); font-size: var(--fs-sm); }`
- Header hover stays; add `cursor: pointer` on the summary.
- Status span: `.tool-call-status.ok { color: var(--green); }` /
  `.tool-call-status.err { color: var(--red); }` (mapped from `permission`).

### 4. No changes to

- IPC / shared types / main process.
- ChatPanel feed state (item type `{ kind: 'tool'; call }` stays).

## Files touched

| File | Change |
| --- | --- |
| `src/renderer/src/components/chat/ToolCallCard.tsx` | `<details>/<summary>` + `describeInput` + chevron + status |
| `src/renderer/src/styles.css` | summary/chevron/summary-text/status rules |

## Testing

- `npm run typecheck` passes.
- `npm test` passes (renderer component; existing suites unaffected).
- `npm run build` passes.
- Manual smoke:
  - Run a task that triggers several tools; each card is expanded while
    running, collapses to a header line when done.
  - Click a collapsed card header → expands with full content (diff/JSON/output);
    click again → collapses.
  - Header shows tool name + short summary (`edit src/…`, `bash npm …`).
  - Chevron rotates to indicate state.
  - Permission prompt card (`pending`) still expands while awaiting approval.
