# Meow UI/UX Prototype Designer (Figma Make style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prototype-design workspace in Meow Coding where a BA chats with a design-oriented agent to generate a real React+Vite multi-screen prototype (with mock data), previews it live via a Vite dev server, and promotes it into a dev agent's context to build the real frontend.

**Architecture:** A second Electron BrowserWindow loads the same renderer with `?view=prototype`; a new `design` agent kind (extending `MeowAgentManager`) writes a scaffolded React+Vite app into `<project>/docs/uiux-design/<name>/`; a `PrototypePreviewServer` spawns Vite to serve it in an `<iframe>` (and optionally in an external browser). IPC contract (`Channels`/`AgentApi`) is extended symmetrically across main/preload/renderer.

**Tech Stack:** Electron 41, React 19, Vite 7, TypeScript strict, `node:child_process`, `tree-kill`, Vitest.

---

## File Map

- Modify: `src/shared/types.ts` — `AgentKind` thêm `'design'`, `PrototypeInfo`, `PrototypeRuntime`, `PrototypePreviewEvent`.
- Modify: `src/shared/ipc.ts` — `Channels` + `AgentApi` methods for prototype.
- Modify: `src/main/default-templates.ts` — template "Design Prototype".
- Modify: `src/main/meow-agent-manager.ts` — register design kind, design system prompt + design skills dir.
- Modify: `src/main/agent/skill.ts` — `collectSkills` nhận thêm extra dir.
- Create: `src/main/prototype-scaffold.ts` — tạo cấu trúc React+Vite.
- Create: `src/main/prototype-preview-server.ts` — quản lý Vite dev server + static HTTP server.
- Modify: `src/main/index.ts` — prototype window, IPC handlers, preview server wiring.
- Modify: `src/preload/index.ts` — expose prototype methods.
- Modify: `src/renderer/src/main.tsx` — route `?view=prototype`.
- Modify: `src/renderer/src/App.tsx` — filter design agents out of main pane grid.
- Create: `src/renderer/src/components/prototype/PrototypeWindow.tsx`.
- Create: `src/renderer/src/components/prototype/PreviewPanel.tsx`.
- Modify: `src/renderer/src/components/Sidebar.tsx` — "Prototype Studio" menu entry.
- Modify: `src/renderer/src/styles.css` — prototype layout.
- Modify: `tests/unit/ipc-contract.test.ts`.
- Create: `tests/unit/prototype-scaffold.test.ts`.
- Create: `tests/unit/prototype-preview-server.test.ts`.
- Modify: `tests/e2e/smoke.spec.ts` — smoke mở prototype window.
- Modify: `package.json` — `design-skills` extraResource (nếu có).

---

### Task 1: Shared types — AgentKind `design` + prototype types

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Write the failing type assertions**

Thêm vào `tests/unit/ipc-contract.test.ts` (đầu test file, phần import) và 1 test mới:

```ts
import type { AgentConfig, ChatMessage, MeowSettings, PrototypeInfo, PrototypeRuntime, PrototypePreviewEvent } from '../../src/shared/types'
```

Cuối file (sau test 'types settings payloads...'), thêm:

```ts
  it('types prototype payloads without runtime error', () => {
    const info: PrototypeInfo = { name: 'checkout', path: '/p/docs/uiux-design/checkout', agentId: 'a1' }
    const rt: PrototypeRuntime = { prototype: info, previewUrl: 'http://localhost:5173/' }
    const evt: PrototypePreviewEvent = { name: 'checkout', url: 'http://localhost:5173/' }
    expect(info.path.endsWith('checkout')).toBe(true)
    expect(rt.previewUrl).toBe('http://localhost:5173/')
    expect(evt.name).toBe('checkout')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — `Cannot find name 'PrototypeInfo'` (types chưa tồn tại).

- [ ] **Step 3: Add types to `src/shared/types.ts`**

Đổi dòng `export type AgentKind = 'pty' | 'native'` thành:

```ts
export type AgentKind = 'pty' | 'native' | 'design'
```

Thêm các interface (cuối file, trước/giữa các type hiện có):

```ts
export interface PrototypeInfo {
  name: string
  path: string
  agentId: string
}

export interface PrototypeRuntime {
  prototype: PrototypeInfo
  previewUrl: string
}

export interface PrototypePreviewEvent {
  name: string
  url: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/unit/ipc-contract.test.ts
git commit -m "types: add design agent kind and prototype types"
```

---

### Task 2: IPC contract — prototype channels + AgentApi methods

**Files:**
- Modify: `src/shared/ipc.ts`
- Test: `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Write the failing tests**

Trong `tests/unit/ipc-contract.test.ts`, thêm các method vào mảng `required` (sau `'onContextChanged'`):

```ts
      'listPrototypes', 'createPrototype', 'openPrototype', 'closePrototype',
      'getPrototypePreviewUrl', 'openPrototypeInBrowser', 'promotePrototype',
      'openPrototypeWindow', 'onPrototypePreview'
```

Thêm vào stub `api` object (sau `onContextChanged`):

```ts
      listPrototypes: async () => [],
      createPrototype: async () => null,
      openPrototype: async () => null,
      closePrototype: async () => {},
      getPrototypePreviewUrl: async () => null,
      openPrototypeInBrowser: async () => null,
      promotePrototype: async () => false,
      openPrototypeWindow: async () => {},
      onPrototypePreview: () => () => {},
```

Thêm assertion trong test `'maps event channel names...'`:

```ts
    expect(Channels.PrototypeList).toBe('prototype:list')
    expect(Channels.PrototypeCreate).toBe('prototype:create')
    expect(Channels.PrototypeOpen).toBe('prototype:open')
    expect(Channels.PrototypeClose).toBe('prototype:close')
    expect(Channels.PrototypePreviewUrl).toBe('prototype:preview-url')
    expect(Channels.PrototypeOpenInBrowser).toBe('prototype:open-in-browser')
    expect(Channels.PrototypePromote).toBe('prototype:promote')
    expect(Channels.WindowOpenPrototype).toBe('window:open-prototype')
    expect(Channels.EventPrototypePreview).toBe('prototype:preview')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — thiếu method/channel (TS error hoặc assertion fail).

- [ ] **Step 3: Implement channels in `src/shared/ipc.ts`**

Trong object `Channels` (sau `WindowIsMaximized` / trước `EventWindowMaximizedChange`):

```ts
  PrototypeList: 'prototype:list',
  PrototypeCreate: 'prototype:create',
  PrototypeOpen: 'prototype:open',
  PrototypeClose: 'prototype:close',
  PrototypePreviewUrl: 'prototype:preview-url',
  PrototypeOpenInBrowser: 'prototype:open-in-browser',
  PrototypePromote: 'prototype:promote',
  WindowOpenPrototype: 'window:open-prototype',
  EventPrototypePreview: 'prototype:preview'
```

Thêm interface event (sau `WindowMaximizedChangeEvent`):

```ts
export interface PrototypePreviewEventPayload { name: string; url: string }
```

Thêm import `PrototypeInfo, PrototypeRuntime` vào dòng import types ở đầu file, và thêm vào `AgentApi` (sau `onContextChanged`):

```ts
  listPrototypes(): Promise<PrototypeInfo[]>
  createPrototype(name: string): Promise<PrototypeInfo | null>
  openPrototype(name: string): Promise<PrototypeRuntime | null>
  closePrototype(name: string): Promise<void>
  getPrototypePreviewUrl(name: string): Promise<string | null>
  openPrototypeInBrowser(name: string): Promise<string | null>
  promotePrototype(name: string): Promise<boolean>
  openPrototypeWindow(): Promise<void>
  onPrototypePreview(cb: (e: PrototypePreviewEventPayload) => void): () => void
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts tests/unit/ipc-contract.test.ts
git commit -m "ipc: prototype list/create/open/preview/promote channels"
```

---

### Task 3: Template "Design Prototype" + design skills dir option

**Files:**
- Modify: `src/main/default-templates.ts`
- Modify: `src/main/meow-agent-manager.ts`
- Modify: `src/main/agent/skill.ts`
- Test: `tests/unit/agent-skill.test.ts` (verify extra dir)

- [ ] **Step 1: Write the failing test for `collectSkills` extra dir**

Thêm vào `tests/unit/agent-skill.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
```

Trong file, thêm test:

```ts
  it('collects skills from an extra directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-skill-extra-'))
    try {
      const extra = path.join(root, 'extra')
      mkdirSync(path.join(extra, 'ui-ux-pro-max'), { recursive: true })
      writeFileSync(path.join(extra, 'ui-ux-pro-max', 'SKILL.md'),
        '---\nname: ui-ux-pro-max\ndescription: UI/UX guidance\n---\ncontent')
      const skills = collectSkills(path.join(root, 'cwd'), undefined, undefined, extra)
      expect(skills.some(s => s.name === 'ui-ux-pro-max')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-skill.test.ts`
Expected: FAIL — `Expected value to equal true` (extra dir chưa được quét) hoặc TS overload error.

- [ ] **Step 3: Implement `collectSkills` extra dirs**

Trong `src/main/agent/skill.ts`, đổi signature:

```ts
export function collectSkills(
  cwd: string,
  userSkillsDir?: string,
  builtinSkillsDir?: string,
  ...extraDirs: string[]
): Skill[] {
  const dirs = [path.join(cwd, '.meow', 'skills')]
  if (userSkillsDir) dirs.push(userSkillsDir)
  if (builtinSkillsDir) dirs.push(builtinSkillsDir)
  dirs.push(...extraDirs)
  ...
}
```

- [ ] **Step 4: Thêm template "Design Prototype"**

Trong `src/main/default-templates.ts`, thêm vào `DEFAULT_TEMPLATES`:

```ts
  { id: 'design-prototype', name: 'Design Prototype', command: '', args: [], kind: 'design' }
```

`command` rỗng vì design agent là native-style (không spawn PTY).

- [ ] **Step 5: MeowAgentManager nhận designSkillsDir**

Trong `src/main/meow-agent-manager.ts`:
- `MeowAgentManagerDeps` thêm field:

```ts
  designSkillsDir?: string
```

- Trong `register()`, đổi dòng collectSkills thành:

```ts
    const extraSkillDirs = agent.kind === 'design' && this.deps.designSkillsDir
      ? [this.deps.designSkillsDir]
      : []
    const skills = collectSkills(
      agent.cwd,
      this.deps.userSkillsDir,
      this.deps.builtinSkillsDir,
      ...extraSkillDirs
    )
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run tests/unit/agent-skill.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/default-templates.ts src/main/meow-agent-manager.ts src/main/agent/skill.ts tests/unit/agent-skill.test.ts
git commit -m "feat: design agent template and design skills dir"
```

---

### Task 4: Design system prompt + register design agent

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Xem cách test hiện có trong `tests/unit/meow-agent-manager.test.ts` để dựng manager ảo (mock store, tools trống). Thêm test:

```ts
  it('registers a design agent with the design prompt and design skills', () => {
    const deps = makeDeps() // helper hiện có, thêm designSkillsDir
    deps.designSkillsDir = '/design-skills'
    const manager = new MeowAgentManager(deps)
    manager.addAgent({
      id: 'd1', name: 'checkout', templateId: 'design-prototype', cwd: '/p/docs/uiux-design/checkout', kind: 'design'
    })
    expect(manager.isNative('d1')).toBe(true)
  })
```

Nếu test hiện có không có helper `makeDeps`, đọc file và tạo tối thiểu để `addAgent` không ném lỗi (dùng `store` giả, `tools` rỗng, `snapshots`, `savedPermissions` giả).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: FAIL — `isNative('d1')` false vì chỉ kind `native` được register.

- [ ] **Step 3: Register design agents**

Trong `src/main/meow-agent-manager.ts`:
- `init()`: đổi `if (agent.kind === 'native') this.register(agent)` → `if (agent.kind === 'native' || agent.kind === 'design') this.register(agent)`.
- `addAgent()`: đổi tương tự.

- [ ] **Step 4: Thêm design system prompt**

Tạo file `src/main/design-prompt.ts`:

```ts
export const DESIGN_SYSTEM_PROMPT =
  'You are a UI/UX design agent inside Meow Coding. You help Business Analysts prototype ' +
  'business flows and interfaces before real code is written. You generate a real React + Vite ' +
  'app (single-page, multi-screen) using react-router for navigation and mock data in src/data/mock.ts. ' +
  'Always work inside your working directory (the prototype folder under docs/uiux-design). ' +
  'Prefer clean, runnable TypeScript; reuse the ui-ux-pro-max skill for design decisions ' +
  '(layout, spacing, typography, color). Ask clarifying questions with the question tool when ' +
  'requirements are ambiguous. Do not build backend or real business logic — mock data only.'
```

Trong `register()`, sau khi có `resolved`, đổi `system:` line:

```ts
      system: (agent.kind === 'design' ? DESIGN_SYSTEM_PROMPT : resolved.systemPrompt) +
        modeNote + instructions + skillListText(skills),
```

Thêm import `import { DESIGN_SYSTEM_PROMPT } from './design-prompt'`.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts src/main/design-prompt.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat: register design agents with dedicated system prompt"
```

---

### Task 5: Prototype scaffold — tạo React+Vite app

**Files:**
- Create: `src/main/prototype-scaffold.ts`
- Test: `tests/unit/prototype-scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/prototype-scaffold.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPrototypeScaffold } from '../../src/main/prototype-scaffold'

describe('createPrototypeScaffold', () => {
  it('creates a React+Vite structure under docs/uiux-design/<name>', async () => {
    const project = mkdtempSync(path.join(tmpdir(), 'meow-proto-'))
    try {
      const dir = await createPrototypeScaffold(project, 'Checkout Flow', { skipInstall: true })
      expect(dir.endsWith(path.join('docs', 'uiux-design', 'checkout-flow'))).toBe(true)
      for (const f of ['package.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/data/mock.ts', 'PROTOTYPE.md']) {
        expect(existsSync(path.join(dir, f))).toBe(true)
      }
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'))
      expect(pkg.scripts.dev).toBe('vite')
      expect(pkg.dependencies.react).toBeTruthy()
      expect(pkg.dependencies['react-router-dom']).toBeTruthy()
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  it('rejects invalid names', async () => {
    const project = mkdtempSync(path.join(tmpdir(), 'meow-proto-'))
    try {
      await expect(createPrototypeScaffold(project, '..', { skipInstall: true })).rejects.toThrow()
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prototype-scaffold.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Implement scaffold**

```ts
// src/main/prototype-scaffold.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSpawnCommand } from './pty-manager'

export interface ScaffoldOptions {
  skipInstall?: boolean
}

export function safePrototypeName(name: string): string {
  const trimmed = name.trim().toLowerCase()
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug || slug === '.' || slug === '..' || slug.includes('..')) {
    throw new Error('Invalid prototype name')
  }
  return slug
}

export async function createPrototypeScaffold(
  projectPath: string,
  name: string,
  options: ScaffoldOptions = {}
): Promise<string> {
  const slug = safePrototypeName(name)
  const dir = path.join(projectPath, 'docs', 'uiux-design', slug)
  mkdirSync(path.join(dir, 'src', 'data'), { recursive: true })
  mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true })

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: `uiux-${slug}`,
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: {
      react: '^19.2.8',
      'react-dom': '^19.2.8',
      'react-router-dom': '^7.6.0'
    },
    devDependencies: {
      '@vitejs/plugin-react': '^5.2.0',
      typescript: '^5.9.0',
      vite: '^7.3.6'
    }
  }, null, 2))

  writeFileSync(path.join(dir, 'vite.config.ts'), [
    "import { defineConfig } from 'vite'",
    "import react from '@vitejs/plugin-react'",
    '',
    'export default defineConfig({',
    "  plugins: [react()],",
    "  server: { host: '127.0.0.1' }",
    '})',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'index.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${slug} — prototype</title>`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'src', 'main.tsx'), [
    "import React from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { BrowserRouter } from 'react-router-dom'",
    "import App from './App'",
    "import './styles.css'",
    '',
    "createRoot(document.getElementById('root')!).render(",
    '  <React.StrictMode>',
    '    <BrowserRouter>',
    '      <App />',
    '    </BrowserRouter>',
    '  </React.StrictMode>',
    ')',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'src', 'App.tsx'), [
    "import { Link, Route, Routes } from 'react-router-dom'",
    "import Home from './pages/Home'",
    '',
    'export default function App() {',
    '  return (',
    '    <div className="proto-app">',
    '      <nav className="proto-nav">',
    '        <Link to="/">Home</Link>',
    '      </nav>',
    '      <Routes>',
    '        <Route path="/" element={<Home />} />',
    '      </Routes>',
    '    </div>',
    '  )',
    '}',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'src', 'pages', 'Home.tsx'), [
    "import { mockItems } from '../data/mock'",
    '',
    'export default function Home() {',
    '  return (',
    '    <main>',
    '      <h1>Prototype</h1>',
    '      <ul>',
    '        {mockItems.map(item => <li key={item.id}>{item.name}</li>)}',
    '      </ul>',
    '    </main>',
    '  )',
    '}',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'src', 'data', 'mock.ts'), [
    'export interface MockItem { id: number; name: string }',
    '',
    'export const mockItems: MockItem[] = [',
    "  { id: 1, name: 'Item A' },",
    "  { id: 2, name: 'Item B' },",
    "  { id: 3, name: 'Item C' }",
    ']',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'src', 'styles.css'), [
    'body { margin: 0; font-family: system-ui, sans-serif; }',
    '.proto-nav { padding: 8px 16px; border-bottom: 1px solid #ddd; }',
    '.proto-nav a { margin-right: 12px; }',
    ''
  ].join('\n'))

  writeFileSync(path.join(dir, 'PROTOTYPE.md'), [
    `# ${slug} — UI/UX Prototype`,
    '',
    'Generated by Meow Design agent. Real React + Vite app with mock data.',
    'Use this source as reference when building the real frontend.',
    ''
  ].join('\n'))

  if (!options.skipInstall) {
    await npmInstall(dir)
  }
  return dir
}

function npmInstall(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = buildSpawnCommand('npm', ['install', '--no-audit', '--no-fund'])
    const proc = spawn(cmd.command, cmd.args, {
      cwd: dir,
      stdio: 'ignore',
      windowsHide: true
    })
    proc.on('error', reject)
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`npm install exited ${code}`))))
  })
}
```

Lưu ý: dùng `127.0.0.1` trong vite config để chặn truy cập ngoài LAN (security, đúng tinh thần AGENTS).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prototype-scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/prototype-scaffold.ts tests/unit/prototype-scaffold.test.ts
git commit -m "feat: prototype scaffold writes runnable React+Vite app"
```

---

### Task 6: Prototype preview server (Vite dev + static browser)

**Files:**
- Create: `src/main/prototype-preview-server.ts`
- Test: `tests/unit/prototype-preview-server.test.ts`

- [ ] **Step 1: Write the failing test (unit, chỉ logic map/kill giả)**

Test unit không spawn thật; dùng một `child_process.spawn` giả qua tham số injectable:

```ts
// tests/unit/prototype-preview-server.test.ts
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PrototypePreviewServer } from '../../src/main/prototype-preview-server'

function fakeProc(): ChildProcess {
  const p = new EventEmitter() as ChildProcess
  p.pid = 123
  p.stdout = new EventEmitter() as never
  p.stderr = new EventEmitter() as never
  return p
}

describe('PrototypePreviewServer', () => {
  it('returns a cached URL for a running prototype and clears on stop', async () => {
    const server = new PrototypePreviewServer()
    const proc = fakeProc()
    server['servers'].set('/proto', proc)
    server['urls'].set('/proto', 'http://localhost:5173/')
    expect(server.urlFor('/proto')).toBe('http://localhost:5173/')
    await server.stop('/proto')
    expect(server.urlFor('/proto')).toBeNull()
  })

  it('stopAll stops every server', async () => {
    const server = new PrototypePreviewServer()
    server['servers'].set('/a', fakeProc())
    server['servers'].set('/b', fakeProc())
    await server.stopAll()
    expect(server['servers'].size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prototype-preview-server.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Implement server**

```ts
// src/main/prototype-preview-server.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import kill from 'tree-kill'
import { buildSpawnCommand } from './pty-manager'

interface RunningServer {
  proc: ChildProcess
  url: string
}

export class PrototypePreviewServer {
  private servers = new Map<string, RunningServer>()

  urlFor(protoDir: string): string | null {
    return this.servers.get(protoDir)?.url ?? null
  }

  async start(protoDir: string): Promise<string> {
    const existing = this.servers.get(protoDir)
    if (existing) return existing.url
    const port = await freePort()
    const cmd = buildSpawnCommand('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'])
    const proc = spawn(cmd.command, cmd.args, {
      cwd: protoDir,
      windowsHide: true,
      env: { ...process.env } as Record<string, string>
    })
    const url = `http://127.0.0.1:${port}/`
    const entry: RunningServer = { proc, url }
    this.servers.set(protoDir, entry)
    proc.on('exit', () => {
      if (this.servers.get(protoDir) === entry) this.servers.delete(protoDir)
    })
    await waitForHttp(url, 30000)
    return url
  }

  async stop(protoDir: string): Promise<void> {
    const entry = this.servers.get(protoDir)
    if (!entry) return
    this.servers.delete(protoDir)
    await killTree(entry.proc)
  }

  async stopAll(): Promise<void> {
    const dirs = [...this.servers.keys()]
    await Promise.all(dirs.map(dir => this.stop(dir)))
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then(res => (res.ok ? resolve() : retry()))
        .catch(retry)
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Preview server not ready in ${timeoutMs}ms: ${url}`))
        return
      }
      setTimeout(tick, 250)
    }
    tick()
  })
}

function killTree(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (!proc.pid) {
      try { proc.kill() } catch { /* already dead */ }
      resolve()
      return
    }
    kill(proc.pid, () => {
      try { proc.kill() } catch { /* already dead */ }
      resolve()
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prototype-preview-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/prototype-preview-server.ts tests/unit/prototype-preview-server.test.ts
git commit -m "feat: prototype preview server (vite dev, tree-kill stop)"
```

---

### Task 7: Main process — prototype window, handlers, wiring

**Files:**
- Modify: `src/main/index.ts`
- Test: `tests/unit/ipc-contract.test.ts` (không đổi), verify bằng `npm run typecheck`

- [ ] **Step 1: Thêm biến + khởi tạo preview server**

Trong `src/main/index.ts`:

Sau `let win: BrowserWindow | null = null`, thêm:

```ts
let protoWin: BrowserWindow | null = null
```

Trong class `MainApp` field (sau `pty = new PtyManager()`):

```ts
  prototypePreview = new PrototypePreviewServer()
```

Constructor `MainApp`, trong `meowAgent` deps thêm `designSkillsDir`:

```ts
    designSkillsDir: app.isPackaged
      ? path.join(process.resourcesPath, 'design-skills')
      : path.join(app.getAppPath(), '.opencode', 'skills'),
```

Thêm import: `import { createPrototypeScaffold } from './prototype-scaffold'`, `import { PrototypePreviewServer } from './prototype-preview-server'`, `import type { PrototypeInfo, PrototypeRuntime } from '../shared/types'`.

Thêm method vào `MainApp` (sau `resetActiveProject`):

```ts
  listPrototypes(): PrototypeInfo[] {
    const ws = this.activeProject ? this.workspaces.get(this.activeProject) : undefined
    if (!ws) return []
    return ws.agents
      .filter(a => a.kind === 'design')
      .map(a => ({ name: a.name, path: a.cwd, agentId: a.id }))
  }

  async createPrototype(name: string): Promise<PrototypeInfo | null> {
    if (!this.activeProject) return null
    const dir = await createPrototypeScaffold(this.activeProject, name)
    const ws = this.workspaces.addAgent(this.activeProject, {
      name,
      templateId: 'design-prototype',
      cwd: dir,
      kind: 'design'
    })
    const agent = ws.agents[ws.agents.length - 1]
    this.meowAgent.addAgent(agent)
    return { name, path: dir, agentId: agent.id }
  }

  async openPrototype(name: string): Promise<PrototypeRuntime | null> {
    const proto = this.listPrototypes().find(p => p.name === name)
    if (!proto) return null
    const previewUrl = await this.prototypePreview.start(proto.path)
    return { prototype: proto, previewUrl }
  }

  async closePrototype(name: string): Promise<void> {
    const proto = this.listPrototypes().find(p => p.name === name)
    if (proto) await this.prototypePreview.stop(proto.path)
  }

  getPrototypePreviewUrl(name: string): string | null {
    const proto = this.listPrototypes().find(p => p.name === name)
    return proto ? this.prototypePreview.urlFor(proto.path) : null
  }

  async openPrototypeInBrowser(name: string): Promise<string | null> {
    const proto = this.listPrototypes().find(p => p.name === name)
    if (!proto) return null
    const url = await this.prototypePreview.start(proto.path)
    return url
  }

  async promotePrototype(name: string): Promise<boolean> {
    const ws = this.activeProject ? this.workspaces.get(this.activeProject) : undefined
    if (!ws) return false
    const proto = this.listPrototypes().find(p => p.name === name)
    const dev = ws.agents.find(a => a.kind !== 'design' && a.kind !== 'pty')
    if (!proto || !dev) return false
    const prompt = `Build the real frontend for the project based on the UI/UX prototype at ` +
      `${proto.path} (docs/uiux-design/${proto.name}). Read PROTOTYPE.md and all source files ` +
      `in that folder, then implement the real app using those screens and flows.`
    this.meowAgent.send(dev.id, prompt)
    return true
  }
```

Lưu ý: `meowAgent.send` trả về Promise<void> — gọi `void this.meowAgent.send(...)` hoặc để fire-and-forget; hàm promote trả `true` ngay.

- [ ] **Step 2: Thêm hàm tạo prototype window + handler**

Sau hàm `createWindow()` trong file, thêm:

```ts
function createPrototypeWindow(): void {
  if (protoWin) {
    protoWin.focus()
    return
  }
  protoWin = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Meow Prototype',
    backgroundColor: '#1e1e1e',
    ...getWindowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    protoWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=prototype`)
  } else {
    protoWin.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view: 'prototype' } })
  }
  protoWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  protoWin.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  protoWin.on('closed', () => {
    protoWin = null
  })
}
```

Trong `registerIpcHandlers()`, thêm:

```ts
  ipcMain.handle(Channels.WindowOpenPrototype, () => createPrototypeWindow())
  ipcMain.handle(Channels.PrototypeList, () => mainApp.listPrototypes())
  ipcMain.handle(Channels.PrototypeCreate, (_e, name: string) => mainApp.createPrototype(name))
  ipcMain.handle(Channels.PrototypeOpen, (_e, name: string) => mainApp.openPrototype(name))
  ipcMain.handle(Channels.PrototypeClose, (_e, name: string) => mainApp.closePrototype(name))
  ipcMain.handle(Channels.PrototypePreviewUrl, (_e, name: string) => mainApp.getPrototypePreviewUrl(name))
  ipcMain.handle(Channels.PrototypeOpenInBrowser, async (_e, name: string) => {
    const url = await mainApp.openPrototypeInBrowser(name)
    if (url) void shell.openExternal(url)
    return url
  })
  ipcMain.handle(Channels.PrototypePromote, (_e, name: string) => mainApp.promotePrototype(name))
```

- [ ] **Step 3: Forward prototype preview event + cleanup**

Trong `before-quit`, thêm `void mainApp.prototypePreview.stopAll()` trước `app.exit(0)`:

```ts
  mainApp.stopGitPoll()
  void mainApp.meowAgent.dispose().then(() => {
    void mainApp.prototypePreview.stopAll()
    mainApp.pty.stopAll().finally(() => app.exit(0))
  })
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: prototype window, IPC handlers, promote flow in main"
```

---

### Task 8: Preload expose prototype API

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Thêm methods vào preload**

Trong `src/preload/index.ts`, thêm vào object `api` (sau `onContextChanged`):

```ts
  listPrototypes: () => ipcRenderer.invoke(Channels.PrototypeList),
  createPrototype: (name: string) => ipcRenderer.invoke(Channels.PrototypeCreate, name),
  openPrototype: (name: string) => ipcRenderer.invoke(Channels.PrototypeOpen, name),
  closePrototype: (name: string) => ipcRenderer.invoke(Channels.PrototypeClose, name),
  getPrototypePreviewUrl: (name: string) => ipcRenderer.invoke(Channels.PrototypePreviewUrl, name),
  openPrototypeInBrowser: (name: string) => ipcRenderer.invoke(Channels.PrototypeOpenInBrowser, name),
  promotePrototype: (name: string) => ipcRenderer.invoke(Channels.PrototypePromote, name),
  openPrototypeWindow: () => ipcRenderer.invoke(Channels.WindowOpenPrototype),
  onPrototypePreview: (cb: (e: PrototypePreviewEventPayload) => void) =>
    subscribe(Channels.EventPrototypePreview, cb),
```

Import `PrototypePreviewEventPayload` từ shared/ipc.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose prototype API through preload"
```

---

### Task 9: Renderer — PrototypeWindow + PreviewPanel + routing

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/components/prototype/PrototypeWindow.tsx`
- Create: `src/renderer/src/components/prototype/PreviewPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Route `?view=prototype` trong main.tsx**

Đổi `src/renderer/src/main.tsx` thành:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import PrototypeWindow from './components/prototype/PrototypeWindow'
import './styles.css'

const rootEl = document.getElementById('root')!
const params = new URLSearchParams(window.location.search)
const isPrototypeView = params.get('view') === 'prototype'

function Root() {
  return isPrototypeView ? <PrototypeWindow /> : <App />
}

if (!window.api) {
  createRoot(rootEl).render(
    <div className="empty-state">
      <p className="subtitle">
        Preload chưa được nạp (window.api bị thiếu). Đóng mọi cửa sổ Electron cũ đang chạy, sau đó
        chạy lại <code>npm run dev</code>.
      </p>
    </div>
  )
} else {
  createRoot(rootEl).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  )
}
```

- [ ] **Step 2: PrototypeWindow component**

```tsx
// src/renderer/src/components/prototype/PrototypeWindow.tsx
import { useCallback, useEffect, useState } from 'react'
import type { PrototypeInfo, PrototypeRuntime } from '@shared/types'
import TitleBar from '../TitleBar'
import ChatPanel from '../chat/ChatPanel'
import PreviewPanel from './PreviewPanel'

export default function PrototypeWindow() {
  const [prototypes, setPrototypes] = useState<PrototypeInfo[]>([])
  const [active, setActive] = useState<PrototypeRuntime | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void window.api.listPrototypes().then(setPrototypes)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createPrototype = useCallback(async () => {
    setError('')
    if (!name.trim()) return
    try {
      const proto = await window.api.createPrototype(name.trim())
      if (!proto) {
        setError('Create prototype failed. Open a project in the main window first.')
        return
      }
      setName('')
      refresh()
      const rt = await window.api.openPrototype(proto.name)
      if (rt) setActive(rt)
    } catch (err) {
      setError(String(err))
    }
  }, [name, refresh])

  const selectPrototype = useCallback(async (protoName: string) => {
    setError('')
    try {
      const rt = await window.api.openPrototype(protoName)
      if (rt) setActive(rt)
      else setError('Could not start preview for that prototype.')
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const promote = useCallback(async () => {
    if (!active) return
    const ok = await window.api.promotePrototype(active.prototype.name)
    setError(ok ? '' : 'Promote failed: no dev agent in this project.')
  }, [active])

  const openInBrowser = useCallback(() => {
    if (!active) return
    void window.api.openPrototypeInBrowser(active.prototype.name)
  }, [active])

  return (
    <div className="app">
      <TitleBar />
      <div className="prototype-window">
        <aside className="prototype-sidebar">
          <div className="panel-head">
            <span className="panel-title">Prototypes</span>
          </div>
          <div className="prototype-create">
            <input
              className="input"
              value={name}
              placeholder="prototype name"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createPrototype() }}
            />
            <button className="btn primary" onClick={() => void createPrototype()} disabled={!name.trim()}>
              New
            </button>
          </div>
          {error && <div className="prototype-error">{error}</div>}
          <ul className="prototype-list">
            {prototypes.map(p => (
              <li key={p.agentId} className={active?.prototype.agentId === p.agentId ? 'active' : ''}>
                <button className="prototype-row" onClick={() => void selectPrototype(p.name)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="prototype-actions">
            <button className="btn" onClick={openInBrowser} disabled={!active}>Open in Browser</button>
            <button className="btn primary" onClick={() => void promote()} disabled={!active}>Promote to Dev</button>
          </div>
        </aside>
        <div className="prototype-body">
          {active ? (
            <>
              <div className="prototype-chat">
                <ChatPanel agentId={active.prototype.agentId} cwd={active.prototype.path} />
              </div>
              <div className="prototype-preview">
                <PreviewPanel name={active.prototype.name} url={active.previewUrl} />
              </div>
            </>
          ) : (
            <div className="prototype-empty">
              Create or select a prototype to start designing.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: PreviewPanel component**

```tsx
// src/renderer/src/components/prototype/PreviewPanel.tsx
import { useEffect, useRef } from 'react'

interface Props {
  name: string
  url: string
}

export default function PreviewPanel({ name, url }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (iframeRef.current) iframeRef.current.src = url
  }, [url])

  return (
    <iframe
      ref={iframeRef}
      className="prototype-iframe"
      title={`preview ${name}`}
      src={url}
      sandbox="allow-scripts allow-same-origin"
    />
  )
}
```

- [ ] **Step 4: App.tsx — lọc design agents khỏi pane grid**

Trong `src/renderer/src/App.tsx`, hàm `panes` useMemo: thêm filter `agent.kind !== 'design'`:

```ts
    return runtime.workspace.agents
      .filter(agent => agent.kind !== 'design')
      .map(agent => ({
        agent,
        state: runtime.agents.find(s => s.agentId === agent.id) ?? {
          agentId: agent.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
        },
        git: runtime.git
      }))
```

- [ ] **Step 5: Sidebar — menu "Prototype Studio"**

Trong `src/renderer/src/components/Sidebar.tsx`, trong dropdown `sidebar-menu-dropdown`, thêm menu item (sau "Add project"):

```tsx
              <button className="menu-item" onClick={() => { closeMenu(); void window.api.openPrototypeWindow() }}>Prototype Studio</button>
```

- [ ] **Step 6: Styles**

Thêm vào `src/renderer/src/styles.css`:

```css
.prototype-window { display: flex; flex: 1; min-height: 0; }
.prototype-sidebar { width: 240px; background: var(--bg-panel, #252526); border-right: 1px solid #333; display: flex; flex-direction: column; padding: 8px; gap: 8px; }
.prototype-create { display: flex; gap: 6px; }
.prototype-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.prototype-list li.active .prototype-row { background: #094771; }
.prototype-row { width: 100%; text-align: left; background: none; border: none; color: inherit; padding: 6px 8px; cursor: pointer; border-radius: 4px; }
.prototype-row:hover { background: #333; }
.prototype-error { color: #f48771; font-size: 12px; }
.prototype-actions { display: flex; gap: 6px; margin-top: auto; }
.prototype-body { flex: 1; display: flex; min-width: 0; }
.prototype-chat { width: 40%; min-width: 320px; border-right: 1px solid #333; }
.prototype-preview { flex: 1; background: #fff; }
.prototype-iframe { width: 100%; height: 100%; border: none; background: #fff; }
.prototype-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #888; }
```

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/prototype src/renderer/src/styles.css
git commit -m "feat: prototype window UI (chat left, live preview right)"
```

---

### Task 10: E2E smoke + full verification

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Thêm smoke test prototype window**

Thêm vào `tests/e2e/smoke.spec.ts`:

```ts
test('prototype studio opens a separate window', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await window.getByRole('button', { name: 'menu' }).click()
  await window.getByRole('button', { name: 'Prototype Studio' }).click()
  const protoWindow = await app.waitForEvent('window')
  await expect(protoWindow).toHaveTitle(/Meow Prototype/)
  await protoWindow.locator('.prototype-window').waitFor()
  await app.close()
})
```

Lưu ý: `app.waitForEvent('window')` trả window mới — kiểm tra title + container.

- [ ] **Step 2: Chạy bộ verify đầy đủ**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS (unit + integration hiện có + test mới).

- [ ] **Step 3: Chạy build + e2e**

Run: `npm run build && npm run e2e`
Expected: PASS (smoke mới + cũ).

- [ ] **Step 4: Thử tay (thủ công)**

Run: `npm run dev`
- Mở project → menu → Prototype Studio → cửa sổ mới hiện `.prototype-window`.
- Gõ tên prototype "checkout flow" → New → thấy preview chạy (HTTP 200), agent design xuất hiện trong chat.
- Chat "Tạo màn hình Home + Cart với mock data, điều hướng qua react-router" → preview HMR cập nhật.
- Nút "Open in Browser" mở tab trình duyệt; "Promote to Dev" inject prompt vào agent dev.
- Kiểm tra `docs/uiux-design/checkout-flow/` có đủ file + `npm install` đã chạy.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test: e2e smoke for prototype studio window"
```

---

## Self-Review Notes

- **Spec coverage:** cửa sổ thứ 2 (Task 7+9), agent kind design + skill (Task 3-4), scaffold đa màn hình React+Vite (Task 5), preview thật qua Vite (Task 6+9), Open in Browser (Task 7+9), lưu `docs/uiux-design` (Task 5+7), Promote (Task 7+9), IPC contract (Task 2+8). Đã đủ.
- **No placeholders:** mọi step đều có code hoặc lệnh cụ thể.
- **Type consistency:** `PrototypeInfo`/`PrototypeRuntime`/`PrototypePreviewEvent` dùng nhất quán ở shared → main → preload → renderer; `collectSkills(..., ...extraDirs)` được Task 3 định nghĩa trước khi dùng ở Task 4.
- **Security:** vite server chỉ bind `127.0.0.1`; iframe sandbox `allow-scripts allow-same-origin` (chỉ nội dung do chính design agent gen); không expose `ipcRenderer`.
