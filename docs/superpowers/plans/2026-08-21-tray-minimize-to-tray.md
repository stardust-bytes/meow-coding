# Tray + Run in Background When Window Is Closed — Implementation Plan

Date: 2026-08-21
Status: Ready to execute
Spec: `docs/superpowers/specs/2026-08-21-tray-minimize-to-tray-design.md`

## Context for the engineer

Meow Coding is an Electron app. The main process lives in `src/main/index.ts`
(799 lines, app bootstrap: `MainApp` class + `createWindow()` + IPC handlers +
`whenReady` + `before-quit` cleanup + `window-all-closed`). There is currently
**no tray** — closing the window (X) destroys it, `window-all-closed` fires,
`app.quit()` runs and kills all agents/PTY sessions.

Goal: closing the window must **hide to tray** instead of quitting. The app
keeps running; agents/PTY stay alive because the window is only hidden, never
destroyed. Real quit only via tray **Exit** (or Cmd+Q on macOS).

Key facts about the codebase:

- `win` is a module-level `let win: BrowserWindow | null` in `src/main/index.ts`.
- `createWindow()` (line ~484) sets up the window, `win.on('closed')` nulls it.
- `before-quit` (line ~765) does `event.preventDefault()` + cleanup chain
  (`stopGitPoll` → `meowAgent.dispose` → `traces.flushAll` → `browserBridge.close`
  → `remote.dispose` → `pty.stopAll().finally(() => app.exit(0))`), guarded by a
  module-level `cleaningUp` flag.
- `app.whenReady()` (line ~753) calls `registerIpcHandlers()`, `createWindow()`,
  and registers `app.on('activate', ...)`.
- Tests: Vitest, one file per module under `tests/unit/`, electron mocked with
  `vi.mock('electron', () => ({ ... }))` (see `tests/unit/notification-service.test.ts`
  and `tests/unit/file-viewer.test.ts` for the pattern).
- `npm run typecheck` runs 4 tsc projects; `npm test` runs vitest.

## Approach summary

- New module `src/main/tray-manager.ts` — `TrayManager` class: owns the `Tray`,
  builds the context menu, handles click-to-toggle, and exposes `hideWindow()`
  which hides the window + shows the one-time notification. Testable with a
  mocked electron.
- Wire into `src/main/index.ts`: intercept `win.on('close')` (hide unless real
  quit), add `isQuitting` flag set in `before-quit`, create tray in
  `whenReady`, make macOS `activate` show an existing hidden window.
- Add tray icon asset + `electron-builder.ts` `extraResources` entry.

No IPC/preload/renderer changes.

## File structure

| File | Responsibility |
| --- | --- |
| `src/main/tray-manager.ts` (new) | Tray creation, menu, click toggle, hide-to-tray with one-time notification. Pure-ish class, electron mocked in tests. |
| `tests/unit/tray-manager.test.ts` (new) | Unit tests for TrayManager (TDD). |
| `src/main/index.ts` | Wire tray manager + close interception + `isQuitting` + `activate` handler. |
| `resources/tray-icon.png` (new) | Tray icon asset (copy of `build/icons/32x32.png`). |
| `electron-builder.ts` | `extraResources` entry for `tray-icon.png`. |

---

## Task 1 — TDD: `TrayManager` unit tests (write tests first)

**File: `tests/unit/tray-manager.test.ts`**

Mock electron. The mock must provide the pieces `TrayManager` uses:

```ts
const trayInstance = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() }
const menuInstance = { append: vi.fn() }
const menuItemCtor = vi.fn()
const showMock = vi.fn()
const hideMock = vi.fn()
const focusMock = vi.fn()

vi.mock('electron', () => ({
  Tray: class { constructor() { return trayInstance } },
  Menu: { buildFromTemplate: (tpl: unknown[]) => { menuItemCtor(tpl); return menuInstance } },
  MenuItem: class { constructor(opts: unknown) { menuItemCtor(opts) } },
  Notification: class {
    constructor() {}
    on() { return this }
    show() { showMock() }
  },
  nativeImage: { createFromPath: (p: string) => ({ p, setTemplateImage: vi.fn() }) }
}))
```

Test cases (hermetic; flag file in a temp dir via `mkdtempSync`):

1. **Creates tray with tooltip and context menu**: `new TrayManager({ userDataDir, getWindow })` → `trayInstance.setToolTip` called with `'Meow Coding'`, `trayInstance.setContextMenu` called once; menu template contains a "Show Meow Coding" item and an "Exit" item.
2. **Click on tray shows hidden window**: tray `on('click', cb)` captured; window hidden → click → `showMock` + `focusMock` called.
3. **Click on tray hides visible window**: window visible → click → `hideMock` called.
4. **`hideWindow()` shows one-time notification only the first time**: with empty temp dir → first `hideWindow()` calls `showMock` and creates `tray-notified` file; second `hideWindow()` does not call `showMock`.
5. **`hideWindow()` with existing flag file stays silent**: pre-create the flag file → `hideWindow()` → `showMock` not called.
6. **Exit menu item calls quit callback**: click handler of the "Exit" item (capture item click callbacks from `MenuItem` constructor or `Menu.buildFromTemplate` template items) triggers the `onQuit` callback passed to the constructor.
7. **Tray creation failure returns null**: mock `Tray` to throw → `TrayManager.create(...)` returns `null` (no crash).

API sketch the tests drive (adjust if TDD reveals better shapes — but keep the
public surface tiny):

```ts
export interface TrayManagerOptions {
  userDataDir: string        // where the one-time-notification flag lives
  getWindow: () => BrowserWindow | null
  onQuit: () => void         // called when user picks Exit
}

export class TrayManager {
  static create(opts: TrayManagerOptions): TrayManager | null  // null if tray unavailable
  toggleWindow(): void        // tray click
  hideWindow(): void          // hide + one-time notification
}
```

Run: `npx vitest run tests/unit/tray-manager.test.ts` — green.

Commit: `feat(tray): tray manager unit tests` (test-only commit, red→green cycle
completed within Task 1 since the class is written in Task 2 — if you prefer
strict red-first, write the tests, watch them fail, then implement in the same
task and commit together).

## Task 2 — Implement `src/main/tray-manager.ts`

**File: `src/main/tray-manager.ts`** (new)

```ts
import { app, Menu, nativeImage, Notification, Tray } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
```

Behavior:

- `static create(opts)`:
  - Resolve icon: `app.isPackaged ? path.join(process.resourcesPath, 'tray-icon.png') : path.join(app.getAppPath(), 'build', 'icons', '32x32.png')`.
  - macOS: `nativeImage.createFromPath(...)` + `setTemplateImage(true)` so it
    adapts to menu bar theme; Windows/Linux: plain PNG path.
  - `new Tray(image)` inside try/catch; on throw, log
    `console.error('[meow] tray creation failed:', err)` and return `null`
    (fallback: close = quit, never trap the user).
  - `tray.setToolTip('Meow Coding')`.
  - Build context menu: `[ { label: 'Show Meow Coding', click: showWindow }, { type: 'separator' }, { label: 'Exit', click: opts.onQuit } ]` via `Menu.buildFromTemplate`.
  - `tray.on('click', () => this.toggleWindow())`.
  - Store `getWindow`, `onQuit`, `userDataDir`, tray ref.
- `toggleWindow()`: `const win = getWindow(); if (!win) return`; if visible →
  `win.hide()` (+ `app.hide()` on darwin); else → unminimize/show/focus.
- `hideWindow()`: hide via same logic as toggle's hide branch, then one-time
  notification:
  - Flag path: `path.join(userDataDir, 'tray-notified')`.
  - If `!existsSync(flag)`: `new Notification({ title: 'Meow Coding', body: '[meow] Meow Coding vẫn đang chạy ngầm, click icon tray để mở lại.' })`, click → show window, `show()`, then `writeFileSync(flag, '1')`.
  - Subsequent hides silent.
- Private `showWindow()` helper shared by menu/click/notification.

Run tests: `npx vitest run tests/unit/tray-manager.test.ts` — green.

Commit: `feat(tray): tray manager with menu, click toggle and one-time notification`

## Task 3 — Wire into `src/main/index.ts`

**File: `src/main/index.ts`**

1. Import: `import { TrayManager } from './tray-manager'`.
2. Module state near `let win`:
   - `let isQuitting = false`
   - `let tray: TrayManager | null = null`
3. In `createWindow()`, after the existing `win.on('closed', ...)` block add:
   ```ts
   win.on('close', (event) => {
     if (isQuitting) return
     event.preventDefault()
     tray?.hideWindow() ?? win.hide()
   })
   ```
   (`tray?.hideWindow()` shows the one-time notification; if tray is null the
   plain `win.hide()` keeps behavior sane but the close is still prevented —
   match the design: fallback when tray creation failed should keep
   close = quit. So: if `tray` is null, do **not** prevent default. Implement
   as: `if (isQuitting) return; if (tray) { event.preventDefault(); tray.hideWindow() }`.)
4. In `app.whenReady()`, after `createWindow()`:
   ```ts
   tray = TrayManager.create({
     userDataDir: app.getPath('userData'),
     getWindow: () => win,
     onQuit: () => app.quit()
   })
   ```
5. Update the `activate` handler (macOS dock click) so an existing hidden window
   is shown instead of only creating a new one:
   ```ts
   app.on('activate', () => {
     const w = BrowserWindow.getAllWindows()[0]
     if (!w) { createWindow(); return }
     if (w.isMinimized()) w.restore()
     w.show()
     w.focus()
   })
   ```
6. In `before-quit`, set `isQuitting = true` **first** (before
   `event.preventDefault()` path — the flag lets the real window close proceed
   during cleanup):
   ```ts
   app.on('before-quit', (event) => {
     if (cleaningUp) return
     event.preventDefault()
     cleaningUp = true
     isQuitting = true
     ...
   })
   ```
   Also destroy the tray after cleanup completes (optional nicety):
   after `mainApp.pty.stopAll().finally(...)` chain — add
   `tray?.dispose(); tray = null` before `app.exit(0)` (add a `dispose()` method
   on TrayManager in Task 2 that calls `tray.destroy()` and nulls the ref; cover
   with a test if straightforward — otherwise keep it untested, it's one line).

   Implementation note: the existing chain is
   `pty.stopAll().finally(() => app.exit(0))` — add tray disposal just before
   `app.exit(0)`.

Run `npm run typecheck` (node project) — pass. Run `npm test` — pass
(ipc-contract unaffected: no channel changes).

Commit: `feat(tray): hide to tray on window close, quit only via tray/Cmd+Q`

## Task 4 — Tray icon asset + packaging

**Files: `resources/tray-icon.png` (new), `electron-builder.ts`**

1. Copy `build/icons/32x32.png` → `resources/tray-icon.png` (committed binary).
2. In `electron-builder.ts` `extraResources`, add:
   ```ts
   { from: 'resources/tray-icon.png', to: 'tray-icon.png' }
   ```

Commit: `chore(tray): package tray icon in extraResources`

## Task 5 — Verify

- `npm run typecheck` — all 4 projects pass.
- `npm test` — pass.
- `npm run build` — electron-vite build passes (packaged icon path compile).
- `npm run e2e` — run if close handling affects e2e smoke; expected unaffected
  (e2e interacts with the app UI, window is never closed in tests).

Manual smoke (dev, `npm run dev`):

1. App opens with window visible; tray icon appears (Windows: bottom-right
   taskbar).
2. Click X → window hides, one-time notification "…chạy ngầm…" appears; a
   running agent keeps producing output (log file grows).
3. Click tray icon → window reappears with chat/terminal state intact.
4. Click X again → hides silently (no second notification).
5. Tray right-click → **Exit** → app fully quits (window gone, processes
   cleaned up — check `userData/logs`).
6. macOS: Cmd+Q quits (isQuitting path); dock click reopens hidden window.

## Out of scope

- Settings toggle for the behavior (user explicitly did not request one).
- Notifications for agent activity while hidden (already works via
  `NotificationService`).
- IPC/preload/renderer changes.
