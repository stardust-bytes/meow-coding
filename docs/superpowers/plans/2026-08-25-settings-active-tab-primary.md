# Plan: Settings active tab uses primary blue

## Context

The Settings screen (`src/renderer/src/components/settings/SettingsDialog.tsx`) renders a
left sidebar nav (`settings-nav-item`) for switching tabs. The active tab is currently styled
with a dark gray background (`--bg-active`) and blue text (`--accent`), which reads as "not
bright" against the panel. The user wants the active tab to use the primary blue color so it
stands out clearly.

## Global Constraints

- Only touch the active-state styling of the settings nav item in `src/renderer/src/styles.css`.
- Use the existing primary blue variable `--accent` for the active background, with white text,
  matching the app's existing "primary" pattern (e.g. `.btn.primary`, `.chat-mode .btn.mode-build.active`).
- Do not change any other settings styling, layout, or behavior.
- `npm run typecheck` and `npm test` must pass.

## Task 1: Style the active settings nav item with primary blue

Change the `.settings-nav-item.active` rule in `src/renderer/src/styles.css` so the active tab
uses a filled primary blue background with white text:

```css
.settings-nav-item.active { background: var(--accent); color: #ffffff; border-left-color: var(--accent); }
```

This replaces the current rule:
```css
.settings-nav-item.active { background: var(--bg-active); color: var(--accent); border-left-color: var(--accent); }
```

Verify `npm run typecheck` and `npm test` pass.
