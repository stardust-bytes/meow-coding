# System Logger Theo Ngày — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghi toàn bộ log (INFO/WARN/ERROR) của main process, renderer và sự kiện lỗi agent vào `userData/logs/YYYY-MM-DD-log.txt`, tự dọn file cũ hơn 7 ngày.

**Architecture:** Thêm class `SystemLogger` thuần (append-only theo ngày, `now` inject cho test) đặt cạnh `LogManager`. Main patch `console.*` + `process.on('uncaughtException'/'unhandledRejection')` → log source `main`; renderer patch `console.*` → gửi qua IPC channel mới `system-log:write` → main ghi source `render`; lỗi agent (PTY exit ≠ 0 và `ChatEvent.error` từ native agent) được ghi tại biên `index.ts` (nơi đã hội tụ cả hai loại agent) với source `agent`. `LogLevel`/`LogSource` để ở `src/shared/types.ts` để renderer dùng chung.

**Tech Stack:** TypeScript strict, Electron main process, Vitest (unit).

**Spec:** `docs/superpowers/specs/2026-08-27-system-logger-design.md`

## Global Constraints

- TypeScript strict. `npm run typecheck` phải xanh ở mọi commit.
- `npm test` phải xanh ở mọi commit. Baseline trên máy này đang xanh (kể cả `officecli-binary-manager.test.ts`).
- Không hardcode chuỗi IPC channel; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- `src/shared` không được import Node/Electron; `LogLevel`/`LogSource` là type thuần, JSON-serializable.
- Helper `formatLogArg`/`safeJson` dùng chung cả main + renderer → đặt ở `src/shared/log-helpers.ts` (KHÔNG duplicate ở 2 nơi — quyết định pre-flight của user).
- Mọi thay đổi hành vi phải có test viết **trước** phần implement (TDD).
- Commit sau mỗi task.
- Chỉ comment khi giải thích quyết định khó, không comment mô tả code.
- `SystemLogger` không được dùng `console.*` ở đường fallback (tránh đệ quy khi console bị patch) — dùng `process.stderr.write`.
- Thay đổi IPC contract phải cập nhật 4 chỗ đồng bộ: main handler, preload, renderer, `tests/unit/ipc-contract.test.ts`.

---

### Task 1: `SystemLogger` class + shared log helpers + unit test

**Files:**
- Modify: `src/shared/types.ts` (thêm 2 type thuần — renderer dùng chung)
- Create: `src/shared/log-helpers.ts` (`formatLogArg`/`safeJson` — dùng chung main + renderer)
- Create: `src/main/system-logger.ts`
- Test: `tests/unit/system-logger.test.ts`

**Interfaces:**
- Consumes: không gì từ task khác.
- Produces:
  - `type LogLevel = 'INFO' | 'WARN' | 'ERROR'` (trong `src/shared/types.ts`)
  - `type LogSource = 'main' | 'render' | 'agent'` (trong `src/shared/types.ts`)
  - `function safeJson(v: unknown): string` và `function formatLogArg(a: unknown): string` (export từ `src/shared/log-helpers.ts` — Task 3 + 4 dùng)
  - `class SystemLogger { constructor(logDir: string, now?: () => Date); log(level: LogLevel, source: LogSource, message: string): void; prune(maxDays?: number): void }` (export từ `src/main/system-logger.ts`)

- [ ] **Step 1: Thêm type vào `src/shared/types.ts`**

Thêm 2 dòng ngay sau `export type AgentKind = 'pty' | 'native'` (dòng 3):

```ts
export type LogLevel = 'INFO' | 'WARN' | 'ERROR'
export type LogSource = 'main' | 'render' | 'agent'
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/unit/system-logger.test.ts` (theo chuẩn `log-manager.test.ts`):

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SystemLogger } from '../../src/main/system-logger'

let dir: string
let logs: SystemLogger

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-syslog-'))
  logs = new SystemLogger(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SystemLogger', () => {
  it('appends a formatted line to the dated file', () => {
    logs.log('ERROR', 'main', 'boom')
    const names = readdirSync(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^\d{4}-\d{2}-\d{2}-log\.txt$/)
    const content = readFileSync(path.join(dir, names[0]), 'utf-8')
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\] \[main\] boom\n$/)
  })

  it('appends multiple lines to the same daily file', () => {
    logs.log('INFO', 'render', 'one')
    logs.log('WARN', 'agent', 'two')
    const names = readdirSync(dir)
    expect(names).toHaveLength(1)
    const content = readFileSync(path.join(dir, names[0]), 'utf-8')
    expect(content).toContain('[INFO] [render] one')
    expect(content).toContain('[WARN] [agent] two')
  })

  it('uses a new file when the injected clock crosses midnight', () => {
    let current = new Date('2026-08-04T10:00:00')
    const clocked = new SystemLogger(dir, () => current)
    clocked.log('ERROR', 'main', 'day one')
    current = new Date('2026-08-05T09:00:00')
    clocked.log('INFO', 'render', 'day two')
    const names = readdirSync(dir).sort()
    expect(names).toEqual(['2026-08-04-log.txt', '2026-08-05-log.txt'])
    expect(readFileSync(path.join(dir, '2026-08-04-log.txt'), 'utf-8')).toContain('[ERROR] [main] day one')
    expect(readFileSync(path.join(dir, '2026-08-05-log.txt'), 'utf-8')).toContain('[INFO] [render] day two')
  })

  it('prune removes dated files older than maxDays and keeps others', () => {
    const old = path.join(dir, '2026-08-01-log.txt')
    const recent = path.join(dir, '2026-08-27-log.txt')
    const other = path.join(dir, 'agent-xyz.log')
    const fs = require('node:fs')
    fs.writeFileSync(old, 'old')
    fs.writeFileSync(recent, 'recent')
    fs.writeFileSync(other, 'other')
    logs.prune(7)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(other)).toBe(true) // file không đúng pattern không bị đụng
  })

  it('log tolerates an unwritable directory without throwing', () => {
    const bad = new SystemLogger(path.join(dir, 'no-such', 'deep'))
    expect(() => bad.log('ERROR', 'main', 'x')).not.toThrow()
    // thư mục được tự tạo
    expect(existsSync(path.join(dir, 'no-such', 'deep'))).toBe(true)
  })
})
```

Lưu ý: test `prune` dùng `require('node:fs')` để tránh trùng tên import — sửa lại thành import tên khác cho sạch: dùng `writeFileSync` import ở đầu file và gọi trực tiếp (bỏ `require`).

- [ ] **Step 3: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/system-logger.test.ts`
Expected: FAIL — không tìm thấy module `../../src/main/system-logger`.

- [ ] **Step 4: Tạo `src/shared/log-helpers.ts`**

```ts
export function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

export function formatLogArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  return typeof a === 'string' ? a : safeJson(a)
}
```

- [ ] **Step 5: Viết implementation `src/main/system-logger.ts`**

```ts
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { LogLevel, LogSource } from '../shared/types'

const pad = (n: number): string => String(n).padStart(2, '0')

function formatTs(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export class SystemLogger {
  constructor(
    private logDir: string,
    private now: () => Date = () => new Date()
  ) {
    mkdirSync(this.logDir, { recursive: true })
  }

  private fileFor(d: Date): string {
    return path.join(this.logDir, `${dateStamp(d)}-log.txt`)
  }

  log(level: LogLevel, source: LogSource, message: string): void {
    try {
      const line = `[${formatTs(this.now())}] [${level}] [${source}] ${message}\n`
      appendFileSync(this.fileFor(this.now()), line)
    } catch (err) {
      // Không dùng console.* ở đây — console đã bị patch (Task 3), sẽ đệ quy.
      process.stderr.write(`[system-log] append failed: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  prune(maxDays = 7): void {
    try {
      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000
      for (const name of readdirSync(this.logDir)) {
        const m = /^(\d{4}-\d{2}-\d{2})-log\.txt$/.exec(name)
        if (!m) continue
        const ts = new Date(`${m[1]}T00:00:00`).getTime()
        if (ts < cutoff) {
          try {
            rmSync(path.join(this.logDir, name))
          } catch {
            /* file có thể bị xóa bởi tiến trình khác */
          }
        }
      }
    } catch {
      /* thư mục không tồn tại — bỏ qua */
    }
  }
}
```

- [ ] **Step 5: Sửa test `prune` cho sạch import**

Thay phần dùng `require` trong test `prune` bằng `writeFileSync` import sẵn ở đầu file:

```ts
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
```

và trong test:

```ts
writeFileSync(old, 'old')
writeFileSync(recent, 'recent')
writeFileSync(other, 'other')
```

- [ ] **Step 6: Sửa test `prune` cho không phụ thuộc ngày chạy**

```ts
  it('prune removes dated files older than maxDays and keeps others', () => {
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const day = 24 * 60 * 60 * 1000
    const old = path.join(dir, `${stamp(new Date(Date.now() - 10 * day))}-log.txt`)
    const recent = path.join(dir, `${stamp(new Date(Date.now() - 1 * day))}-log.txt`)
    const other = path.join(dir, 'agent-xyz.log')
    writeFileSync(old, 'old')
    writeFileSync(recent, 'recent')
    writeFileSync(other, 'other')
    logs.prune(7)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(other)).toBe(true) // file không đúng pattern không bị đụng
  })
```

- [ ] **Step 7: Chạy test để nó pass**

Run: `npx vitest run tests/unit/system-logger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Khai báo field `systemLogger` trong `MainApp` (để Task 2 compile được)**

Trong `src/main/index.ts`, thêm import ở đầu file:

```ts
import { SystemLogger } from './system-logger'
```

Trong constructor `MainApp`, ngay sau dòng `logs = new LogManager(...)` (dòng ~107), thêm:

```ts
  systemLogger = new SystemLogger(path.join(app.getPath('userData'), 'logs'))
```

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/log-helpers.ts src/main/system-logger.ts src/main/index.ts tests/unit/system-logger.test.ts
git commit -m "feat(main): system logger theo ngày + unit test"
```

---

### Task 2: IPC contract — `system-log:write`

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts` (`registerIpcHandlers`)
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `LogLevel` từ `src/shared/types.ts` (Task 1), `mainApp.systemLogger: SystemLogger` (Task 1 Step 8 — handler chỉ cần method `log`).
- Produces:
  - `Channels.SystemLog = 'system-log:write'`
  - `AgentApi.writeSystemLog(level: LogLevel, message: string): Promise<void>`
  - Main handler: `ipcMain.handle(Channels.SystemLog, (_e, level: LogLevel, message: string) => { mainApp.systemLogger.log(level, 'render', message) })`

- [ ] **Step 1: Thêm channel vào `src/shared/ipc.ts`**

Trong `Channels`, thêm `SystemLog` cạnh nhóm `LogOpen`/`LogPath`:

```ts
  LogOpen: 'log:open',
  LogPath: 'log:path',
  SystemLog: 'system-log:write',
```

Import `LogLevel` vào dòng `import type { ... } from './types'` (danh sách type import đầu file):

```ts
import type {
  AgentConfig, AgentState, ArtifactEntry, CatalogProviderSummary, ChatEvent, ChatMessage, ChatTranscriptItem, Command,
  ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload,
  GitActionResult, GitBlameLine, GitBranch, GitCommit, GitDiffResult, GitStatus, GitStatusDetail,
  ImageAttachment, LogLevel, McpServerStatus, MeowSettings, ModelRef, NewAgentInput, PromptResponse,
  SessionSummary, StatsSummary, Template, TerminalInfo, TodoItem, TraceEvent, TraceSummary, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
} from './types'
```

Thêm method vào `AgentApi` (cạnh `getLogPath`):

```ts
  getLogPath(agentId: string): Promise<string>
  writeSystemLog(level: LogLevel, message: string): Promise<void>
```

- [ ] **Step 2: Implement trong `src/preload/index.ts`**

Thêm vào object `api` (cạnh `getLogPath`):

```ts
  getLogPath: (agentId: string) => ipcRenderer.invoke(Channels.LogPath, agentId),
  writeSystemLog: (level: LogLevel, message: string) =>
    ipcRenderer.invoke(Channels.SystemLog, level, message),
```

Import `LogLevel` từ shared types (dòng import type hiện có):

```ts
import type { ChatEvent, Command, ContextChangedEvent, FileViewerPayload, ImageAttachment, LogLevel, MeowSettings, ModelRef, NewAgentInput, PromptResponse, Template, TraceEvent, UpdaterStatusEvent } from '../shared/types'
```

- [ ] **Step 3: Thêm handler trong `src/main/index.ts`**

Trong `registerIpcHandlers`, cạnh handler `LogOpen`:

```ts
  ipcMain.handle(Channels.SystemLog, (_e, level: LogLevel, message: string) => {
    mainApp.systemLogger.log(level, 'render', message)
  })
```

Import `LogLevel` ở đầu file (cùng dòng import type từ shared):

```ts
import type { ... LogLevel ... } from '../shared/types'
```

- [ ] **Step 4: Cập nhật `tests/unit/ipc-contract.test.ts`**

Thêm `'writeSystemLog'` vào mảng `required` (cạnh `'getLogPath'`):

```ts
      'writeInput', 'injectPrompt', 'resizePty', 'openLog', 'getLogPath', 'writeSystemLog', 'quit', 'getAppVersion',
```

Thêm mock impl vào object `api` (cạnh `getLogPath: async () => ''`):

```ts
      writeSystemLog: async () => {},
```

- [ ] **Step 5: Chạy typecheck + test**

Run: `npm run typecheck && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: cả hai xanh (field `mainApp.systemLogger` đã tồn tại từ Task 1 Step 8).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(ipc): channel system-log:write + writeSystemLog"
```

---

### Task 3: Wire main process — console patch, crash handlers, agent errors

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `SystemLogger` + `mainApp.systemLogger` (Task 1), `Channels.SystemLog` (Task 2).
- Produces:
  - `patchConsole(systemLogger: SystemLogger): void` (hàm module-scope trong index.ts)
  - Agent error logs: `[ERROR] [agent]` tại pty exit ≠ 0 và `ChatEvent.type === 'error'`

- [ ] **Step 1: Patch `console.*` + crash handlers**

Sau `export const mainApp = new MainApp()` (dòng 549), thêm:

```ts
function patchConsole(systemLogger: SystemLogger): void {
  const hooks: Array<[keyof Console, LogLevel]> = [
    ['log', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR']
  ]
  for (const [method, level] of hooks) {
    const original = console[method].bind(console)
    console[method] = ((...args: unknown[]) => {
      original(...args)
      systemLogger.log(level, 'main', args.map(formatLogArg).join(' '))
    }) as typeof console.log
  }
}

patchConsole(mainApp.systemLogger)

process.on('uncaughtException', err => {
  mainApp.systemLogger.log('ERROR', 'main', `uncaughtException: ${err.stack ?? err.message}`)
  app.quit()
})

process.on('unhandledRejection', reason => {
  const msg = reason instanceof Error ? (reason.stack ?? reason.message) : safeJson(reason)
  mainApp.systemLogger.log('ERROR', 'main', `unhandledRejection: ${msg}`)
})
```

Import ở đầu file: `import { SystemLogger } from './system-logger'`, `import type { LogLevel } from '../shared/types'`, và `import { formatLogArg, safeJson } from '../shared/log-helpers'`.

- [ ] **Step 3: Ghi log lỗi agent tại pty exit**

Trong handler `this.pty.on('exit', ...)` (dòng ~220), ngay sau `const code = exitCode ?? -1`:

```ts
      const code = exitCode ?? -1
      if (code !== 0) {
        mainApp.systemLogger.log('ERROR', 'agent', `agent ${agentId} exited with code ${code}`)
      }
```

- [ ] **Step 4: Ghi log lỗi native agent (chat events)**

Trong `this.meowAgent.setOnEvent(...)` (dòng ~263), nhánh `event.type === 'error'`:

```ts
      } else if (event.type === 'done' || event.type === 'error') {
        this.setState(event.agentId, { status: 'idle', alert: 'normal' })
      }
      if (event.type === 'error') {
        mainApp.systemLogger.log('ERROR', 'agent', `agent ${event.agentId}: ${event.message}`)
      }
```

- [ ] **Step 5: Gọi `prune` khi khởi động**

Trong `app.whenReady().then(...)`, dòng đầu sau `if (!gotTheLock) return`:

```ts
  mainApp.systemLogger.prune(7)
  mainApp.meowAgent.truncationCleanup()
```

- [ ] **Step 6: Chạy typecheck + toàn bộ test**

Run: `npm run typecheck && npm test`
Expected: xanh.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): log console, crash và lỗi agent vào system logger"
```

---

### Task 4: Renderer — forward `console.*` qua IPC

**Files:**
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `window.api.writeSystemLog(level, message)` (Task 2).
- Produces: không gì cho task khác — mọi `console.log/warn/error` ở renderer được forward.

- [ ] **Step 1: Thêm hàm patch**

Thêm vào `src/renderer/src/main.tsx` sau `watchTheme()` (trước khối `const rootEl = ...`):

```ts
function patchConsoleLogging(): void {
  if (!window.api) return
  const levelOf: Record<'log' | 'info' | 'warn' | 'error', LogLevel> = {
    log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR'
  }
  for (const name of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[name].bind(console)
    console[name] = ((...args: unknown[]) => {
      original(...args)
      const message = args.map(formatLogArg).join(' ')
      void window.api.writeSystemLog(levelOf[name], message || name).catch(() => {})
    }) as typeof console.log
  }
}

patchConsoleLogging()
```

Thêm import từ shared (renderer có alias `@shared` trong `electron.vite.config.ts` + `tsconfig.web.json` — cùng chuẩn các file render khác):

```ts
import type { LogLevel } from '@shared/types'
import { formatLogArg } from '@shared/log-helpers'
```

- [ ] **Step 2: Chạy typecheck**

Run: `npm run typecheck`
Expected: xanh.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/main.tsx
git commit -m "feat(renderer): forward console.* tới system logger"
```

---

### Task 5: Đồng bộ tài liệu (bắt buộc theo AGENTS.md)

**Files:**
- Modify: `src/main/AGENTS.md`
- Modify: `src/shared/AGENTS.md`
- Modify: `docs/reference/05-ipc-contract.md`
- Modify: `docs/reference/06-data-and-storage.md`

**Interfaces:**
- Consumes: tên file `system-logger.ts`, channel `system-log:write`, method `writeSystemLog`, type `LogLevel`/`LogSource`, file `logs/YYYY-MM-DD-log.txt` từ các task trước.

- [ ] **Step 1: `src/main/AGENTS.md`**

Thêm 1 bullet vào danh sách key files, ngay sau bullet `log-manager.ts`:

```md
- `system-logger.ts` — appends app-wide logs (main/render/agent, INFO/WARN/ERROR) to `userData/logs/<YYYY-MM-DD>-log.txt`, prunes files older than 7 days on startup.
```

Chỉ thêm dòng này — không đụng các mục khác.

- [ ] **Step 2: `src/shared/AGENTS.md`**

Sửa dòng mô tả `types.ts` để liệt kê 2 type mới, và thêm bullet `log-helpers.ts` (giữ nguyên format):

```md
- `types.ts` — pure data models (Template, Workspace, AgentConfig, AgentState, GitStatus, LogLevel, LogSource, ...).
- `log-helpers.ts` — pure helpers `formatLogArg`/`safeJson` dùng cho system logger (main + renderer).
```

- [ ] **Step 3: `docs/reference/05-ipc-contract.md`**

Thêm 1 dòng vào bảng, ngay sau dòng `LogPath / LogOpen`:

```md
| `SystemLog` | `system-log:write` | `writeSystemLog(level: LogLevel, message)` — renderer gửi log về main ghi vào file theo ngày |
```

- [ ] **Step 4: `docs/reference/06-data-and-storage.md`**

Thêm 1 dòng vào bảng, ngay sau dòng `logs/<agentId>.log`:

```md
| `logs/<YYYY-MM-DD>-log.txt` | `system-logger.ts` | text | App-wide system log (main/render/agent), append-only, pruned after 7 days on startup |
```

- [ ] **Step 5: Commit**

```bash
git add src/main/AGENTS.md src/shared/AGENTS.md src/shared/log-helpers.ts docs/reference/05-ipc-contract.md docs/reference/06-data-and-storage.md
git commit -m "docs: sync system logger vào AGENTS.md và reference"
```

---

### Task 6: Xác minh toàn bộ

**Files:**
- Không sửa file — chỉ chạy lệnh.

- [ ] **Step 1: `npm run typecheck`**

Expected: xanh.

- [ ] **Step 2: `npm test`**

Expected: xanh toàn bộ unit + integration.

- [ ] **Step 3: `npm run build && npm run e2e`** (thay đổi IPC + preload + renderer → cần verify e2e)

Expected: build thành công, e2e smoke pass.

- [ ] **Step 4: Kiểm tra thủ công (dev)**

Chạy `npm run dev`, mở app, xem `userData/logs/<ngày hôm nay>-log.txt` có dòng `[INFO]/[WARN]/[ERROR] [main]` và `[render]`; restart agent với lệnh sai để thấy `[ERROR] [agent] ... exited with code ...`.

- [ ] **Step 5: Cập nhật spec status**

Sửa dòng đầu spec `docs/superpowers/specs/2026-08-27-system-logger-design.md` từ `chờ duyệt` → `đã triển khai` (theo format các spec cũ), commit:

```bash
git add docs/superpowers/specs/2026-08-27-system-logger-design.md
git commit -m "docs: mark system logger spec as implemented"
```

---

## Self-review notes

- **Spec coverage:** file ngày + format dòng → Task 1; source main (console + crash) → Task 3; source render → Task 2 + 4; source agent (exit ≠ 0 + chat error) → Task 3; prune 7 ngày → Task 1 (method) + Task 3 (gọi lúc startup); docs sync → Task 5; typecheck/test → mọi task + Task 6.
- **Điểm khác spec gốc:** spec đề nghị ghi lỗi agent trong `meow-agent-manager.ts`; plan ghi tại biên `index.ts` (`pty.on('exit')` + `setOnEvent`) — cùng hành vi quan sát được (`[ERROR] [agent]`), ít xâm lấn hơn, không cần thêm dependency vào manager.
- **Đệ quy console:** `SystemLogger.log` fallback dùng `process.stderr.write`, không dùng `console.*` → patch console (Task 3) không gây đệ quy.
