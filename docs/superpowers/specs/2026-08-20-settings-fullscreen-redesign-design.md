# Settings Fullscreen Redesign — design spec

**Date:** 2026-08-20
**Status:** Approved (user: "ok")
**Scope:** Renderer-only changes to the Settings screen. No IPC contract changes.

## Goal

Redesign the Settings screen so it feels like a full page (not a modal with a
header + footer), with:

- No header bar ("Back to app" + "Settings" title removed).
- No footer (Cancel / Save buttons removed).
- Back button (← icon + text) pinned at the top of the settings sidebar.
- Settings sidebar width = project sidebar width (268px).
- Content tab fills the full height below the title bar and scrolls independently.
- Everything auto-saves (debounced) — no explicit Save button, no dirty-check
  confirm dialog on close.

## Current behavior

`src/renderer/src/components/settings/SettingsDialog.tsx` renders a fixed
full-screen overlay (`inset: 34px 0 0`, below the title bar) containing:

- `.settings-screen-header` — "Back to app" button + "Settings" h2.
- `.settings-screen-body` → `.settings-body` → `.settings-nav` (150px) +
  `.settings-content` (scrolls).
- `.settings-screen-footer` — status area + Cancel / Save buttons.

State model: `draft` (edited copy) vs `saved` (persisted copy); `isDirty`
compares JSON; Save button calls `window.api.saveSettings(draft)`; closing with
unsaved changes triggers `window.confirm('Discard unsaved settings changes?')`.

Special case: `ProvidersTab` receives `settings={saved}` and `onChange={patchProviders}`
which mirrors changes into both `draft` and `saved` because it persists via its
own IPC calls (connect/disconnect/set-default) and the dirty check would
otherwise flag already-persisted changes.

## New layout

```
┌─────────────────────────────────────┐
│ Title bar (unchanged, 34px)          │
├───────────┬─────────────────────────┤
│ ← Back    │                         │
│ ───────── │  Content tab            │
│ Agents    │  (full height,          │
│ Permissions│  scrolls independently)│
│ MCP       │                         │
│ Providers │                         │
│ Context   │                         │
│ Commands  │                         │
│ Updates   │                         │
│ (nav      │                         │
│  scrolls) │                         │
├───────────┴─────────────────────────┤
│ (status pill floats bottom-right)   │
└─────────────────────────────────────┘
```

- `.settings-screen` stays `position: fixed; inset: 34px 0 0` (below title bar)
  and keeps `role="dialog"`, focus trap, Escape-to-close, and `aria-hidden`
  handling of the app underneath.
- `.settings-screen-header` and `.settings-screen-footer` are removed from JSX.
- The back button moves to the top of the sidebar nav:
  `← Back` with `ArrowLeft` icon, full-width, bottom border hairline, pinned
  (nav below it scrolls).

## Sidebar nav (268px)

- `.settings-nav` width changes from `150px` to `268px` (project sidebar width).
- Back button pinned at top; the tab list below it scrolls if it overflows.
- Tab labels and order stay unchanged:
  `Agents, Permissions, MCP, Providers, Context, Commands, Updates`
  (the `TabId` union also includes `remote`/`templates`, which remain hidden —
  only the 7 TABS entries render).

## Auto-save (debounced full-save)

Approach: keep a single `draft` state; every change funnels through `patch()`.
A debounce (500ms) triggers `window.api.saveSettings(draft)`.

- On success: `draft` becomes the returned settings; show a transient "Saved ✓"
  pill (auto-hides ~2s).
- On error: show transient error pill in red.
- Debounce is reset on each change; overlapping saves are serialized (a save in
  flight is awaited before the next debounced save runs; latest draft wins).
- On close/unmount: flush any pending debounced save before the dialog unmounts
  (clear the timer and fire the final `saveSettings`), so no edits are lost.

`patchProviders` is removed — ProvidersTab switches to `settings={draft}` +
`patch`. The dirty-check and close confirm dialog are removed.

## Code changes

### `src/renderer/src/components/settings/SettingsDialog.tsx`

- Remove header/footer JSX and their handlers.
- Remove `saved`, `isDirty`, `saving`, `closeGuarded`, `status`/`error`
  footer states.
- Add debounced auto-save:
  - `useRef` for save timer + in-flight save promise.
  - `useEffect` watching `draft` → schedule `saveSettings` after 500ms.
  - Track a transient save state (idle / saving / saved / error) for the pill.
- Escape/back → close directly (no confirm).
- `ProvidersTab` gets `settings={draft}` and `onChange={patch}`.
- Keep focus trap, `aria-hidden`, back button ref/focus on mount.

### `src/renderer/src/styles.css`

- `.settings-screen` — keep fixed overlay; remove header/footer styles or leave
  unused CSS (prefer removing to keep stylesheet clean).
- `.settings-nav` — `flex: 0 0 268px` (matches `.sidebar` width 268px).
- Add `.settings-screen-back` top-of-nav styling (full-width, hairline bottom
  border, pinned; nav list below scrolls).
- Add status pill styles (bottom-right, floating, transient).

### Not touched

- All tab components (`AgentsTab`, `PermissionsTab`, `McpTab`, `ContextTab`,
  `CommandsTab`, `RemoteTab`, `TemplatesTab`, `UpdatesTab`, `ProvidersTab`)
  except the `ProvidersTab` props wiring described above.
- `App.tsx` (renders `SettingsDialog` with same props; no change needed).
- IPC contract (`src/shared/ipc.ts`) — still uses `saveSettings` / `getSettings`.

## Acceptance criteria

1. Settings opens as a full-screen page under the title bar — no header, no footer.
2. "← Back" sits at the top of the settings sidebar; nav list below scrolls.
3. Settings sidebar is 268px wide (same as project sidebar).
4. Content fills the full height and scrolls independently.
5. Typing in any field / toggling any control auto-saves within ~500ms; a
   transient "Saved" indicator appears; no Save button anywhere.
6. Closing (Back or Escape) never shows a "discard changes" confirm.
7. `npm run typecheck` and `npm test` pass.
