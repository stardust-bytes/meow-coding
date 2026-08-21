# Collapsible Tool Call Cards — Implementation Plan

Date: 2026-08-21
Status: Ready to execute
Spec: `docs/superpowers/specs/2026-08-21-collapsible-tool-call-cards-design.md`

## Context

`ToolCallCard.tsx` (memoized) renders tool-call cards in the chat feed. Today
the full body (apply-patch diff, DiffView for edit, input JSON, output, error)
always shows, making cards tall. We wrap the body in `<details>/<summary>`:
`open` when `call.permission === 'pending'` (running), collapsed when finished.
Header shows tool name + short input summary + status; click toggles.

Key facts:
- `ToolCallData`: `{ id, tool, input: Record<string, unknown>, output?, error?, permission: 'pending'|'allowed'|'denied' }`.
- Call objects are replaced wholesale on tool-start/tool-result; component is
  `memo`ized → the `open` prop change alone collapses a finished card.
- Existing collapsible pattern: `.chat-reasoning` uses `<details>/<summary>`.
- Lucide icons already used in the project (`ChevronDown` in ChatPanel).

## File structure

| File | Change |
| --- | --- |
| `src/renderer/src/components/chat/ToolCallCard.tsx` | `<details>/<summary>` wrapper, `describeInput`, chevron, status |
| `src/renderer/src/styles.css` | summary/chevron/summary-text/status rules |

No shared/IPC/main changes.

---

## Task 1 — ToolCallCard: details/summary + describeInput

**File: `src/renderer/src/components/chat/ToolCallCard.tsx`**

1. Import `ChevronRight` from `lucide-react`.
2. Add a module-level helper (pure, easy to eyeball):

```ts
function describeInput(call: ToolCallData): string {
  const input = call.input ?? {}
  const first = (keys: string[]) => {
    for (const k of keys) {
      const v = input[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  switch (call.tool) {
    case 'edit': case 'apply-patch': case 'write': case 'read':
      return first(['file_path', 'path'])
    case 'bash': case 'terminal': case 'cmd': case 'sh':
      return first(['command', 'cmd'])
    case 'websearch': case 'webfetch':
      return first(['query', 'url'])
    case 'glob': case 'grep': case 'ls': case 'dir':
      return first(['pattern', 'path'])
    default: {
      // first non-empty scalar value
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
  }
}
```

3. Replace the render:

```tsx
return (
  <details className="tool-call" open={call.permission === 'pending'}>
    <summary className="tool-call-header">
      <ChevronRight className="tool-call-chevron" />
      <span className={`tool-call-name ${call.permission}`}>{call.tool}</span>
      <span className="tool-call-summary">{describeInput(call)}</span>
      {pending && <span className="tool-call-running">running…</span>}
      {!pending && (
        <span className={`tool-call-status ${call.permission === 'denied' ? 'err' : 'ok'}`}>
          {call.permission === 'denied' ? '✗' : '✓'}
        </span>
      )}
    </summary>
    {/* existing body unchanged */}
    {patch !== null ? (
      <pre className="tool-call-input tool-call-diff">{patch}</pre>
    ) : editDiff ? (
      <DiffView oldText={input.old_string as string} newText={input.new_string as string} />
    ) : (
      <pre className="tool-call-input">{JSON.stringify(input, null, 2)}</pre>
    )}
    {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
    {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
  </details>
)
```

Notes:
- Keep the `memo` wrapper.
- Keep `const input = call.input ?? {}` for the body.
- `open={call.permission === 'pending'}` is controlled: while running →
  expanded; after tool-result the object changes → re-render with `open=false`.
  User can still toggle manually (details toggles the attribute; React's
  controlled `open` only re-applies on re-render — since finished cards never
  re-render (memo), manual toggling sticks. Accept this behavior.)

## Task 2 — CSS

**File: `src/renderer/src/styles.css`**

Add after the `.tool-call` block (~line 771):

```css
.tool-call summary { list-style: none; cursor: pointer; user-select: none; }
.tool-call summary::-webkit-details-marker { display: none; }
.tool-call-chevron { flex-shrink: 0; transition: transform 120ms ease; color: var(--text-dim); }
.tool-call[open] .tool-call-chevron { transform: rotate(90deg); }
.tool-call-summary {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text-dim); font-family: var(--font-mono); font-size: var(--fs-sm);
}
.tool-call-status.ok { color: var(--green); }
.tool-call-status.err { color: var(--red); }
```

- `.tool-call-header` already exists (flex, gap, border-bottom) — the summary
  reuses it; add `align-items: center` (already present).
- Ensure `summary` fills header layout: `.tool-call-header` stays the summary
  class; hover highlight already on `.tool-call`.

## Task 3 — Verify

- `npm run typecheck` passes.
- `npm test` passes (existing 10 officecli failures are pre-existing env).
- `npm run build` passes.
- Manual smoke: tools expand while running, collapse when done; click header
  toggles; chevron rotates; header shows `tool` + summary; ✓/✗ status.
