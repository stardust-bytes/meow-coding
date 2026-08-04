# Meow Coding — Desktop Agent Console: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây desktop app cho phép mở nhiều CLI coding agent (opencode, claude, aider, ...) trong các pane terminal song song và điều khiển từ một cửa sổ.

**Architecture:** Electron (main/preload/renderer). Main process sở hữu các service thuần Node (PtyManager, WorkspaceStore, TemplateManager, LogManager, GitStatusService, AlertService) hoàn toàn tách khỏi UI; giao tiếp qua IPC contract tập trung trong `src/shared`. Renderer là React: sidebar đa project + grid pane xterm.js + header badge/quick actions + zoom. Khi đóng app, kill toàn bộ process tree.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, `@lydell/node-pty` (ConPTY Windows), `@xterm/xterm` + `@xterm/addon-fit`, `tree-kill`, Vitest (unit + integration), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-08-04-meow-coding-agent-console-design.md`

---

## File Structure

Các file sẽ được tạo, với trách nhiệm từng file:

| File | Trách nhiệm |
|---|---|
| `package.json` | Scripts, dependencies |
| `electron.vite.config.ts` | Build main/preload/renderer, alias `@shared` |
| `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` | TypeScript config |
| `vitest.config.ts` | Config test (node env) |
| `src/shared/types.ts` | Toàn bộ type dùng chung (Template, Workspace, AgentState, ...) |
| `src/shared/ipc.ts` | Channel names + `AgentApi` (IPC contract) |
| `src/main/json-store.ts` | Helper đọc/ghi JSON list, chống file hỏng |
| `src/main/default-templates.ts` | Template mặc định: opencode, claude, aider |
| `src/main/template-manager.ts` | CRUD template |
| `src/main/workspace-store.ts` | CRUD workspace (project + agents) |
| `src/main/pty-manager.ts` | Spawn/kill/restart/write PTY, kill process tree |
| `src/main/log-manager.ts` | Append output ra file log |
| `src/main/git-status-service.ts` | Parse `git status --porcelain=v2 -b` |
| `src/main/alert-service.ts` | Heuristic idle/exit |
| `src/main/index.ts` | Khởi tạo app, cửa sổ, IPC handlers, lifecycle |
| `src/preload/index.ts` | contextBridge expose `window.api` |
| `src/renderer/index.html` | HTML entry |
| `src/renderer/src/main.tsx` | React entry |
| `src/renderer/src/App.tsx` | Layout tổng: sidebar + grid, state events |
| `src/renderer/src/styles.css` | CSS dark theme coding |
| `src/renderer/src/components/Sidebar.tsx` | Danh sách project + templates + add |
| `src/renderer/src/components/PaneGrid.tsx` | Grid pane + zoom |
| `src/renderer/src/components/Pane.tsx` | 1 pane: header + xterm |
| `src/renderer/src/components/XtermHost.tsx` | Nhúng xterm.js, fit, pipe data |
| `src/renderer/src/components/PaneHeader.tsx` | Status dot, git badge, toolbar actions |
| `src/renderer/src/components/AddProjectDialog.tsx` | Chọn folder + đặt tên |
| `src/renderer/src/components/AddAgentDialog.tsx` | Chọn template + cwd + tên |
| `tests/fixtures/echo-agent.js` | Fake CLI cho integration test |
| `tests/unit/*.test.ts`, `tests/integration/*.test.ts` | Tests |

---

## Task 1: Scaffold dự án (Electron + electron-vite + React + TypeScript)

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts` (bản tối thiểu mở cửa sổ)
- Create: `src/preload/index.ts` (rỗng, có comment)
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx` (render "Hello")
- Create: `src/renderer/src/App.tsx` (bản tối thiểu)

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "meow-coding",
  "version": "0.1.0",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 2: Cài dependencies**

```bash
npm install -D electron electron-vite vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node @lydell/node-pty @types/tree-kill vitest @playwright/test electron-builder
npm install react react-dom @xterm/xterm @xterm/addon-fit tree-kill
npx electron-vite init --help
```

Ghi chú: `@lydell/node-pty` là fork được duy trì của node-pty (cùng công nghệ VS Code), có prebuild cho Electron. Nếu build native module fail, chạy:
```bash
npx @electron/rebuild -f -w @lydell/node-pty
```

- [ ] **Step 3: Tạo `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  }
})
```

- [ ] **Step 4: Tạo `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

- [ ] **Step 5: Tạo `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```

- [ ] **Step 6: Tạo `tsconfig.web.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 7: Tạo `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000
  }
})
```

- [ ] **Step 8: Tạo `src/main/index.ts` (tối thiểu)**

```ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Meow Coding',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 9: Tạo `src/preload/index.ts` (tối thiểu)**

```ts
export {}
```

- [ ] **Step 10: Tạo `src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>Meow Coding</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11: Tạo `src/renderer/src/main.tsx`**

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 12: Tạo `src/renderer/src/App.tsx` (tối thiểu)**

```tsx
export default function App() {
  return <div className="app">Meow Coding</div>
}
```

- [ ] **Step 13: Tạo `src/renderer/src/styles.css`**

```css
:root {
  --bg: #1e1e1e;
  --bg-panel: #252526;
  --bg-hover: #2a2d2e;
  --border: #3c3c3c;
  --text: #d4d4d4;
  --text-dim: #9d9d9d;
  --accent: #3794ff;
  --green: #4ec9b0;
  --yellow: #dcdcaa;
  --red: #f48771;
  --font-mono: 'Cascadia Mono', 'Fira Code', Consolas, 'Courier New', monospace;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  overflow: hidden;
  user-select: none;
}
.app { height: 100%; display: flex; }
```

- [ ] **Step 14: Chạy app xác nhận cửa sổ mở**

Run: `npm run dev`
Expected: cửa sổ Electron mở, hiển thị "Meow Coding", không có lỗi trong console. Nhấn `Ctrl+C` để thoát.

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json vitest.config.ts src
git commit -m "feat: scaffold electron-vite + react + typescript app"
```

---

## Task 2: Shared types + IPC contract

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc.ts`
- Test: `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Viết failing test**

`tests/unit/ipc-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi, PtyDataEvent, AgentStateEvent, GitStatusEvent } from '../../src/shared/ipc'

describe('IPC contract', () => {
  it('defines all channels used by the preload api', () => {
    const required: (keyof AgentApi)[] = [
      'listWorkspaces', 'addWorkspace', 'removeWorkspace', 'openWorkspace',
      'addAgent', 'removeAgent', 'listTemplates', 'saveTemplate', 'removeTemplate',
      'pickFolder', 'startAgent', 'stopAgent', 'restartAgent',
      'writeInput', 'injectPrompt', 'openLog', 'getLogPath', 'quit',
      'onPtyData', 'onAgentState', 'onGitStatus'
    ]
    for (const key of required) {
      expect(typeof (null as unknown as AgentApi)[key]).toBe('function')
    }
  })

  it('maps event channel names to the AgentApi method names', () => {
    expect(Channels.EventPtyData).toBe('pty:data')
    expect(Channels.EventAgentState).toBe('agent:state')
    expect(Channels.EventGitStatus).toBe('git:status')
    expect(Channels.PtyInput).toBe('pty:input')
  })

  it('types event payloads without runtime error', () => {
    const d: PtyDataEvent = { agentId: 'a1', data: 'x' }
    const s: AgentStateEvent = { agentId: 'a1', state: {} as never }
    const g: GitStatusEvent = { projectPath: '/p', git: { branch: 'main', dirtyCount: 0 } }
    expect(d.data).toBe('x')
    expect(s.agentId).toBe('a1')
    expect(g.git.branch).toBe('main')
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/ipc'`.

- [ ] **Step 3: Tạo `src/shared/types.ts`**

```ts
export type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
export type AlertLevel = 'normal' | 'attention' | 'error'

export interface Template {
  id: string
  name: string
  command: string
  args: string[]
}

export interface AgentConfig {
  id: string
  name: string
  templateId: string
  cwd: string
}

export interface Workspace {
  projectPath: string
  name: string
  agents: AgentConfig[]
}

export interface WorkspaceSummary {
  projectPath: string
  name: string
  agentCount: number
}

export interface GitStatus {
  branch: string | null
  dirtyCount: number
}

export interface AgentState {
  agentId: string
  status: AgentStatus
  exitCode: number | null
  lastOutputAt: number | null
  alert: AlertLevel
}

export interface WorkspaceRuntime {
  workspace: Workspace
  agents: AgentState[]
  git: GitStatus | null
}

export interface NewAgentInput {
  name: string
  templateId: string
  cwd: string
}
```

- [ ] **Step 4: Tạo `src/shared/ipc.ts`**

```ts
import type { AgentState, GitStatus, NewAgentInput, Template, WorkspaceRuntime, WorkspaceSummary } from './types'

export const Channels = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  WorkspaceOpen: 'workspace:open',
  AgentAdd: 'agent:add',
  AgentRemove: 'agent:remove',
  TemplateList: 'template:list',
  TemplateSave: 'template:save',
  TemplateRemove: 'template:remove',
  PickFolder: 'dialog:pick-folder',
  PtyStart: 'pty:start',
  PtyStop: 'pty:stop',
  PtyRestart: 'pty:restart',
  PtyInput: 'pty:input',
  PtyInject: 'pty:inject',
  LogOpen: 'log:open',
  LogPath: 'log:path',
  AppQuit: 'app:quit',
  EventPtyData: 'pty:data',
  EventAgentState: 'agent:state',
  EventGitStatus: 'git:status'
} as const

export interface PtyDataEvent { agentId: string; data: string }
export interface AgentStateEvent { agentId: string; state: AgentState }
export interface GitStatusEvent { projectPath: string; git: GitStatus }

export interface AgentApi {
  listWorkspaces(): Promise<WorkspaceSummary[]>
  addWorkspace(projectPath: string, name: string): Promise<WorkspaceRuntime | null>
  removeWorkspace(projectPath: string): Promise<void>
  openWorkspace(projectPath: string): Promise<WorkspaceRuntime>
  addAgent(projectPath: string, input: NewAgentInput): Promise<WorkspaceRuntime>
  removeAgent(projectPath: string, agentId: string): Promise<void>
  listTemplates(): Promise<Template[]>
  saveTemplate(template: Template): Promise<Template>
  removeTemplate(id: string): Promise<void>
  pickFolder(): Promise<string | null>
  startAgent(agentId: string): Promise<void>
  stopAgent(agentId: string): Promise<void>
  restartAgent(agentId: string): Promise<void>
  writeInput(agentId: string, data: string): Promise<void>
  injectPrompt(agentId: string, text: string): Promise<void>
  openLog(agentId: string): Promise<void>
  getLogPath(agentId: string): Promise<string>
  quit(): Promise<void>
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onAgentState(cb: (e: AgentStateEvent) => void): () => void
  onGitStatus(cb: (e: GitStatusEvent) => void): () => void
}
```

Note: `src/shared/ipc.ts` dùng `AgentState` và `NewAgentInput` trong interface `AgentApi` — đã có trong import ở trên.

- [ ] **Step 5: Chạy test xác nhận pass**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared tests/unit/ipc-contract.test.ts
git commit -m "feat: shared types and ipc contract"
```

---

## Task 3: JsonStore helper + TemplateManager + default templates

**Files:**
- Create: `src/main/json-store.ts`
- Create: `src/main/default-templates.ts`
- Create: `src/main/template-manager.ts`
- Test: `tests/unit/json-store.test.ts`, `tests/unit/template-manager.test.ts`

- [ ] **Step 1: Viết failing test cho `json-store`**

`tests/unit/json-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-json-'))
  file = path.join(dir, 'data.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createJsonStore', () => {
  it('returns [] when file does not exist', () => {
    expect(createJsonStore<number>(file).load()).toEqual([])
  })

  it('returns [] when file is corrupt', () => {
    writeFileSync(file, 'not-json{{{')
    expect(createJsonStore<number>(file).load()).toEqual([])
  })

  it('loads saved items and persists them', () => {
    const store = createJsonStore<{ n: number }>(file)
    store.save([{ n: 1 }, { n: 2 }])
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }, { n: 2 }])
    expect(existsSync(file)).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/json-store.test.ts`
Expected: FAIL — cannot find module `../../src/main/json-store`.

- [ ] **Step 3: Tạo `src/main/json-store.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface JsonStore<T> {
  load(): T[]
  save(items: T[]): void
}

export function createJsonStore<T>(filePath: string): JsonStore<T> {
  return {
    load(): T[] {
      if (!existsSync(filePath)) return []
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
        return Array.isArray(parsed) ? (parsed as T[]) : []
      } catch {
        return []
      }
    },
    save(items: T[]): void {
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(items, null, 2))
    }
  }
}
```

- [ ] **Step 4: Chạy test pass**

Run: `npx vitest run tests/unit/json-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Viết failing test cho `template-manager`**

`tests/unit/template-manager.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createJsonStore } from '../../src/main/json-store'
import { TemplateManager } from '../../src/main/template-manager'
import type { Template } from '../../src/shared/types'

const DEFAULTS: Template[] = [
  { id: 'opencode', name: 'opencode', command: 'opencode', args: [] }
]

function makeManager() {
  const items: Template[] = []
  const store = {
    load: () => items,
    save: (next: Template[]) => { items.splice(0, items.length, ...next) }
  }
  return { manager: new TemplateManager(store, DEFAULTS), items }
}

describe('TemplateManager', () => {
  it('lists defaults when nothing saved', () => {
    const { manager } = makeManager()
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })

  it('saves a new template and assigns an id', () => {
    const { manager, items } = makeManager()
    const saved = manager.save({ id: '', name: 'custom', command: 'mycli', args: ['--x'] })
    expect(saved.id).toBeTruthy()
    expect(items).toHaveLength(1)
    expect(manager.list()).toContainEqual(saved)
  })

  it('updates an existing template by id', () => {
    const { manager } = makeManager()
    manager.save({ id: 'opencode', name: 'opencode2', command: 'opencode', args: [] })
    const list = manager.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('opencode2')
  })

  it('does not remove a default template', () => {
    const { manager } = makeManager()
    manager.remove('opencode')
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })

  it('removes a custom template', () => {
    const { manager } = makeManager()
    const saved = manager.save({ id: '', name: 'custom', command: 'x', args: [] })
    manager.remove(saved.id)
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })
})
```

- [ ] **Step 6: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/template-manager.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 7: Tạo `src/main/default-templates.ts`**

```ts
import type { Template } from '../shared/types'

export const DEFAULT_TEMPLATES: Template[] = [
  { id: 'opencode', name: 'opencode', command: 'opencode', args: [] },
  { id: 'claude', name: 'claude code', command: 'claude', args: [] },
  { id: 'aider', name: 'aider', command: 'aider', args: ['--auto-commits'] }
]
```

- [ ] **Step 8: Tạo `src/main/template-manager.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { Template } from '../shared/types'
import type { JsonStore } from './json-store'

export class TemplateManager {
  constructor(
    private store: JsonStore<Template>,
    private defaults: Template[]
  ) {}

  list(): Template[] {
    const saved = this.store.load()
    const savedIds = new Set(saved.map(t => t.id))
    return [...this.defaults.filter(d => !savedIds.has(d.id)), ...saved]
  }

  save(template: Template): Template {
    const next = { ...template, id: template.id || randomUUID() }
    this.store.save(this.store.load().filter(t => t.id !== next.id).concat(next))
    return next
  }

  remove(id: string): void {
    if (this.defaults.some(d => d.id === id)) return
    this.store.save(this.store.load().filter(t => t.id !== id))
  }
}
```

- [ ] **Step 9: Chạy test pass**

Run: `npx vitest run tests/unit/template-manager.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add src/main tests/unit
git commit -m "feat: json store and template manager"
```

---

## Task 4: WorkspaceStore

**Files:**
- Create: `src/main/workspace-store.ts`
- Test: `tests/unit/workspace-store.test.ts`

- [ ] **Step 1: Viết failing test**

`tests/unit/workspace-store.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { WorkspaceStore } from '../../src/main/workspace-store'

let file: string
let store: WorkspaceStore

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-ws-'))
  file = path.join(dir, 'workspaces.json')
  store = new WorkspaceStore(createJsonStore(file))
})

afterEach(() => rmSync(path.dirname(file), { recursive: true, force: true }))

describe('WorkspaceStore', () => {
  it('lists empty by default', () => {
    expect(store.list()).toEqual([])
  })

  it('adds a workspace without duplicating', () => {
    store.add('/proj/a', 'Project A')
    store.add('/proj/a', 'Project A again')
    expect(store.list()).toHaveLength(1)
    expect(store.get('/proj/a')?.name).toBe('Project A')
  })

  it('adds an agent and keeps its config', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    expect(ws.agents).toHaveLength(1)
    expect(ws.agents[0].id).toBeTruthy()
    expect(ws.agents[0].templateId).toBe('opencode')
  })

  it('removes an agent by id', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    const agentId = ws.agents[0].id
    const after = store.removeAgent('/proj/a', agentId)
    expect(after.agents).toHaveLength(0)
  })

  it('throws when adding an agent to an unknown workspace', () => {
    expect(() => store.addAgent('/nope', { name: 'x', templateId: 't', cwd: '/nope' }))
      .toThrow('Workspace not found')
  })

  it('removes a workspace', () => {
    store.add('/proj/a', 'Project A')
    store.remove('/proj/a')
    expect(store.list()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Tạo `src/main/workspace-store.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { AgentConfig, NewAgentInput, Workspace, WorkspaceSummary } from '../shared/types'
import type { JsonStore } from './json-store'

export class WorkspaceStore {
  constructor(private store: JsonStore<Workspace>) {}

  list(): WorkspaceSummary[] {
    return this.store.load().map(w => ({
      projectPath: w.projectPath,
      name: w.name,
      agentCount: w.agents.length
    }))
  }

  get(projectPath: string): Workspace | undefined {
    return this.store.load().find(w => w.projectPath === projectPath)
  }

  add(projectPath: string, name: string): Workspace {
    const all = this.store.load()
    let ws = all.find(w => w.projectPath === projectPath)
    if (!ws) {
      ws = { projectPath, name, agents: [] }
      all.push(ws)
      this.store.save(all)
    }
    return ws
  }

  remove(projectPath: string): void {
    this.store.save(this.store.load().filter(w => w.projectPath !== projectPath))
  }

  addAgent(projectPath: string, input: NewAgentInput): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    const agent: AgentConfig = { id: randomUUID(), ...input }
    ws.agents.push(agent)
    this.store.save(all)
    return ws
  }

  removeAgent(projectPath: string, agentId: string): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    ws.agents = ws.agents.filter(a => a.id !== agentId)
    this.store.save(all)
    return ws
  }
}
```

- [ ] **Step 4: Chạy test pass**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace-store.ts tests/unit/workspace-store.test.ts
git commit -m "feat: workspace store"
```

---

## Task 5: LogManager

**Files:**
- Create: `src/main/log-manager.ts`
- Test: `tests/unit/log-manager.test.ts`

- [ ] **Step 1: Viết failing test**

`tests/unit/log-manager.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LogManager } from '../../src/main/log-manager'

let dir: string
let logs: LogManager

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-log-'))
  logs = new LogManager(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('LogManager', () => {
  it('appends data to a per-agent file and creates it', () => {
    logs.append('a1', 'hello')
    logs.append('a1', ' world')
    const content = readFileSync(path.join(dir, 'a1.log'), 'utf-8')
    expect(content).toBe('hello world')
  })

  it('exposes the file path and existence', () => {
    expect(logs.exists('a1')).toBe(false)
    logs.append('a1', 'x')
    expect(logs.exists('a1')).toBe(true)
    expect(logs.pathFor('a1')).toBe(path.join(dir, 'a1.log'))
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/log-manager.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Tạo `src/main/log-manager.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export class LogManager {
  constructor(private logDir: string) {}

  private fileFor(agentId: string): string {
    return path.join(this.logDir, `${agentId}.log`)
  }

  append(agentId: string, data: string): void {
    mkdirSync(this.logDir, { recursive: true })
    appendFileSync(this.fileFor(agentId), data)
  }

  pathFor(agentId: string): string {
    return this.fileFor(agentId)
  }

  exists(agentId: string): boolean {
    return existsSync(this.fileFor(agentId))
  }
}
```

- [ ] **Step 4: Chạy test pass**

Run: `npx vitest run tests/unit/log-manager.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/log-manager.ts tests/unit/log-manager.test.ts
git commit -m "feat: log manager"
```

---

## Task 6: GitStatusService

**Files:**
- Create: `src/main/git-status-service.ts`
- Test: `tests/unit/git-status-service.test.ts`

- [ ] **Step 1: Viết failing test**

`tests/unit/git-status-service.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitStatusService } from '../../src/main/git-status-service'

describe('GitStatusService.parse', () => {
  const svc = new GitStatusService()

  it('parses branch and dirty count from porcelain v2 output', () => {
    const out = [
      '# branch.oid abc123',
      '# branch.head main',
      '1 M 100644 123 456 789 file.ts',
      '? untracked.txt'
    ].join('\n') + '\n'
    expect(svc.parse(out)).toEqual({ branch: 'main', dirtyCount: 2 })
  })

  it('ignores branch header lines when counting dirty files', () => {
    const out = '# branch.oid xyz\n# branch.head feat/abc\n'
    expect(svc.parse(out)).toEqual({ branch: 'feat/abc', dirtyCount: 0 })
  })

  it('handles detached HEAD as null branch', () => {
    const out = '# branch.oid abc\n# branch.head (detached)\n'
    expect(svc.parse(out)).toEqual({ branch: null, dirtyCount: 0 })
  })
})

describe('GitStatusService.get', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-git-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null when not a git repo', async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'meow-git-nr-'))
    try {
      const result = await new GitStatusService().get(notRepo)
      expect(result).toBeNull()
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })

  it('reports branch and a dirty file', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hi')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    writeFileSync(path.join(dir, 'a.txt'), 'changed')
    const result = await new GitStatusService().get(dir)
    expect(result).not.toBeNull()
    expect(result?.branch).toBe('master')
    expect(result!.dirtyCount).toBe(1)
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/git-status-service.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Tạo `src/main/git-status-service.ts`**

```ts
import { execFile } from 'node:child_process'
import type { GitStatus } from '../shared/types'

export class GitStatusService {
  get(projectPath: string): Promise<GitStatus | null> {
    return new Promise(resolve => {
      execFile(
        'git',
        ['status', '--porcelain=v2', '-b'],
        { cwd: projectPath },
        (err, stdout) => {
          if (err) return resolve(null)
          resolve(this.parse(stdout))
        }
      )
    })
  }

  parse(stdout: string): GitStatus {
    let branch: string | null = null
    let dirtyCount = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) {
        const value = line.slice('# branch.head '.length)
        branch = value === '(detached)' ? null : value
      } else if (line.length > 0) {
        dirtyCount++
      }
    }
    return { branch, dirtyCount }
  }
}
```

- [ ] **Step 4: Chạy test pass**

Run: `npx vitest run tests/unit/git-status-service.test.ts`
Expected: PASS (5 tests). Lưu ý: nếu `git init` tạo branch `main` thay vì `master`, cập nhật assertion trong test (`expect(result?.branch).toBe('main')`) cho khớp bản git của bạn.

- [ ] **Step 5: Commit**

```bash
git add src/main/git-status-service.ts tests/unit/git-status-service.test.ts
git commit -m "feat: git status service"
```

---

## Task 7: AlertService

**Files:**
- Create: `src/main/alert-service.ts`
- Test: `tests/unit/alert-service.test.ts`

- [ ] **Step 1: Viết failing test**

`tests/unit/alert-service.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { AlertService } from '../../src/main/alert-service'

afterEach(() => {
  vi.useRealTimers()
})

describe('AlertService', () => {
  it('emits idle when no output for the threshold', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const spy = vi.fn()
    alerts.on('idle', spy)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(150)
    expect(spy).toHaveBeenCalledWith({ agentId: 'a1' })
  })

  it('resets the idle timer on new output', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const spy = vi.fn()
    alerts.on('idle', spy)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(60)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(60)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('emits exit and clears the idle timer', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const idleSpy = vi.fn()
    const exitSpy = vi.fn()
    alerts.on('idle', idleSpy)
    alerts.on('exit', exitSpy)
    alerts.onOutput('a1')
    alerts.onExit('a1', 1)
    vi.advanceTimersByTime(200)
    expect(idleSpy).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith({ agentId: 'a1', exitCode: 1 })
  })
})
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/unit/alert-service.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Tạo `src/main/alert-service.ts`**

```ts
import { EventEmitter } from 'node:events'

export interface AlertServiceConfig {
  idleThresholdMs: number
}

export const DEFAULT_ALERT_CONFIG: AlertServiceConfig = { idleThresholdMs: 5 * 60_000 }

export class AlertService extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private config: AlertServiceConfig = DEFAULT_ALERT_CONFIG) {
    super()
  }

  onOutput(agentId: string): void {
    this.resetTimer(agentId)
  }

  onExit(agentId: string, exitCode: number): void {
    this.clearTimer(agentId)
    this.emit('exit', { agentId, exitCode })
  }

  private resetTimer(agentId: string): void {
    this.clearTimer(agentId)
    this.timers.set(
      agentId,
      setTimeout(() => {
        this.timers.delete(agentId)
        this.emit('idle', { agentId })
      }, this.config.idleThresholdMs)
    )
  }

  private clearTimer(agentId: string): void {
    const t = this.timers.get(agentId)
    if (t) clearTimeout(t)
    this.timers.delete(agentId)
  }
}
```

- [ ] **Step 4: Chạy test pass**

Run: `npx vitest run tests/unit/alert-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/alert-service.ts tests/unit/alert-service.test.ts
git commit -m "feat: alert service"
```

---

## Task 8: PtyManager (spawn/kill/restart PTY)

**Files:**
- Create: `src/main/pty-manager.ts`
- Create: `tests/fixtures/echo-agent.js`
- Test: `tests/integration/pty-manager.test.ts`

- [ ] **Step 1: Tạo fake CLI**

`tests/fixtures/echo-agent.js`:

```js
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => process.stdout.write('echo:' + d))
process.stdout.write('READY\n')
setInterval(() => {}, 1000)
```

- [ ] **Step 2: Viết failing integration test**

`tests/integration/pty-manager.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import path from 'node:path'
import { PtyManager } from '../../src/main/pty-manager'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'echo-agent.js')

describe('PtyManager', () => {
  const managers: PtyManager[] = []

  afterEach(async () => {
    await Promise.all(managers.map(m => m.stopAll()))
    managers.length = 0
  })

  it('spawns a CLI and streams output', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for READY')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(data.join('')).toContain('READY')
  })

  it('writes input and receives echoed data', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          pty.write('a1', 'hi\n')
          resolve()
          clearTimeout(t)
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting echo')), 10000)
      const check = () => {
        if (data.some(d => d.includes('echo:hi'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  })

  it('emits exit when stopped and removes the session', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const exited: { agentId: string; exitCode: number }[] = []
    pty.on('exit', e => exited.push(e))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await pty.stop('a1')
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting exit')), 10000)
      const check = () => {
        if (exited.length > 0) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(exited[0].agentId).toBe('a1')
    expect(() => pty.write('a1', 'x')).not.toThrow()
  })
})
```

- [ ] **Step 3: Chạy test xác nhận fail**

Run: `npx vitest run tests/integration/pty-manager.test.ts`
Expected: FAIL — cannot find module `../../src/main/pty-manager`.

- [ ] **Step 4: Tạo `src/main/pty-manager.ts`**

```ts
import { EventEmitter } from 'node:events'
import * as pty from '@lydell/node-pty'
import { kill } from 'tree-kill'

export interface PtySession {
  agentId: string
  name: string
  cwd: string
  process: pty.IPty
  pid: number
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>()
  private stopping = new Set<string>()

  start(agentId: string, name: string, command: string, args: string[], cwd: string): PtySession {
    if (this.sessions.has(agentId)) throw new Error(`Agent already running: ${agentId}`)
    if (this.stopping.has(agentId)) throw new Error(`Agent is stopping: ${agentId}`)
    const process = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: { ...process.env } as Record<string, string>
    })
    const session: PtySession = { agentId, name, cwd, process, pid: process.pid }
    this.sessions.set(agentId, session)

    process.onData(data => {
      this.emit('data', { agentId, data })
    })
    process.onExit(({ exitCode }) => {
      this.sessions.delete(agentId)
      this.emit('exit', { agentId, exitCode })
    })
    return session
  }

  write(agentId: string, data: string): void {
    const s = this.sessions.get(agentId)
    if (s) s.process.write(data)
  }

  stop(agentId: string): Promise<void> {
    const s = this.sessions.get(agentId)
    if (!s) return Promise.resolve()
    this.stopping.add(agentId)
    return new Promise<void>(resolve => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        this.stopping.delete(agentId)
        resolve()
      }
      kill(s.pid, () => done())
      setTimeout(done, 3000)
    })
  }

  stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    return Promise.all(ids.map(id => this.stop(id))).then(() => undefined)
  }
}
```

- [ ] **Step 5: Chạy test pass**

Run: `npx vitest run tests/integration/pty-manager.test.ts`
Expected: PASS (3 tests). Nếu lỗi "Could not load pty" (native module), chạy rebuild:
```bash
npx @electron/rebuild -f -w @lydell/node-pty
```
Lưu ý: khi chạy qua vitest (node ABI), `@lydell/node-pty` tự chọn prebuild đúng; chỉ rebuild khi chạy trong Electron.

- [ ] **Step 6: Commit**

```bash
git add src/main/pty-manager.ts tests/fixtures tests/integration
git commit -m "feat: pty manager with tree-kill"
```

---

## Task 9: Main process wiring (index.ts, IPC handlers, lifecycle)

**Files:**
- Modify: `src/main/index.ts` (thay toàn bộ)
- Test: không có (logic đã test ở các service; phần này là glue)

- [ ] **Step 1: Thay nội dung `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { createJsonStore } from './json-store'
import { TemplateManager } from './template-manager'
import { DEFAULT_TEMPLATES } from './default-templates'
import { WorkspaceStore } from './workspace-store'
import { PtyManager } from './pty-manager'
import { LogManager } from './log-manager'
import { GitStatusService } from './git-status-service'
import { AlertService } from './alert-service'
import { Channels } from '../shared/ipc'
import type { AgentState, Template, Workspace, WorkspaceRuntime } from '../shared/types'

let win: BrowserWindow | null = null

class MainApp {
  templates = new TemplateManager(
    createJsonStore<Template>(path.join(app.getPath('userData'), 'templates.json')),
    DEFAULT_TEMPLATES
  )
  workspaces = new WorkspaceStore(
    createJsonStore<Workspace>(path.join(app.getPath('userData'), 'workspaces.json'))
  )
  pty = new PtyManager()
  logs = new LogManager(path.join(app.getPath('userData'), 'logs'))
  git = new GitStatusService()
  alerts = new AlertService()

  private states = new Map<string, AgentState>()
  private gitTimer: ReturnType<typeof setInterval> | null = null
  private activeProject: string | null = null

  constructor() {
    this.pty.on('data', ({ agentId, data }) => {
      this.logs.append(agentId, data)
      this.alerts.onOutput(agentId)
      this.setState(agentId, { status: 'running', lastOutputAt: Date.now() })
      win?.webContents.send(Channels.EventPtyData, { agentId, data })
    })
    this.pty.on('exit', ({ agentId, exitCode }) => {
      this.alerts.onExit(agentId, exitCode ?? -1)
    })
    this.alerts.on('idle', ({ agentId }) => {
      this.setState(agentId, { status: 'idle', alert: 'attention' })
    })
    this.alerts.on('exit', ({ agentId, exitCode }) => {
      const patch = exitCode === 0
        ? { status: 'exited' as const, alert: 'normal' as const, exitCode }
        : { status: 'error' as const, alert: 'error' as const, exitCode }
      this.setState(agentId, patch)
    })
  }

  private setState(agentId: string, patch: Partial<AgentState>): void {
    const prev = this.states.get(agentId) ?? {
      agentId, status: 'spawning' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const
    }
    const next = { ...prev, ...patch, agentId }
    this.states.set(agentId, next)
    win?.webContents.send(Channels.EventAgentState, { agentId, state: next })
  }

  private findWorkspaceByAgent(agentId: string): Workspace | undefined {
    return this.workspaces.list().map(s => this.workspaces.get(s.projectPath))
      .find(w => w && w.agents.some(a => a.id === agentId))
  }

  private runtimeFor(workspace: Workspace): WorkspaceRuntime {
    return {
      workspace,
      agents: workspace.agents.map(a => this.states.get(a.id) ?? {
        agentId: a.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
      }),
      git: null
    }
  }

  async startAgent(agentId: string): Promise<void> {
    const ws = this.findWorkspaceByAgent(agentId)
    const agent = ws?.agents.find(a => a.id === agentId)
    if (!agent) return
    const tmpl = this.templates.list().find(t => t.id === agent.templateId)
    if (!tmpl) {
      this.setState(agentId, { status: 'error', alert: 'error' })
      return
    }
    this.setState(agentId, { status: 'spawning', exitCode: null, alert: 'normal' })
    try {
      this.pty.start(agentId, agent.name, tmpl.command, tmpl.args, agent.cwd)
    } catch {
      this.setState(agentId, { status: 'error', alert: 'error' })
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    await this.pty.stop(agentId)
    this.setState(agentId, { status: 'stopped', alert: 'normal' })
  }

  async restartAgent(agentId: string): Promise<void> {
    await this.pty.stop(agentId)
    await this.startAgent(agentId)
  }

  async openWorkspace(projectPath: string): Promise<WorkspaceRuntime> {
    const ws = this.workspaces.get(projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    if (this.activeProject && this.activeProject !== projectPath) {
      await this.pty.stopAll()
      this.states.clear()
    }
    this.activeProject = projectPath
    for (const agent of ws.agents) {
      await this.startAgent(agent.id)
    }
    this.startGitPoll(projectPath)
    return this.runtimeFor(ws)
  }

  private startGitPoll(projectPath: string): void {
    if (this.gitTimer) clearInterval(this.gitTimer)
    const poll = async () => {
      const git = await this.git.get(projectPath)
      win?.webContents.send(Channels.EventGitStatus, { projectPath, git })
    }
    void poll()
    this.gitTimer = setInterval(() => void poll(), 5000)
  }

  stopGitPoll(): void {
    if (this.gitTimer) {
      clearInterval(this.gitTimer)
      this.gitTimer = null
    }
  }
}

const mainApp = new MainApp()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Meow Coding',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => {
    win = null
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle(Channels.WorkspaceList, () => mainApp.workspaces.list())

  ipcMain.handle(Channels.WorkspaceAdd, (_e, projectPath: string, name: string) => {
    const ws = mainApp.workspaces.add(projectPath, name)
    return mainApp.runtimeFor(ws)
  })

  ipcMain.handle(Channels.WorkspaceRemove, async (_e, projectPath: string) => {
    const ws = mainApp.workspaces.get(projectPath)
    if (ws) {
      for (const agent of ws.agents) {
        await mainApp.pty.stop(agent.id)
      }
    }
    mainApp.workspaces.remove(projectPath)
  })

  ipcMain.handle(Channels.WorkspaceOpen, (_e, projectPath: string) =>
    mainApp.openWorkspace(projectPath))

  ipcMain.handle(Channels.AgentAdd, async (_e, projectPath: string, input: NewAgentInput) => {
    const ws = mainApp.workspaces.addAgent(projectPath, input)
    const added = ws.agents[ws.agents.length - 1]
    await mainApp.startAgent(added.id)
    return mainApp.runtimeFor(ws)
  })

  ipcMain.handle(Channels.AgentRemove, async (_e, projectPath: string, agentId: string) => {
    await mainApp.pty.stop(agentId)
    mainApp.workspaces.removeAgent(projectPath, agentId)
  })

  ipcMain.handle(Channels.TemplateList, () => mainApp.templates.list())
  ipcMain.handle(Channels.TemplateSave, (_e, t: Template) => mainApp.templates.save(t))
  ipcMain.handle(Channels.TemplateRemove, (_e, id: string) => mainApp.templates.remove(id))

  ipcMain.handle(Channels.PickFolder, async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(Channels.PtyStart, (_e, agentId: string) => mainApp.startAgent(agentId))
  ipcMain.handle(Channels.PtyStop, (_e, agentId: string) => mainApp.stopAgent(agentId))
  ipcMain.handle(Channels.PtyRestart, (_e, agentId: string) => mainApp.restartAgent(agentId))
  ipcMain.handle(Channels.PtyInput, (_e, agentId: string, data: string) => {
    mainApp.pty.write(agentId, data)
  })
  ipcMain.handle(Channels.PtyInject, (_e, agentId: string, text: string) => {
    mainApp.pty.write(agentId, text + '\n')
  })
  ipcMain.handle(Channels.LogPath, (_e, agentId: string) => mainApp.logs.pathFor(agentId))
  ipcMain.handle(Channels.LogOpen, (_e, agentId: string) => {
    void shell.openPath(mainApp.logs.pathFor(agentId))
  })
  ipcMain.handle(Channels.AppQuit, () => app.quit())
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cleaningUp = false
app.on('before-quit', (event) => {
  if (cleaningUp) return
  event.preventDefault()
  cleaningUp = true
  mainApp.stopGitPoll()
  mainApp.pty
    .stopAll()
    .finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: Bổ sung import `NewAgentInput` vào `src/main/index.ts`**

Sửa dòng import type ở đầu file:
```ts
import type { AgentState, NewAgentInput, Template, Workspace, WorkspaceRuntime } from '../shared/types'
```

- [ ] **Step 3: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Chạy app xác nhận mở không lỗi**

Run: `npm run dev`
Expected: cửa sổ mở. (UI chưa có API nên chưa thao tác được; chỉ kiểm tra main process khởi động.)

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: main process wiring and ipc handlers"
```

---

## Task 10: Preload bridge (expose window.api)

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Thay nội dung `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/ipc'
import type {
  AgentApi, AgentStateEvent, GitStatusEvent, NewAgentInput, PtyDataEvent, Template
} from '../shared/ipc'

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AgentApi = {
  listWorkspaces: () => ipcRenderer.invoke(Channels.WorkspaceList),
  addWorkspace: (projectPath: string, name: string) =>
    ipcRenderer.invoke(Channels.WorkspaceAdd, projectPath, name),
  removeWorkspace: (projectPath: string) =>
    ipcRenderer.invoke(Channels.WorkspaceRemove, projectPath),
  openWorkspace: (projectPath: string) =>
    ipcRenderer.invoke(Channels.WorkspaceOpen, projectPath),
  addAgent: (projectPath: string, input: NewAgentInput) =>
    ipcRenderer.invoke(Channels.AgentAdd, projectPath, input),
  removeAgent: (projectPath: string, agentId: string) =>
    ipcRenderer.invoke(Channels.AgentRemove, projectPath, agentId),
  listTemplates: () => ipcRenderer.invoke(Channels.TemplateList),
  saveTemplate: (template: Template) => ipcRenderer.invoke(Channels.TemplateSave, template),
  removeTemplate: (id: string) => ipcRenderer.invoke(Channels.TemplateRemove, id),
  pickFolder: () => ipcRenderer.invoke(Channels.PickFolder),
  startAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyStart, agentId),
  stopAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyStop, agentId),
  restartAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyRestart, agentId),
  writeInput: (agentId: string, data: string) =>
    ipcRenderer.invoke(Channels.PtyInput, agentId, data),
  injectPrompt: (agentId: string, text: string) =>
    ipcRenderer.invoke(Channels.PtyInject, agentId, text),
  openLog: (agentId: string) => ipcRenderer.invoke(Channels.LogOpen, agentId),
  getLogPath: (agentId: string) => ipcRenderer.invoke(Channels.LogPath, agentId),
  quit: () => ipcRenderer.invoke(Channels.AppQuit),
  onPtyData: (cb: (e: PtyDataEvent) => void) => subscribe(Channels.EventPtyData, cb),
  onAgentState: (cb: (e: AgentStateEvent) => void) => subscribe(Channels.EventAgentState, cb),
  onGitStatus: (cb: (e: GitStatusEvent) => void) => subscribe(Channels.EventGitStatus, cb)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 2: Tạo global type cho renderer**

`src/renderer/src/env.d.ts`:

```ts
import type { AgentApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: AgentApi
  }
}
export {}
```

- [ ] **Step 3: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: preload api bridge"
```

---

## Task 11: Renderer App shell (state, subscriptions, layout)

**Files:**
- Create: `src/renderer/src/App.tsx` (thay bản tối thiểu)
- Create: `src/renderer/src/components/EmptyState.tsx`

- [ ] **Step 1: Thêm `isRunning` vào `PtyManager`**

Trong `src/main/pty-manager.ts`, thêm method:

```ts
  isRunning(agentId: string): boolean {
    return this.sessions.has(agentId)
  }
```

- [ ] **Step 2: Làm `startAgent` idempotent trong `src/main/index.ts`**

Sửa đầu method `startAgent` trong class `MainApp`:

```ts
  async startAgent(agentId: string): Promise<void> {
    if (this.pty.isRunning(agentId)) return
    const ws = this.findWorkspaceByAgent(agentId)
```

- [ ] **Step 3: Tạo `src/renderer/src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type {
  AgentConfig, AgentState, GitStatus, Template, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import PaneGrid from './components/PaneGrid'
import EmptyState from './components/EmptyState'

export interface PaneModel {
  agent: AgentConfig
  state: AgentState
  git: GitStatus | null
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null)
  const termsRef = useRef<Map<string, Terminal>>(new Map())
  const buffersRef = useRef<Map<string, string>>(new Map())

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
    void window.api.listTemplates().then(setTemplates)
  }, [refreshWorkspaces])

  useEffect(() => {
    const offData = window.api.onPtyData(({ agentId, data }) => {
      const term = termsRef.current.get(agentId)
      if (term) {
        term.write(data)
      } else {
        buffersRef.current.set(agentId, (buffersRef.current.get(agentId) ?? '') + data)
      }
    })
    const offState = window.api.onAgentState(({ agentId, state }) => {
      setRuntime(prev => prev
        ? { ...prev, agents: prev.agents.map(a => (a.agentId === agentId ? state : a)) }
        : prev)
    })
    const offGit = window.api.onGitStatus(({ projectPath, git }) => {
      setRuntime(prev => prev && prev.workspace.projectPath === projectPath
        ? { ...prev, git }
        : prev)
    })
    return () => {
      offData()
      offState()
      offGit()
    }
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    setRuntime(await window.api.openWorkspace(path))
  }, [])

  const registerTerminal = useCallback((agentId: string, term: Terminal) => {
    termsRef.current.set(agentId, term)
    const buf = buffersRef.current.get(agentId)
    if (buf) {
      term.write(buf)
      buffersRef.current.delete(agentId)
    }
  }, [])

  const unregisterTerminal = useCallback((agentId: string) => {
    termsRef.current.delete(agentId)
    buffersRef.current.delete(agentId)
  }, [])

  const panes: PaneModel[] = useMemo(() => {
    if (!runtime) return []
    return runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    }))
  }, [runtime])

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        templates={templates}
        activePath={runtime?.workspace.projectPath ?? null}
        onOpen={openWorkspace}
        onRefresh={refreshWorkspaces}
        onTemplatesChange={setTemplates}
      />
      <main className="main">
        {panes.length > 0 ? (
          <PaneGrid
            panes={panes}
            onRegisterTerminal={registerTerminal}
            onUnregisterTerminal={unregisterTerminal}
          />
        ) : (
          <EmptyState hasWorkspace={runtime !== null} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Tạo `src/renderer/src/components/EmptyState.tsx`**

```tsx
interface Props {
  hasWorkspace: boolean
}

export default function EmptyState({ hasWorkspace }: Props) {
  return (
    <div className="empty-state">
      {hasWorkspace
        ? <p className="subtitle">Workspace đang mở nhưng chưa có agent. Dùng "+ Agent" trong sidebar.</p>
        : <p className="subtitle">Chọn một project ở sidebar, hoặc thêm project mới để bắt đầu.</p>}
    </div>
  )
}
```

- [ ] **Step 5: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/pty-manager.ts src/main/index.ts src/renderer/src/App.tsx src/renderer/src/components/EmptyState.tsx
git commit -m "feat: renderer app shell with event subscriptions"
```

---

## Task 12: XtermHost + Pane + PaneHeader

**Files:**
- Create: `src/renderer/src/components/XtermHost.tsx`
- Create: `src/renderer/src/components/PaneHeader.tsx`
- Create: `src/renderer/src/components/Pane.tsx`

- [ ] **Step 1: Tạo `src/renderer/src/components/XtermHost.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  agentId: string
  onReady: (term: Terminal) => void
  onDispose: (agentId: string) => void
  onInput: (data: string) => void
}

export default function XtermHost({ agentId, onReady, onDispose, onInput }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#e5e5e5'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    term.onData(d => onInput(d))
    onReady(term)
    fit.fit()

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* layout may be mid-change */
      }
    })
    ro.observe(ref.current!)

    return () => {
      ro.disconnect()
      term.dispose()
      onDispose(agentId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="xterm-host" ref={ref} />
}
```

- [ ] **Step 2: Tạo `src/renderer/src/components/PaneHeader.tsx`**

```tsx
import { useState } from 'react'
import type { AgentState, GitStatus } from '@shared/types'

interface Props {
  name: string
  state: AgentState
  git: GitStatus | null
  zoomed: boolean
  onZoom: () => void
  onStop: () => void
  onRestart: () => void
  onInject: (text: string) => void
  onOpenLog: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

export default function PaneHeader({
  name, state, git, zoomed, onZoom, onStop, onRestart, onInject, onOpenLog
}: Props) {
  const [injecting, setInjecting] = useState(false)
  const [prompt, setPrompt] = useState('')

  const submitInject = () => {
    const text = prompt.trim()
    if (text) onInject(text)
    setPrompt('')
    setInjecting(false)
  }

  return (
    <div className={`pane-header alert-${state.alert}`}>
      <span className={`status-dot status-${state.status}`} />
      <span className="pane-title">{name}</span>
      <span className="pane-status">{STATUS_LABEL[state.status]}
        {state.exitCode !== null && ` (${state.exitCode})`}
      </span>
      <span className="pane-git">
        {git ? (git.branch ? `${git.branch} ` : '') + (git.dirtyCount > 0 ? `\u25cf ${git.dirtyCount}` : '') : '--'}
      </span>
      <span className="pane-actions">
        {injecting && (
          <input
            className="inject-input"
            autoFocus
            placeholder="prompt..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitInject()
              if (e.key === 'Escape') setInjecting(false)
            }}
          />
        )}
        <button title="inject prompt" onClick={() => setInjecting(v => !v)}>inject</button>
        <button title="stop" onClick={onStop}>stop</button>
        <button title="restart" onClick={onRestart}>restart</button>
        <button title="open log" onClick={onOpenLog}>log</button>
        <button title={zoomed ? 'back to grid' : 'zoom'} onClick={onZoom}>
          {zoomed ? 'exit' : 'zoom'}
        </button>
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Tạo `src/renderer/src/components/Pane.tsx`**

```tsx
import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import XtermHost from './XtermHost'
import PaneHeader from './PaneHeader'

interface Props {
  pane: PaneModel
  zoomed: boolean
  onZoom: () => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function Pane({
  pane, zoomed, onZoom, onRegisterTerminal, onUnregisterTerminal
}: Props) {
  const id = pane.agent.id
  const write = (data: string) => void window.api.writeInput(id, data)

  return (
    <div className={`pane ${zoomed ? 'zoomed' : ''}`}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        git={pane.git}
        zoomed={zoomed}
        onZoom={onZoom}
        onStop={() => void window.api.stopAgent(id)}
        onRestart={() => void window.api.restartAgent(id)}
        onInject={text => void window.api.injectPrompt(id, text)}
        onOpenLog={() => void window.api.openLog(id)}
      />
      <XtermHost
        agentId={id}
        onReady={term => onRegisterTerminal(id, term)}
        onDispose={onUnregisterTerminal}
        onInput={write}
      />
    </div>
  )
}
```

- [ ] **Step 4: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/XtermHost.tsx src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/Pane.tsx
git commit -m "feat: xterm pane with header and actions"
```

---

## Task 13: PaneGrid + zoom

**Files:**
- Create: `src/renderer/src/components/PaneGrid.tsx`

- [ ] **Step 1: Tạo `src/renderer/src/components/PaneGrid.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneGrid({ panes, onRegisterTerminal, onUnregisterTerminal }: Props) {
  const [zoomedId, setZoomedId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const zoomed = panes.find(p => p.agent.id === zoomedId) ?? null

  if (zoomed) {
    return (
      <div className="pane-zoom">
        <Pane
          pane={zoomed}
          zoomed
          onZoom={() => setZoomedId(null)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      </div>
    )
  }

  const columns = panes.length > 1 ? 2 : 1

  return (
    <div className="pane-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {panes.map(pane => (
        <Pane
          key={pane.agent.id}
          pane={pane}
          zoomed={false}
          onZoom={() => setZoomedId(pane.agent.id)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/PaneGrid.tsx
git commit -m "feat: pane grid with zoom"
```

---

## Task 14: Sidebar + dialogs + templates panel

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/components/AddProjectDialog.tsx`
- Create: `src/renderer/src/components/AddAgentDialog.tsx`
- Create: `src/renderer/src/components/TemplatesPanel.tsx`

- [ ] **Step 1: Tạo `src/renderer/src/components/AddProjectDialog.tsx`**

```tsx
import { useState } from 'react'

interface Props {
  onAdd: (projectPath: string, name: string) => void
  onClose: () => void
}

export default function AddProjectDialog({ onAdd, onClose }: Props) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')

  const pick = async () => {
    const folder = await window.api.pickFolder()
    if (folder) {
      setPath(folder)
      if (!name) setName(folder.split(/[\\/]/).pop() ?? folder)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Add project</h3>
        <label className="label">Folder</label>
        <div className="row">
          <input className="input grow" value={path} onChange={e => setPath(e.target.value)} />
          <button className="btn" onClick={() => void pick()}>browse</button>
        </div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!path || !name} onClick={() => onAdd(path, name)}>
            add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Tạo `src/renderer/src/components/AddAgentDialog.tsx`**

```tsx
import { useState } from 'react'
import type { NewAgentInput, Template } from '@shared/types'

interface Props {
  projectPath: string
  templates: Template[]
  onAdd: (input: NewAgentInput) => void
  onClose: () => void
}

export default function AddAgentDialog({ projectPath, templates, onAdd, onClose }: Props) {
  const [name, setName] = useState(templates[0]?.name ?? 'agent')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [cwd, setCwd] = useState(projectPath)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Add agent</h3>
        <label className="label">Template</label>
        <select className="input" value={templateId}
          onChange={e => {
            setTemplateId(e.target.value)
            const t = templates.find(x => x.id === e.target.value)
            if (t) setName(t.name)
          }}>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
        <label className="label">Working directory</label>
        <input className="input" value={cwd} onChange={e => setCwd(e.target.value)} />
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!name || !templateId || !cwd}
            onClick={() => onAdd({ name, templateId, cwd })}>
            add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Tạo `src/renderer/src/components/TemplatesPanel.tsx`**

```tsx
import { useState } from 'react'
import type { Template } from '@shared/types'

interface Props {
  templates: Template[]
  onChange: (templates: Template[]) => void
}

export default function TemplatesPanel({ templates, onChange }: Props) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')

  const add = async () => {
    if (!name || !command) return
    const argsList = args.split(',').map(s => s.trim()).filter(Boolean)
    await window.api.saveTemplate({ id: '', name, command, args: argsList })
    setName('')
    setCommand('')
    setArgs('')
    onChange(await window.api.listTemplates())
  }

  const remove = async (id: string) => {
    await window.api.removeTemplate(id)
    onChange(await window.api.listTemplates())
  }

  return (
    <div className="templates-panel">
      <div className="panel-head">
        <span className="panel-title">Templates</span>
      </div>
      <div className="template-form">
        <input className="input" placeholder="name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="command" value={command} onChange={e => setCommand(e.target.value)} />
        <input className="input" placeholder="args (comma separated)" value={args} onChange={e => setArgs(e.target.value)} />
        <button className="btn" onClick={() => void add()} disabled={!name || !command}>add</button>
      </div>
      <ul className="template-list">
        {templates.map(t => (
          <li key={t.id}>
            <span>{t.name}</span>
            <code>{t.command} {t.args.join(' ')}</code>
            <button className="btn small" onClick={() => void remove(t.id)}>remove</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Tạo `src/renderer/src/components/Sidebar.tsx`**

```tsx
import { useState } from 'react'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'
import TemplatesPanel from './TemplatesPanel'

interface Props {
  workspaces: WorkspaceSummary[]
  templates: Template[]
  activePath: string | null
  onOpen: (path: string) => void
  onRefresh: () => void
  onTemplatesChange: (templates: Template[]) => void
}

export default function Sidebar({
  workspaces, templates, activePath, onOpen, onRefresh, onTemplatesChange
}: Props) {
  const [showAddProject, setShowAddProject] = useState(false)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const handleAddProject = async (projectPath: string, name: string) => {
    await window.api.addWorkspace(projectPath, name)
    setShowAddProject(false)
    onRefresh()
    onOpen(projectPath)
  }

  const handleRemoveProject = async (projectPath: string) => {
    await window.api.removeWorkspace(projectPath)
    onRefresh()
  }

  const handleAddAgent = async (input: NewAgentInput) => {
    if (!activePath) return
    await window.api.addAgent(activePath, input)
    setShowAddAgent(false)
    onOpen(activePath)
  }

  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span className="panel-title">Projects</span>
        <button className="btn small" onClick={() => setShowAddProject(true)}>+ project</button>
        <button className="btn small" onClick={() => setShowTemplates(v => !v)}>templates</button>
      </div>
      <ul className="project-list">
        {workspaces.map(ws => (
          <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
            <div className="project-row" onClick={() => onOpen(ws.projectPath)}>
              <span className="project-name">{ws.name}</span>
              <span className="project-count">{ws.agentCount}</span>
              <button className="btn small" onClick={e => {
                e.stopPropagation()
                void handleRemoveProject(ws.projectPath)
              }}>x</button>
            </div>
          </li>
        ))}
      </ul>
      {activePath && (
        <button className="btn" onClick={() => setShowAddAgent(true)}>+ agent</button>
      )}
      {showTemplates && <TemplatesPanel templates={templates} onChange={onTemplatesChange} />}
      {showAddProject && (
        <AddProjectDialog onAdd={(p, n) => void handleAddProject(p, n)} onClose={() => setShowAddProject(false)} />
      )}
      {showAddAgent && activePath && (
        <AddAgentDialog
          projectPath={activePath}
          templates={templates}
          onAdd={input => void handleAddAgent(input)}
          onClose={() => setShowAddAgent(false)}
        />
      )}
    </aside>
  )
}
```

Lưu ý: sau khi `addAgent`, Sidebar gọi `onOpen(activePath)` để reload runtime; vì `openWorkspace` skip agent đang chạy (Task 11 Step 2) nên thao tác này idempotent, không restart lại các agent khác.

- [ ] **Step 5: Chạy typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components
git commit -m "feat: sidebar, dialogs, templates panel"
```

---

## Task 15: CSS hoàn chỉnh + kiểm tra thủ công

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Thay toàn bộ nội dung `src/renderer/src/styles.css`**

```css
:root {
  --bg: #1e1e1e;
  --bg-panel: #252526;
  --bg-hover: #2a2d2e;
  --border: #3c3c3c;
  --text: #d4d4d4;
  --text-dim: #9d9d9d;
  --accent: #3794ff;
  --green: #4ec9b0;
  --yellow: #dcdcaa;
  --red: #f48771;
  --font-mono: 'Cascadia Mono', 'Fira Code', Consolas, 'Courier New', monospace;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  overflow: hidden;
  user-select: none;
}
button { font-family: var(--font-mono); }
.app { height: 100%; display: flex; }
.main { flex: 1; display: flex; min-width: 0; }

/* Sidebar */
.sidebar {
  width: 260px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  overflow-y: auto;
}
.panel-head { display: flex; align-items: center; gap: 6px; }
.panel-title { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; color: var(--text-dim); flex: 1; }
.project-list { list-style: none; margin: 0; padding: 0; }
.project-list li { border-radius: 4px; }
.project-list li.active { background: var(--bg-hover); }
.project-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; border-radius: 4px; }
.project-row:hover { background: var(--bg-hover); }
.project-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-count { color: var(--text-dim); font-size: 11px; }

/* Buttons & inputs */
.btn {
  background: #3c3c3c;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;
}
.btn:hover { background: #4a4a4a; }
.btn.small { padding: 1px 6px; font-size: 11px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn:disabled { opacity: 0.5; cursor: default; }
.input {
  background: #1e1e1e;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.input.grow { flex: 1; min-width: 0; }
select.input { width: 100%; }
.row { display: flex; gap: 6px; }

/* Grid & panes */
.pane-grid {
  flex: 1;
  display: grid;
  grid-auto-rows: 1fr;
  gap: 4px;
  padding: 4px;
  min-width: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: #1e1e1e;
  min-height: 0;
  min-width: 0;
}
.pane-zoom { flex: 1; display: flex; padding: 4px; }
.pane.zoomed { flex: 1; }
.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  height: 28px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.pane-header.alert-attention { border-bottom-color: var(--yellow); }
.pane-header.alert-error { border-bottom-color: var(--red); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
.status-dot.status-running { background: var(--green); }
.status-dot.status-idle { background: var(--yellow); }
.status-dot.status-exited, .status-dot.status-stopped { background: var(--text-dim); }
.status-dot.status-error { background: var(--red); }
.pane-title { font-weight: 700; white-space: nowrap; }
.pane-status { color: var(--text-dim); white-space: nowrap; }
.pane-git { color: var(--text-dim); white-space: nowrap; }
.pane-actions { margin-left: auto; display: flex; gap: 4px; align-items: center; }
.inject-input { width: 180px; }
.xterm-host { flex: 1; min-height: 0; }
.xterm-host .xterm { height: 100%; }

/* Dialogs */
.dialog-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
}
.dialog {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  width: 420px;
  display: flex; flex-direction: column; gap: 8px;
}
.dialog h3 { margin: 0; }
.label { font-size: 11px; text-transform: uppercase; color: var(--text-dim); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* Templates panel */
.templates-panel { border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.template-form { display: flex; flex-direction: column; gap: 4px; }
.template-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.template-list li { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.template-list code { color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Empty state */
.empty-state { flex: 1; display: flex; align-items: center; justify-content: center; }
.subtitle { color: var(--text-dim); }
```

- [ ] **Step 2: Chạy app và kiểm tra thủ công**

Run: `npm run dev`
Kiểm tra:
1. Mở app, sidebar trống, main hiện empty state.
2. `+ project` → browse chọn 1 folder có git → project xuất hiện sidebar, mở ra, pane xterm hiện.
3. `+ agent` → chọn template opencode → agent spawn, output hiện trong pane.
4. Gõ vào pane → agent nhận input (nếu agent là CLI tương tác).
5. Nút stop/restart/log/zoom hoạt động; Esc thoát zoom.
6. Badge git hiện branch + số file dirty.
7. Đóng app → mở Task Manager, xác nhận không còn process `opencode`/`claude` sót lại.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "feat: full dark coding theme styles"
```

---

## Task 16: Playwright E2E smoke test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Tạo `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  retries: 0
})
```

- [ ] **Step 2: Tạo `tests/e2e/smoke.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows the main window', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window).toHaveTitle(/Meow Coding/)
  await expect(window.locator('.sidebar')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 3: Build và rebuild native module cho Electron ABI**

Run:
```bash
npm run build
npx @electron/rebuild -f -w @lydell/node-pty
```

- [ ] **Step 4: Chạy E2E**

Run: `npm run e2e`
Expected: PASS — app mở, title đúng, sidebar hiển thị.

Ghi chú: E2E cần `npm run build` trước (out/ phải tồn tại). Nếu chạy lần đầu bị lỗi native module, chạy lại `npx @electron/rebuild -f -w @lydell/node-pty` rồi thử lại. (Electron dev của `electron-vite dev` cũng cần bước rebuild này một lần.)

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: playwright e2e smoke"
```

---

## Task 17: Verification cuối

**Files:**
- Create: `README.md`

- [ ] **Step 1: Tạo `README.md`**

```markdown
# Meow Coding

Desktop app quản lý nhiều CLI coding agent (opencode, Claude Code, aider, ...) trong các
pane terminal song song trên một cửa sổ.

## Yêu cầu

- Node.js 20+
- Git
- Các CLI agent bạn muốn chạy đã có trong `PATH` (VD: `opencode`, `claude`)

## Chạy dev

```bash
npm install
npx @electron/rebuild -f -w @lydell/node-pty
npm run dev
```

## Cách dùng

1. `+ project` → chọn folder project (có git) → mở workspace.
2. `+ agent` → chọn template (hoặc thêm template riêng trong `templates`) → agent spawn trong pane.
3. Gõ trực tiếp vào pane để tương tác; dùng `stop` / `restart` / `inject` / `log` / `zoom` trên header pane.
4. Badge mỗi pane hiển thị trạng thái + branch git + số file dirty.

## Kiểm thử

```bash
npm test          # unit + integration (Vitest)
npm run typecheck
npm run build && npm run e2e   # Playwright smoke
```

## Lưu ý

- Đóng app sẽ kill toàn bộ agent (kể cả process con).
- Log mỗi agent nằm trong thư mục `userData/logs/`.
- Workspace + template lưu trong `userData/*.json`.
```

- [ ] **Step 2: Chạy toàn bộ kiểm thử**

Run:
```bash
npm test
npm run typecheck
```
Expected: toàn bộ PASS.

- [ ] **Step 3: Kiểm tra git sạch và chốt**

Run: `git status`
Expected: không có file chưa commit ngoài các commit của plan. Tạo 1 commit cuối:
```bash
git add README.md
git commit -m "docs: quickstart readme"
```

---

## Self-Review (thực hiện trước khi bắt đầu implement)

**1. Spec coverage:**
- Desktop app Electron: Task 1 ✓
- Generic template: Task 3 (TemplateManager) + Task 14 (TemplatesPanel) ✓
- PTY nhúng + input trực tiếp: Task 8 (PtyManager) + Task 12 (XtermHost/Pane) ✓
- Quick actions stop/restart/inject: Task 12 (PaneHeader) + Task 9 (IPC handlers) ✓
- Grid + zoom: Task 13 (PaneGrid) ✓
- Sidebar đa project + workspace: Task 4 (WorkspaceStore) + Task 14 (Sidebar) ✓
- Kill hết khi đóng: Task 9 (before-quit) ✓
- Git status badge: Task 6 (GitStatusService) + Task 12 (PaneHeader) ✓
- Trạng thái agent: Task 11 (App state) + Task 12 (status dot) ✓
- Cảnh báo idle/exit/fail: Task 7 (AlertService) + Task 9 (wiring) ✓
- Log lịch sử: Task 5 (LogManager) + Task 12 (log button) ✓

**2. Placeholder scan:** Không có TBD/TODO trong các task; mọi bước code đều có nội dung đầy đủ.

**3. Type consistency:**
- `NewAgentInput` định nghĩa ở Task 2, dùng ở Task 4/9/14 — khớp.
- `Channels.*` định nghĩa Task 2, dùng ở Task 9/10 — khớp.
- `AgentState`, `GitStatus`, `WorkspaceRuntime`, `WorkspaceSummary`, `Template` — nhất quán xuyên plan.
- `PtyManager.isRunning` thêm ở Task 11, dùng ở `startAgent` cùng task — khớp.
- `PaneModel` export từ `App.tsx` (Task 11), import ở Pane/PaneGrid (Task 12/13) — khớp.

**4. Rủi ro cần lưu ý khi implement:**
- Native module `@lydell/node-pty` cần rebuild theo Electron ABI (`npx @electron/rebuild`) — đã ghi ở Task 8/16.
- E2E Playwright dễ flaky trên Windows; nếu lỗi môi trường, có thể chạy tay qua `npm run dev` (Task 15 Step 2) như phương án kiểm tra thay thế.
- `git init` tạo branch `master` hay `main` tùy bản git — test Task 6 Step 4 đã có ghi chú điều chỉnh.




