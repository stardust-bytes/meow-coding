# Tray + Run in Background When Window Is Closed — Design

Date: 2026-08-21
Status: Approved (user confirmed design before writing this spec)

## Goal

When the user closes the main window (X button), Meow Coding should not quit —
it should keep running in the background with an icon in the system tray
(Windows: right side of the taskbar; macOS: menu bar; Linux: system indicator).
The user can reopen the window from the tray; quitting for real happens only via
an explicit **Exit** action.

Scope decisions (confirmed with user):

- Closing the window **always** hides to tray (no "only when agents running"
  condition).
- Show a one-time system notification the first time the window is hidden, so
  the user knows the app is still running.
- Applies to **all 3 platforms** (Windows, macOS, Linux).
- No settings toggle requested; keep the behavior always-on.

## Approach

Use a native `Tray` in the main process and intercept the window `close` event:
`preventDefault()` + `win.hide()` instead of destroying the window. Hiding the
window keeps the renderer, agents, PTY sessions and chat state alive — nothing
needs to be re-hydrated when the window is reopened.

Rejected alternatives:

- **Destroy window, keep main process** — re-creating the window requires
  re-hydrating all agent/terminal UI state; high bug surface, no benefit.
- **Minimize to taskbar only** — does not meet the "runs in background + tray
  icon" requirement; X still quits the app.

## Changes

All changes are in the **main process** (`src/main/index.ts`) plus one tray
icon asset. No IPC contract, preload or renderer changes needed.

### 1. Tray lifecycle

- Create the tray at app startup (after `createWindow()`).
- Icon source:
  - Dev: `path.join(app.getAppPath(), 'build', 'icons', '32x32.png')`
  - Packaged: `path.join(process.resourcesPath, 'tray-icon.png')` (new entry in
    `electron-builder.ts` `extraResources`; Windows uses the 32x32 ICO-compatible
    PNG, macOS uses a template image for auto light/dark, Linux uses the PNG).
  - macOS: set `tray.setImage` with a `xxxTemplate.png` naming convention
    (template image → adapts to menu bar theme).
- Tooltip: `Meow Coding`.
- If tray creation throws (rare on headless/some Linux setups), log the error
  and keep the old behavior (close = quit). Never trap the user in a state
  where the window is hidden but there is no way to reopen it.

### 2. Tray menu & interaction

- Left-click on tray icon: toggle window visibility (hidden → show+focus;
  visible → hide).
- Context menu:
  - **Show Meow Coding** — restore window (unminimize + show + focus).
  - Separator.
  - **Exit** — `app.quit()`.
- Exit goes through the existing `before-quit` cleanup (stop git poll, dispose
  meow agent, flush traces, close browser bridge, dispose remote, stop PTYs).

### 3. Intercept window close

- Add a module-level `isQuitting = false` flag.
- `win.on('close', (event) => { if (!isQuitting) { event.preventDefault(); hideWindow(); } })`
  — this catches the title-bar X, Alt+F4, and the `WindowClose` IPC handler
  (which calls `win.close()`).
- Hide logic:
  - Windows/Linux: `win.hide()`.
  - macOS: hide the window too (consistent behavior; Cmd+Q still quits via the
    default app menu path → `before-quit`).
  - On macOS also consider `app.hide()` so the app hides from Cmd+Tab/Cmd+H
    semantics; keep simple: `win.hide()` + `app.hide()` on darwin.
- `before-quit` sets `isQuitting = true` **before** the cleanup chain runs, so
  the window can be destroyed during real quit. Quit paths: tray **Exit**,
  macOS Cmd+Q, `app.quit()`.
- `window-all-closed`: keep existing handler (non-darwin → `app.quit()`). With
  the close event intercepted the window is never actually closed until real
  quit, so this path effectively only runs during cleanup.

### 4. One-time notification

- First time the window is hidden to tray, show a system notification:
  - Title: `Meow Coding`
  - Body: `[meow] Meow Coding vẫn đang chạy ngầm, click icon tray để mở lại.`
  - Click → restore window.
- Persist the "already shown" flag in `userData/tray-notified` (existence of
  the file = shown). Write it with `writeFileSync` after the first show.
- Subsequent hides are silent.

### 5. Bonus (already works)

- `NotificationService` (`notify`) already suppresses notifications while the
  window is focused and sends system notifications when unfocused/hidden;
  clicking a notification activates the agent and restores the window via the
  existing `onActivateAgent` handler. No changes needed.

## Files touched

| File | Change |
| --- | --- |
| `src/main/index.ts` | Tray creation, close interception, hide/show helpers, one-time notification, `isQuitting` flag |
| `electron-builder.ts` | Add `tray-icon.png` to `extraResources` |
| `build/icons/32x32.png` (copy) | New asset `resources/tray-icon.png` (committed) |

No changes to: `src/shared/ipc.ts`, `src/preload`, `src/renderer`.

## Testing

- `npm run typecheck` passes.
- `npm test` passes.
- Manual smoke (dev): start app → click X → window hides, tray icon appears,
  one-time notification shows, agents keep running; tray click → window
  reappears with state intact; tray Exit → app quits and PTY/agent cleanup
  runs (logs confirm).
- `npm run build && npm run e2e` if e2e affected (close handling only, so e2e
  should be unaffected).
