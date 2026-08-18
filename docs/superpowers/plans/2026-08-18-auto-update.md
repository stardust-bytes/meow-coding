# Auto-update từ GitHub Releases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-update via `electron-updater` backed by GitHub Releases: check once at startup, show a centered dialog with changelog, and add a "Check for Updates" button in a new Updates settings tab.

**Spec:** `docs/superpowers/specs/2026-08-18-auto-update-design.md`

**Tech Stack:** electron-updater (matches electron-builder 26), Electron 41, React 19, Vitest.

---

## Task 1 — Install dependency

- Run `npm install electron-updater`.
- Verify `electron-updater` appears in `package.json` `dependencies`.
- The exact version should match electron-builder 26's peer range (electron-builder 26.15.3 → electron-updater ^6.x).

**Test:** `node -e "require('electron-updater/package.json')"` resolves.

## Task 2 — electron-builder publish config

`electron-builder.ts`:
- Add `publish: { provider: 'github', owner: 'stardust-bytes', repo: 'meow-coding' }` at top level of the exported config (next to `appId`).
- Do NOT modify `.github/workflows/build.yml` — it already uploads `latest*.yml` + `*.blockmap` to GitHub Releases.

**Test:** `npm run dist:dir` still packages successfully (app-update.yml will be generated into the asar resources; not needed for this test).

## Task 3 — Shared types + IPC contract

`src/shared/types.ts`:
- Add discriminated union:
```ts
export type UpdaterStatusEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string; releaseNotes?: string; releaseDate?: string; currentVersion: string }
  | { type: 'up-to-date'; currentVersion: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'not-supported'; message: string }
```

`src/shared/ipc.ts`:
- Channels: `UpdaterCheck: 'updater:check'`, `UpdaterInstall: 'updater:install'`, `EventUpdaterStatus: 'updater:status'`.
- AgentApi methods:
```ts
checkForUpdates(): Promise<void>
installUpdate(): Promise<void>
onUpdaterStatus(cb: (e: UpdaterStatusEvent) => void): () => void
```
- Import `UpdaterStatusEvent` from `./types`.

**Tests (TDD):**
- `tests/unit/ipc-contract.test.ts`: add `checkForUpdates`, `installUpdate`, `onUpdaterStatus` to the required list + stub impls in the mock `api`.

## Task 4 — Main updater service `src/main/updater.ts`

New file. Responsibilities:
- Wrap `electron-updater`'s `autoUpdater`.
- Config: `autoDownload = false`, `autoInstallOnAppQuit = false`.
- **Guard** `isSupported()`:
  - `!app.isPackaged` → false (dev).
  - `process.env.PORTABLE_EXECUTABLE_FILE` → false (Windows portable).
  - Linux and `!process.env.APPIMAGE` → false.
- `check(manual: boolean)`:
  - If not supported → emit `{ type: 'not-supported', message }` only when `manual`; return.
  - If a check is in flight → return (guard).
  - Emit `checking` (only manual).
  - `await autoUpdater.checkForUpdates()`.
  - Map result: `updateInfo` present with `version !== currentVersion` → `update-available` (releaseNotes from `info.releaseNotes` — may be HTML string or array — keep raw; releaseDate from `info.releaseDate`; currentVersion via `app.getVersion()`).
  - No update → `up-to-date`.
- Wire `autoUpdater` events:
  - `download-progress` (percent: `progress.percent` rounded) → emit.
  - `update-downloaded` → emit `downloaded` with new version.
  - `error` → emit `{ type: 'error', message }`.
- `install()`:
  - Call `autoUpdater.quitAndInstall()`.

Signature:
```ts
export class Updater {
  constructor(private onStatus: (e: UpdaterStatusEvent) => void) {}
  check(manual: boolean): Promise<void>
  install(): void
}
```

Note: `electron-updater` types are in the package; import `{ autoUpdater } from 'electron-updater'`. Use `import type { UpdateInfo }` if needed.

**Tests (TDD) — `tests/unit/updater.test.ts`:**
- Mock `electron-updater` via `vi.mock` before importing the module. The mock exposes `autoUpdater` with `checkForUpdates` (vi.fn), `on` (records listeners), `quitAndInstall` (vi.fn), and mutable `autoDownload`/`autoInstallOnAppQuit`.
- Since guards depend on `app.isPackaged`/env, structure `isSupported` to read a small options object injected via constructor (or `vi.stubEnv`) so tests can toggle dev/portable/AppImage states:
  - `isPackaged: boolean`, `isPortable: () => boolean`, `isAppImage: () => boolean` — default to reading electron `app`/env, overridable in tests.
- Test cases:
  1. dev mode (`isPackaged=false`) → `not-supported` when manual; silent (no events) when auto.
  2. portable → `not-supported`.
  3. linux non-AppImage → `not-supported`.
  4. supported + update available → `update-available` with version + releaseNotes + currentVersion.
  5. supported + up-to-date → `up-to-date` (manual only emits).
  6. `checkForUpdates` rejects → `error` event.
  7. `download-progress` event forwarded with percent.
  8. `update-downloaded` → `downloaded`.
  9. `install()` calls `quitAndInstall`.
  10. Second `check` while in-flight is ignored (only one `checkForUpdates` call).

## Task 5 — MainApp wiring

`src/main/index.ts`:
- Import `Updater` and `UpdaterStatusEvent`.
- In `MainApp`, add `private updater: Updater`.
- Construct in constructor:
```ts
this.updater = new Updater((e) => {
  win?.webContents.send(Channels.EventUpdaterStatus, e)
})
```
- Expose methods: `checkForUpdates()` → `this.updater.check(true)`; `installUpdate()` → `this.updater.install()`.
- In `registerIpcHandlers()`:
```ts
ipcMain.handle(Channels.UpdaterCheck, () => mainApp.checkForUpdates())
ipcMain.handle(Channels.UpdaterInstall, () => mainApp.installUpdate())
```
- **Startup auto-check:** in `app.whenReady()` after `createWindow()`, call `mainApp.checkForUpdatesAuto()` (i.e. `this.updater.check(false)`) guarded by a small delay (e.g. `setTimeout(..., 1500)`) so the window paints first. Only when `app.isPackaged`.

**Tests:** existing `main` tests don't cover index.ts wiring; rely on typecheck + manual.

## Task 6 — Preload

`src/preload/index.ts`:
```ts
checkForUpdates: () => ipcRenderer.invoke(Channels.UpdaterCheck),
installUpdate: () => ipcRenderer.invoke(Channels.UpdaterInstall),
onUpdaterStatus: (cb: (e: UpdaterStatusEvent) => void) => subscribe(Channels.EventUpdaterStatus, cb),
```
- Import `UpdaterStatusEvent` type.

## Task 7 — UpdateDialog component

`src/renderer/src/components/UpdateDialog.tsx` (new):
- Props: `{ status: UpdaterStatusEvent | null, onClose: () => void, onInstall: () => void }`.
- Renders when `status?.type === 'update-available'` or `'downloaded'` (dialog auto-opens only for these two).
- Content:
  - Title "Update available".
  - `currentVersion → version`.
  - Changelog: `<MarkdownText text={releaseNotes ?? ''} />` (import from `./chat/MarkdownText`). If `releaseNotes` missing → skip section.
  - `update-available` → buttons **Update & Restart** (calls `onInstall`) / **Later** (`onClose`).
  - `downloaded` → button **Restart now** (`onInstall`) / **Later**.
  - `download-progress` (during install) → progress bar + `percent%`, buttons disabled.
- Style: reuse `.dialog`, `.dialog-backdrop` classes; add `.update-dialog`, `.update-progress`, `.update-changelog` (scrollable, max-height) in `styles.css`.

## Task 8 — Updates settings tab

`src/renderer/src/components/settings/UpdatesTab.tsx` (new):
- Local state: `status: UpdaterStatusEvent | null`, `busy: boolean`.
- On mount: subscribe `window.api.onUpdaterStatus` → `setStatus`.
- Button **"Check for Updates"** → `setBusy(true); await window.api.checkForUpdates(); setBusy(false)` (busy guard while checking).
- Status line by `status.type`:
  - `checking` → "Checking for updates…"
  - `up-to-date` → `You're on the latest version (v{currentVersion}).`
  - `update-available` → `v{version} is available` + **Update & Restart** button (`window.api.installUpdate()`).
  - `downloaded` → "Download complete — restart to install." + **Restart now**.
  - `download-progress` → progress bar.
  - `error` → red message.
  - `not-supported` → message (portable/linux non-AppImage/dev).

`src/renderer/src/components/settings/SettingsDialog.tsx`:
- Add `'updates'` to `TabId`; add `{ id: 'updates', label: 'Updates' }` to `TABS`.
- Render `<UpdatesTab />` when `tab === 'updates'` (no draft needed).

`styles.css`: add `.updates-tab` styles (status colors, progress bar reuse).

## Task 9 — App-level dialog wiring

`src/renderer/src/App.tsx`:
- State: `updateStatus: UpdaterStatusEvent | null`, `updateDialogOpen: boolean`.
- Subscribe `window.api.onUpdaterStatus` in the main effects block:
  - `setUpdateStatus(e)`.
  - If `e.type === 'update-available'` → `setUpdateDialogOpen(true)`.
  - If `e.type === 'error' || 'not-supported'` while dialog open → close dialog (keep status for Settings tab).
- Render `<UpdateDialog status={updateStatus} onClose={...} onInstall={() => void window.api.installUpdate()} />` when `updateDialogOpen && (status.type === 'update-available' || status.type === 'downloaded')`.
- `installUpdate` fires `download-progress`/`downloaded` events; the dialog stays open, showing progress, then "Restart now".

## Task 10 — CSS

`src/renderer/src/styles.css` additions:
- `.update-dialog` — width ~480px.
- `.update-changelog` — max-height 240px, overflow-y auto, border, padding, `white-space: normal`.
- `.update-progress` — bar track + fill (reuse existing progress styles if any; otherwise simple div bar).
- `.updates-tab .updates-status-error { color: var(--red) }` and `.updates-status-ok { color: var(--green) }`.

## Task 11 — Tests + verification

- `npm run typecheck` — all three tsconfigs pass.
- `npm test` — all unit tests pass (including new `updater.test.ts`, updated `ipc-contract.test.ts`).
- `npm run build` — electron-vite build passes.
- E2E: `npm run e2e` — smoke tests still pass (update feature is dev-mode guarded; existing smoke must not regress).
- Manual (optional): `npm run dist:dir` → run the unpacked app; verify auto-check silently skips (dev/portable guard), Settings > Updates shows "not supported" message (manual check only).

## Global constraints

- AGENTS.md: IPC channels only via `Channels` from `src/shared/ipc.ts` — never hardcode strings.
- `src/shared` must not import Node/Electron.
- Only main process spawns/kills processes; renderer via `window.api`.
- System-style notifications from main use Vietnamese with `[meow]` prefix; UI labels in English.
- No redundant comments.
- UpdateService emits status events; MainApp forwards to renderer — keep the service Electron-agnostic except for the updater import so it stays unit-testable.
