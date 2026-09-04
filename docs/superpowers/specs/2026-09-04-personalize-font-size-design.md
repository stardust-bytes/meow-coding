# Personalize — App-wide font size

Status: pending review

## Goal

Add a **Personalize** tab to the Settings dialog with a single **Font size** field (integer px).
Setting it applies directly to `font-size` on both `<html>` and `<body>`, scaling the whole app —
UI text and the xterm terminal.

## Decisions

- **Approach 1: localStorage + inline `font-size` on `<html>`**, mirroring the existing `meow.theme`
  pattern. No `MeowSettings` / `meow.json` changes.
- **Unit: px (integer).** Default `14`, matching the existing `html { font-size: 14px }` in
  `styles.css`. User enters an integer like `14`, `16`, `18`.
- **Terminal scales with the app.** xterm sets `fontSize: 14` in px in JS, so it does not inherit
  from `<html>`. The terminal font size is set to the same value (`n` px) and re-fit so cells reflow.
- **Persisted** in `localStorage` under `meow.fontSize` and re-applied on every launch.

## Storage & application

- Key: `meow.fontSize` (default `14`).
- New helper module `src/renderer/src/font.ts` (mirrors `theme.ts`):
  - `getFontSize(): number` — read from localStorage, return `14` when absent/invalid.
  - `applyFontSize(size?: number)` — sets `document.documentElement.style.fontSize = '<n>px'`
    (overrides the CSS `html { font-size: 14px }` default) and `document.body.style.fontSize = '1rem'`
    so the body follows the root. Together these scale `<html>` and `<body>` directly, as requested.
  - `watchFontSize()` — listen for `storage` events on `meow.fontSize`, re-apply, and notify open
    terminals so they update live (required by the terminal scaling decision).
- Called from `main.tsx` for each renderer (main window, Git viewer, FileViewer popups) before first
  paint, like `applyTheme()`.

Because the whole design uses `rem`-based `--fs-*` tokens (`--fs-xs` … `--fs-lg`), most UI text scales
automatically from the root. A few hardcoded `px` values and the xterm terminal are handled explicitly.

## Personalize tab (Settings dialog)

- Add `'personalize'` to `TabId` and a `{ id: 'personalize', label: 'Personalize' }` entry to `TABS`.
- New `PersonalizeTab` component rendered in the tab switch:
  - Labeled **Font size** integer input (px) with `-` / `+` stepper buttons.
  - Live preview: the field accepts the raw typed value; it is clamped to 8-40,
    persisted, and normalized on blur or Enter (stepper and Reset apply immediately).
  - Persist to `localStorage` on change.
  - A **Reset to 14** button.
- No `MeowSettings` / `meow.json` / main-process IPC changes.

## Terminal scaling

- `XtermHost.tsx` reads the current `meow.fontSize` (default `14`) and sets `term.options.fontSize = n`,
  then calls `fit()` so cells reflow.
- React to the `storage` event (via `watchFontSize`) to update open terminals live when the user
  changes the size in the settings tab.
- The terminal font remains a mono/px value; it is tied to the same `n` as the root UI (not a
  fixed-ratio multiplier), so "font size = 14" keeps the terminal at the current (default) size.

## Fields added

- `fontSize?: number` is **not** added to `MeowSettings`; it stays a localStorage-only renderer
  preference.

## Scope

- New `PersonalizeTab` + tab wiring in `SettingsDialog.tsx`.
- New `src/renderer/src/font.ts` helper (`getFontSize` / `applyFontSize` / `watchFontSize`) + wiring
  in `main.tsx`.
- `XtermHost.tsx` react to `meow.fontSize` (set + live update + re-fit).
- Keep the CSS default `html { font-size: 14px }` in `styles.css`; the inline style overrides it.

## Testing

- `npm run typecheck` and `npm test` pass.
- There are no renderer unit tests for this; verify manually in dev build:
  - Changing the input scales UI text and the terminal.
  - The size persists across reload (localStorage).
  - Reset returns the app to 14.
  - Git viewer / FileViewer popups inherit the size (via `storage` event).

## Documentation sync

- Update `docs/reference/09-ui-guide.md` (theming / display preferences section) to document the
  `meow.fontSize` preference and its terminal interaction.
- Update the relevant module `AGENTS.md` (renderer / settings, XtermHost) to note the new capability.
