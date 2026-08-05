# Custom Title Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the app logo/name and the 3 window control buttons (minimize/maximize/close) into a
single custom title bar row, color-synced with the app's dark theme, matching the VS Code layout on
Windows/macOS/Linux.

**Architecture:** `src/main/index.ts` picks a platform-specific window-chrome config (Windows: hidden
title bar + native color-overlaid buttons via `titleBarOverlay`; macOS: inset native traffic lights via
`trafficLightPosition`, not recolorable — OS restriction; Linux: `frame:false` + fully custom-drawn
buttons). A new `TitleBar` React component renders the logo+name row and, on Linux only, the 3 custom
buttons, talking to the main process over 4 new IPC calls + 1 new event.

**Tech Stack:** Electron 41 (`BrowserWindow` `titleBarOverlay`/`titleBarStyle`/`trafficLightPosition`),
React 19, TypeScript strict, Vitest.

## Global Constraints

- macOS traffic-light buttons cannot be recolored (Apple restriction) — only repositioned. This is an
  accepted, permanent limitation, not a bug to fix later.
- v0.1 scope: logo/name + window controls only. No functional File/Edit/View menu.
- Title bar height: 32px everywhere (`titleBarOverlay.height` on Windows must match the renderer's
  `.title-bar` CSS height so the native and custom rows align).
- Background color: `#252526` (== `--bg-panel` in `src/renderer/src/styles.css`), symbol/text color
  `#cccccc` (== `--text`).
- `npm run typecheck` and `npm test` must pass after every task.
- Electron version is pinned (`^41.7.1` in `package.json`), which supports `titleBarOverlay`/
  `trafficLightPosition` — the platform branch in Task 1 is the only fallback needed; no runtime
  feature-detection of Electron capabilities is required (there's nothing that varies at runtime, unlike
  a browser feature-detect scenario).

---

### Task 1: Platform window-chrome decision logic

**Files:**
- Create: `src/main/window-chrome.ts`
- Test: `tests/unit/window-chrome.test.ts`

**Interfaces:**
- Produces: `getWindowChromeOptions(platform: NodeJS.Platform): Electron.BrowserWindowConstructorOptions`
  — consumed by Task 2's `createWindow()`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/window-chrome.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getWindowChromeOptions } from '../../src/main/window-chrome'

describe('getWindowChromeOptions', () => {
  it('uses a hidden title bar with a colored overlay on Windows', () => {
    const opts = getWindowChromeOptions('win32')
    expect(opts.titleBarStyle).toBe('hidden')
    expect(opts.titleBarOverlay).toEqual({ color: '#252526', symbolColor: '#cccccc', height: 32 })
    expect(opts.frame).toBeUndefined()
  })

  it('insets native traffic lights without recoloring them on macOS', () => {
    const opts = getWindowChromeOptions('darwin')
    expect(opts.titleBarStyle).toBe('hiddenInset')
    expect(opts.trafficLightPosition).toEqual({ x: 12, y: 10 })
    expect(opts.titleBarOverlay).toBeUndefined()
  })

  it('removes the native frame entirely on Linux for custom-drawn controls', () => {
    const opts = getWindowChromeOptions('linux')
    expect(opts.frame).toBe(false)
    expect(opts.titleBarStyle).toBeUndefined()
  })

  it('falls back to the default native frame on unrecognized platforms', () => {
    const opts = getWindowChromeOptions('aix')
    expect(opts.frame).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/window-chrome.test.ts`
Expected: FAIL with `Cannot find module '../../src/main/window-chrome'`

- [ ] **Step 3: Write minimal implementation**

Create `src/main/window-chrome.ts`:

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

const TITLE_BAR_HEIGHT = 32
const TITLE_BAR_BG = '#252526'
const TITLE_BAR_SYMBOL = '#cccccc'

export function getWindowChromeOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: TITLE_BAR_BG, symbolColor: TITLE_BAR_SYMBOL, height: TITLE_BAR_HEIGHT }
    }
  }
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    }
  }
  if (platform === 'linux') {
    return { frame: false }
  }
  return { frame: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/window-chrome.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/window-chrome.ts tests/unit/window-chrome.test.ts
git commit -m "feat: platform-specific window-chrome config for custom title bar"
```

---

### Task 2: IPC wiring for window controls

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `getWindowChromeOptions` from Task 1 (`src/main/window-chrome.ts`).
- Produces: `window.api.platform: NodeJS.Platform`, `window.api.minimizeWindow(): Promise<void>`,
  `window.api.toggleMaximizeWindow(): Promise<void>`, `window.api.closeWindow(): Promise<void>`,
  `window.api.isWindowMaximized(): Promise<boolean>`,
  `window.api.onWindowMaximizedChange(cb: (e: { maximized: boolean }) => void): () => void` — all
  consumed by Task 4's `TitleBar` component.

Note on testing approach: `src/main/index.ts` registers all IPC handlers inline and is not unit-tested
anywhere in this codebase (it calls `app.whenReady()` at import time, so testing it requires mocking
Electron's app lifecycle, which the existing test suite doesn't do for any handler). The 4 new handlers
here are one-line passthroughs to `BrowserWindow` methods (`minimize()`, `maximize()`/`unmaximize()`,
`close()`, `isMaximized()`) — consistent with the rest of `index.ts`, they're verified by the
`ipc-contract.test.ts` type/name contract (Step 5) and the visual check in Task 6, not a dedicated
behavior unit test.

- [ ] **Step 1: Add channels, event type, and `AgentApi` methods**

In `src/shared/ipc.ts`, add to the `Channels` object (after `McpStatus: 'mcp:status',`):

```ts
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',
  EventWindowMaximizedChange: 'window:maximized-change',
```

Add a new interface next to `GitStatusEvent`:

```ts
export interface WindowMaximizedChangeEvent { maximized: boolean }
```

Add to the `AgentApi` interface (after `getMcpStatus(): Promise<McpServerStatus[]>`):

```ts
  platform: NodeJS.Platform
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  onWindowMaximizedChange(cb: (e: WindowMaximizedChangeEvent) => void): () => void
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `src/preload/index.ts` no longer satisfies `AgentApi` (missing properties), and
`tests/unit/ipc-contract.test.ts`'s literal `const api: AgentApi = {...}` also fails to compile.

- [ ] **Step 3: Implement the preload bridge**

In `src/preload/index.ts`, add `WindowMaximizedChangeEvent` to the type import from `../shared/ipc`
(same line as `AgentApi, AgentStateEvent, GitStatusEvent, PtyDataEvent`), then add to the `api` object
(after `getMcpStatus: () => ipcRenderer.invoke(Channels.McpStatus),`):

```ts
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.invoke(Channels.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(Channels.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(Channels.WindowClose),
  isWindowMaximized: () => ipcRenderer.invoke(Channels.WindowIsMaximized),
  onWindowMaximizedChange: (cb: (e: WindowMaximizedChangeEvent) => void) =>
    subscribe(Channels.EventWindowMaximizedChange, cb),
```

- [ ] **Step 4: Implement the main-process handlers and window wiring**

In `src/main/index.ts`, add the import (with the other local imports near the top):

```ts
import { getWindowChromeOptions } from './window-chrome'
```

In `createWindow()`, spread the platform config into the `BrowserWindow` constructor call:

```ts
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Meow Coding',
    backgroundColor: '#1e1e1e',
    ...getWindowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
```

Right after the existing `win.on('closed', () => { win = null })` block (still inside `createWindow`,
before its closing brace), add:

```ts
  win.on('maximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: false }))
```

In `registerIpcHandlers()`, add (next to the other simple handlers, e.g. near `Channels.AppQuit`):

```ts
  ipcMain.handle(Channels.WindowMinimize, () => win?.minimize())
  ipcMain.handle(Channels.WindowToggleMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(Channels.WindowClose, () => win?.close())
  ipcMain.handle(Channels.WindowIsMaximized, () => win?.isMaximized() ?? false)
```

- [ ] **Step 5: Update the IPC contract test**

In `tests/unit/ipc-contract.test.ts`, add the 5 new function names to the `required` array:

```ts
      'minimizeWindow', 'toggleMaximizeWindow', 'closeWindow', 'isWindowMaximized', 'onWindowMaximizedChange'
```

Add to the literal `const api: AgentApi = {...}` (anywhere inside the object):

```ts
      platform: 'win32',
      minimizeWindow: async () => {},
      toggleMaximizeWindow: async () => {},
      closeWindow: async () => {},
      isWindowMaximized: async () => false,
      onWindowMaximizedChange: () => () => {},
```

Add to the second test (`'maps event channel names...'`), inside the `expect` chain:

```ts
    expect(Channels.WindowMinimize).toBe('window:minimize')
    expect(Channels.WindowToggleMaximize).toBe('window:toggle-maximize')
    expect(Channels.WindowClose).toBe('window:close')
    expect(Channels.WindowIsMaximized).toBe('window:is-maximized')
    expect(Channels.EventWindowMaximizedChange).toBe('window:maximized-change')
```

- [ ] **Step 6: Run typecheck and tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: both PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat: IPC channels for window minimize/maximize/close controls"
```

---

### Task 3: Title bar logo asset

The project root has `moew-coding-logo.png` (1254×1254px) — a full app-icon-style image (rounded black
square background, pixel-art cat, with "moew CODING" wordmark baked into the image). It's used as the
app icon in Task 5. For the small title-bar logo (~16px), crop out just the cat artwork (no baked-in
text, no background padding) into its own asset.

**Files:**
- Create: `src/renderer/src/assets/logo-mark.png`

- [ ] **Step 1: Install a one-off image tool (not saved to package.json)**

Run: `npm install --no-save sharp`

- [ ] **Step 2: Crop and resize**

Create a scratch directory first if needed, then run:

```bash
node -e "
const sharp = require('sharp');
sharp('moew-coding-logo.png')
  .extract({ left: 230, top: 160, width: 760, height: 760 })
  .resize(64, 64)
  .toFile('src/renderer/src/assets/logo-mark.png')
  .then(() => console.log('done'))
  .catch(e => { console.error(e); process.exit(1) })
"
```

- [ ] **Step 3: Verify visually and adjust if needed**

Open `src/renderer/src/assets/logo-mark.png` and check: only the cat (no wordmark text, no black
rounded-square background/padding visible), ears and paws not cut off. If the crop is off, adjust the
`left`/`top`/`width`/`height` values in Step 2 (the source is a 1254×1254 square; the cat sits roughly
in the upper-middle two-thirds) and re-run until it looks right.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/logo-mark.png
git commit -m "feat: crop title-bar logo mark from app icon"
```

---

### Task 4: `TitleBar` component

**Files:**
- Create: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api.platform`, `window.api.minimizeWindow`, `window.api.toggleMaximizeWindow`,
  `window.api.closeWindow`, `window.api.isWindowMaximized`, `window.api.onWindowMaximizedChange` (Task
  2); `src/renderer/src/assets/logo-mark.png` (Task 3).

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/TitleBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import logoMark from '../assets/logo-mark.png'

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <line x1="0" y1="5" x2="10" y2="5" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="2.5" y="0.5" width="7" height="7" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="#252526" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" />
      <line x1="10" y1="0" x2="0" y2="10" />
    </svg>
  )
}

export default function TitleBar() {
  const platform = window.api.platform
  const showCustomControls = platform === 'linux'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!showCustomControls) return
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximizedChange(e => setMaximized(e.maximized))
  }, [showCustomControls])

  return (
    <div
      className={`title-bar title-bar-${platform}`}
      onDoubleClick={() => { if (showCustomControls) void window.api.toggleMaximizeWindow() }}
    >
      <div className="title-bar-brand">
        <img src={logoMark} className="title-bar-logo" alt="" />
        <span className="title-bar-title">Meow Coding</span>
      </div>
      {showCustomControls && (
        <div className="title-bar-controls">
          <button className="title-bar-btn" aria-label="Minimize" onClick={() => void window.api.minimizeWindow()}>
            <MinimizeIcon />
          </button>
          <button
            className="title-bar-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.api.toggleMaximizeWindow()}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button className="title-bar-btn title-bar-btn-close" aria-label="Close" onClick={() => void window.api.closeWindow()}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

In `src/renderer/src/App.tsx`, add the import at the top with the other component imports:

```ts
import TitleBar from './components/TitleBar'
```

In the returned JSX, add `<TitleBar />` as the first child inside `<div className="app">`, immediately
before `<div className="app-body">`:

```tsx
    <div className="app">
      <TitleBar />
      <div className="app-body">
```

- [ ] **Step 3: Add title bar styles**

In `src/renderer/src/styles.css`, add (near the other top-level layout rules, e.g. after the `.app-body`
rule at line 74):

```css
.title-bar {
  height: 32px; flex: 0 0 32px; display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-panel); -webkit-app-region: drag; user-select: none;
}
.title-bar-brand { display: flex; align-items: center; gap: 6px; padding-left: 10px; min-width: 0; }
.title-bar-darwin .title-bar-brand { padding-left: 74px; }
.title-bar-logo { width: 16px; height: 16px; flex: none; }
.title-bar-title { font-size: var(--fs-base); color: var(--text); white-space: nowrap; }
.title-bar-controls { display: flex; height: 100%; -webkit-app-region: no-drag; }
.title-bar-btn {
  width: 46px; height: 100%; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: var(--text); cursor: pointer; padding: 0;
}
.title-bar-btn:hover { background: var(--bg-hover); }
.title-bar-btn-close:hover { background: #e81123; color: #fff; }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: TitleBar component merging logo, title, and window controls"
```

---

### Task 5: App icon packaging config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the icon field**

In `package.json`, inside the `"build": { ... }` object, add (as a sibling of `"appId"` and
`"productName"`):

```json
    "icon": "moew-coding-logo.png",
```

electron-builder auto-generates the platform-specific `.ico` (Windows) and `.icns` (macOS) formats from
this single PNG at build time (it's ≥256×256, which is the minimum electron-builder requires).

- [ ] **Step 2: Verify the config parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf-8')); console.log('valid json')"`
Expected: prints `valid json`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: configure app icon for electron-builder packaging"
```

---

### Task 6: Build and visual verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and unit/integration test suite**

Run: `npm run typecheck && npm test`
Expected: all PASS

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: builds without errors

- [ ] **Step 3: Visual check on Windows (current environment)**

Launch the built app and screenshot the title bar to confirm: logo + "Meow Coding" text render on the
left, background color matches the sidebar (`#252526`), and the native Windows minimize/maximize/close
buttons appear at the top-right on the same row (drawn by the OS via `titleBarOverlay`, not by our
code — nothing to assert in the screenshot beyond "buttons are present and the row is one continuous
color").

Use the same Playwright `_electron` driver pattern as prior sessions in this project (launch
`node_modules/electron/dist/electron.exe` with the built `out/` directory, screenshot the window). No
existing project skill for this — a throwaway script is fine.

- [ ] **Step 4: e2e smoke**

Run: `npm run e2e`
Expected: PASS (existing smoke suite; confirms `App.tsx`'s new `<TitleBar />` didn't break app startup)

- [ ] **Step 5: Note remaining manual verification**

macOS and Linux behavior (traffic-light inset position, custom Linux buttons, drag-to-move, double-click
maximize) cannot be verified in this Windows environment. Record this as an open item for the user to
check on real macOS/Linux machines or platform-specific CI before considering those platforms done.
