# Project Menu: Open Folder + Open Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-13-project-menu-open-folder-terminal-design.md`

**Goal:** Thêm 2 mục vào menu dropdown của mỗi project trong sidebar:
1. **Open Folder** — mở thư mục project trong file manager OS (`shell.openPath`).
2. **Open Terminal** — mở pane terminal trong app (shell mặc định OS, `cwd = projectPath`), session
   tạm runtime-only, không lưu vào `workspaces.json`.

**Architecture:** Terminal session đi qua `PtyManager` (đã có) với `PtySession.kind = 'terminal'`;
main route data/exit của terminal sang `EventPtyData`/`EventTerminalExit` và **bỏ qua** toàn bộ
logic agent (logs, alerts, setState, hint "[meow] Agent thoát..."). Renderer merge terminal thành
pane "agent ảo" (`kind: 'pty'`) nên `XtermHost`/input/resize chạy nguyên xi. Terminal pane chỉ có
menu **Zoom + Close terminal**. Đóng khi: shell exit, user Close, đổi workspace, thoát app.

## File structure

| File | Trách nhiệm | Thay đổi |
|---|---|---|
| `src/shared/types.ts` | `TerminalInfo` type | Thêm interface |
| `src/shared/ipc.ts` | Channels + `AgentApi` + `TerminalExitEvent` | Thêm 3 channel invoke + 1 event channel + 3 methods + 1 subscription + 1 event type |
| `src/main/pty-manager.ts` | PTY sessions; phân biệt agent/terminal | Thêm `kind` field, `startTerminal()`, `isTerminal()`, `terminalIds()` |
| `src/main/index.ts` | MainApp: open/close terminal, routing data/exit, cleanup | Thêm helpers + IPC handlers + nhánh terminal trong `pty.on` handlers + cleanup trong `openWorkspace`/`resetActiveProject` |
| `src/preload/index.ts` | Expose `window.api` | Thêm `openFolder`, `openTerminal`, `closeTerminal`, `onTerminalExit` |
| `src/renderer/src/App.tsx` | State terminals; merge pane; add/remove; route remove | Thêm `terminals` state, `addTerminal`, `removeTerminal`, `onRemove` routing, `isTerminal` pass-down |
| `src/renderer/src/components/Sidebar.tsx` | Menu project | Thêm 2 menu items + prop `onOpenTerminal` |
| `src/renderer/src/components/PaneGrid.tsx` | Truyền prop xuống Pane | Thêm `isTerminal` pass-through |
| `src/renderer/src/components/Pane.tsx` | Pane; handleStop branch cho terminal | Thêm `isTerminal` prop + branch `closeTerminal` |
| `src/renderer/src/components/PaneHeader.tsx` | Menu pane | Thêm `isTerminal` prop → menu Zoom + Close terminal |
| `tests/unit/ipc-contract.test.ts` | Guard IPC contract | Thêm 3 methods vào required list + assert 4 channel strings |
| `tests/integration/pty-manager.test.ts` | PTY thật | Thêm test `startTerminal`/`isTerminal`/stop |
| `src/main/terminal-shell.ts` | Pure helper: shell resolution theo platform | **File mới** |

Không đổi: `BackgroundPanel` (terminal không bao giờ backgrounded — `backgrounds[termId]` undefined
nên tự bị lọc khỏi panel), `XtermHost`, `styles.css` (tái dùng class có sẵn).

## Conventions / gotchas (đọc kỹ trước khi code)

- **`buildSpawnCommand` (Windows shim) không dùng cho terminal**: shell là `.exe` thật (`cmd.exe`)
  và cần interactive — spawn trực tiếp `pty.spawn(shell, [], { cwd })`. Đừng bọc qua `cmd /c`.
- **`PtyDataEvent.agentId`** tái dùng cho terminal id — đúng type, chỉ là tên field. Không đổi tên
  (sẽ vỡ mọi render route).
- `stop()` đã idempotent (session không tồn tại → resolve ngay) — `closeTerminal` không cần check.
- `before-quit` đã gọi `mainApp.pty.stopAll()` → terminal tự dọn; **không** thêm cleanup riêng ở đó.
- Main handler `openFolder`: `shell.openPath(p)` trả `string` (rỗng = OK, khác rỗng = message lỗi).
  Wrap thành `Promise<void>`, log lỗi qua `console.error` (không cần toast).
- Label UI tiếng Anh: **"Open Folder"**, **"Open Terminal"**, menu pane: **"Close terminal"**.
- `ipc-contract.test.ts` **bắt buộc cập nhật** khi đổi IPC contract — chạy `npm test` sau mỗi task.

---

## Task 1 — Shared: `TerminalInfo` + IPC contract

**Files:** `src/shared/types.ts`, `src/shared/ipc.ts`

1. `src/shared/types.ts` — thêm (cuối file, cạnh các interface runtime khác):
   ```ts
   export interface TerminalInfo {
     id: string        // "term-<uuid>"
     cwd: string
     name: string      // basename(cwd), tiêu đề pane
     status: 'running' | 'exited'
   }
   ```
2. `src/shared/ipc.ts`:
   - Import `TerminalInfo` từ `./types`.
   - Thêm vào `Channels`:
     ```ts
     ProjectOpenFolder: 'project:open-folder',
     TerminalOpen: 'terminal:open',
     TerminalClose: 'terminal:close',
     EventTerminalExit: 'terminal:exit',
     ```
   - Thêm event type (cạnh `PtyDataEvent`):
     ```ts
     export interface TerminalExitEvent { id: string; exitCode: number | null }
     ```
   - Thêm vào `AgentApi` (gần `openInEditor`):
     ```ts
     openFolder(projectPath: string): Promise<void>
     openTerminal(cwd: string): Promise<TerminalInfo>
     closeTerminal(id: string): Promise<void>
     ```
   - Thêm vào nhóm subscription cuối `AgentApi` (gần `onPtyData`):
     ```ts
     onTerminalExit(cb: (e: TerminalExitEvent) => void): () => void
     ```
3. **Test (TDD — viết trước):** `tests/unit/ipc-contract.test.ts`
   - Thêm `'openFolder'`, `'openTerminal'`, `'closeTerminal'`, `'onTerminalExit'` vào `required`
     list và vào object mock `AgentApi` (phần đầu file, mỗi cái `async () => {}` / `() => () => {}`).
   - Thêm assert channel:
     ```ts
     expect(Channels.ProjectOpenFolder).toBe('project:open-folder')
     expect(Channels.TerminalOpen).toBe('terminal:open')
     expect(Channels.TerminalClose).toBe('terminal:close')
     expect(Channels.EventTerminalExit).toBe('terminal:exit')
     ```
4. Chạy `npx vitest run tests/unit/ipc-contract.test.ts` → pass.
5. Commit: `feat(ipc): terminal open/close + open folder channels`

## Task 2 — `PtyManager`: phân biệt agent/terminal

**Files:** `src/main/pty-manager.ts`

1. `PtySession` thêm field:
   ```ts
   export interface PtySession {
     agentId: string
     name: string
     cwd: string
     process: pty.IPty
     pid: number
     kind?: 'agent' | 'terminal'   // mặc định 'agent'
   }
   ```
2. `start()` — set `kind: 'agent'` khi tạo session.
3. Thêm method:
   ```ts
   startTerminal(id: string, shell: string, cwd: string): PtySession {
     if (this.sessions.has(id)) throw new Error(`Terminal already running: ${id}`)
     if (this.stopping.has(id)) throw new Error(`Terminal is stopping: ${id}`)
     const proc = pty.spawn(shell, [], {
       name: 'xterm-256color', cols: 100, rows: 30, cwd,
       env: { ...process.env } as Record<string, string>
     })
     const session: PtySession = { agentId: id, name: 'terminal', cwd, process: proc, pid: proc.pid, kind: 'terminal' }
     this.sessions.set(id, session)
     proc.onData(data => {
       if (!session.pid) session.pid = proc.pid
       this.emit('data', { agentId: id, data })
     })
     proc.onExit(({ exitCode }) => {
       if (this.sessions.get(id) !== session) return
       this.sessions.delete(id)
       this.emit('exit', { agentId: id, exitCode })
     })
     return session
   }

   isTerminal(id: string): boolean {
     return this.sessions.get(id)?.kind === 'terminal'
   }

   terminalIds(): string[] {
     return [...this.sessions.values()].filter(s => s.kind === 'terminal').map(s => s.agentId)
   }
   ```
   (Logic giống `start()` — có thể tái cấu trúc dùng chung `spawnSession(id, name, cmd, args, cwd, kind)`
   private method nếu thấy gọn hơn; yêu cầu hành vi tương đương.)
4. **Test (TDD):** `tests/integration/pty-manager.test.ts` thêm trong `describe('PtyManager')`:
   - `startTerminal` spawn shell thật: dùng `process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'`,
     cwd = temp dir; chờ data đầu tiên xuất hiện (timeout 10s); assert `pty.isTerminal(id) === true`
     và `pty.terminalIds()` chứa id; `pty.stop(id)`; assert `isRunning` false, `isTerminal` false.
   - `start()` thường → `isTerminal(id) === false`, `terminalIds()` không chứa id agent.
   - (Nhớ push manager vào `managers` để `afterEach` dọn.)
5. Chạy `npx vitest run tests/integration/pty-manager.test.ts` → pass.
6. Commit: `feat(pty): terminal session kind + startTerminal`

## Task 3 — Main: shell resolution helper (file mới)

**File:** `src/main/terminal-shell.ts` (mới)

```ts
export function resolveShell(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return 'cmd.exe'
  return env.SHELL || '/bin/bash'
}
```
(Đặt cạnh `buildSpawnCommand` tư duy — thuần, test được, giữ `pty-manager.ts` không nhận thêm
tham số platform vào `startTerminal`.)

**Test:** `tests/unit/terminal-shell.test.ts` (mới):
- `resolveShell('win32', {})` → `'cmd.exe'`
- `resolveShell('darwin', { SHELL: '/bin/zsh' })` → `'/bin/zsh'`
- `resolveShell('linux', {})` → `'/bin/bash'`
- `resolveShell('linux', { SHELL: '/usr/bin/fish' })` → `'/usr/bin/fish'`

Commit: `feat(main): terminal shell resolution helper`

## Task 4 — Main: `MainApp` open/close terminal + routing + IPC

**File:** `src/main/index.ts`

1. Import `resolveShell` và `randomUUID` (`node:crypto` — đã dùng pattern trong repo), `TerminalInfo` type.
2. Trong constructor, **`pty.on('data')`** — thêm nhánh đầu:
   ```ts
   if (this.pty.isTerminal(agentId)) {
     win?.webContents.send(Channels.EventPtyData, { agentId, data })
     return
   }
   ```
   (Trước `logs.append`/`alerts.onOutput`/`setState`.)
3. **`pty.on('exit')`** — thêm nhánh đầu:
   ```ts
   if (this.pty.isTerminal(agentId)) {
     win?.webContents.send(Channels.EventTerminalExit, { id: agentId, exitCode })
     return
   }
   ```
   (Trước toàn bộ logic agent: hint, logs, `alerts.onExit`.)
4. Thêm methods vào `MainApp` (cạnh `startAgent`/`stopAgent`):
   ```ts
   async openTerminal(cwd: string): Promise<TerminalInfo> {
     const id = `term-${randomUUID()}`
     const name = path.basename(cwd) || cwd
     this.pty.startTerminal(id, resolveShell(), cwd)
     return { id, cwd, name, status: 'running' }
   }

   async closeTerminal(id: string): Promise<void> {
     await this.pty.stop(id)
   }

   closeAllTerminals(): void {
     for (const id of this.pty.terminalIds()) void this.pty.stop(id)
   }
   ```
   (`path` đã import sẵn đầu file.)
5. **Cleanup khi đổi workspace:**
   - `openWorkspace(projectPath)`: thêm `this.closeAllTerminals()` ở đầu (trước khi set activeProject).
   - `resetActiveProject()`: thêm `this.closeAllTerminals()` (cạnh `this.states.clear()`).
   - Không đụng `before-quit` (đã có `pty.stopAll()`).
6. IPC handlers (cạnh `Channels.ProjectOpenInEditor`):
   ```ts
   ipcMain.handle(Channels.ProjectOpenFolder, async (_e, projectPath: string) => {
     const err = await shell.openPath(projectPath)
     if (err) console.error('[meow] open folder failed:', err)
   })
   ipcMain.handle(Channels.TerminalOpen, (_e, cwd: string) => mainApp.openTerminal(cwd))
   ipcMain.handle(Channels.TerminalClose, (_e, id: string) => mainApp.closeTerminal(id))
   ```
7. Chạy `npm run typecheck` → pass.
8. Commit: `feat(main): open folder + runtime terminal sessions`

> Lưu ý test: routing main không unit-test trực tiếp (MainApp nặng, mock pty khó);
> hành vi `isTerminal` đã cover ở Task 2; xác nhận manual ở Task 9.

## Task 5 — Preload: expose 3 API + 1 subscription

**File:** `src/preload/index.ts`

1. Import thêm types: `TerminalInfo` (từ `../shared/types`), `TerminalExitEvent` (từ `../shared/ipc`).
2. Trong `const api: AgentApi` (cạnh `openInEditor`):
   ```ts
   openFolder: (projectPath: string) =>
     ipcRenderer.invoke(Channels.ProjectOpenFolder, projectPath),
   openTerminal: (cwd: string) =>
     ipcRenderer.invoke(Channels.TerminalOpen, cwd),
   closeTerminal: (id: string) =>
     ipcRenderer.invoke(Channels.TerminalClose, id),
   ```
3. Trong nhóm subscription (cạnh `onPtyData`):
   ```ts
   onTerminalExit: (cb: (e: TerminalExitEvent) => void) =>
     subscribe(Channels.EventTerminalExit, cb),
   ```
4. Chạy `npm run typecheck` → pass.
5. Commit: `feat(preload): open folder + terminal api`

## Task 6 — Renderer App: terminals state + merge pane

**File:** `src/renderer/src/App.tsx`

1. Import `TerminalInfo` từ `@shared/types`.
2. State: `const [terminals, setTerminals] = useState<TerminalInfo[]>([])`.
3. `useEffect` (trong effect mount hiện có, cạnh các subscribe khác):
   ```ts
   const offTerminalExit = window.api.onTerminalExit(({ id }) => {
     setTerminals(prev => prev.filter(t => t.id !== id))
     termsRef.current.delete(id)
     buffersRef.current.delete(id)
   })
   // + cleanup offTerminalExit() trong return của effect
   ```
4. Callbacks:
   ```ts
   const addTerminal = useCallback(async (projectPath: string) => {
     if (runtime?.workspace.projectPath !== projectPath) await openWorkspace(projectPath)
     const t = await window.api.openTerminal(projectPath)
     setTerminals(prev => [...prev, t])
   }, [runtime, openWorkspace])

   const removeTerminal = useCallback((id: string) => {
     void window.api.closeTerminal(id)
     setTerminals(prev => prev.filter(t => t.id !== id))
     termsRef.current.delete(id)
     buffersRef.current.delete(id)
   }, [])
   ```
5. `removeAgent` → đổi tên/route: trong `onRemove` handler của PaneGrid cần phân biệt. Đơn giản
   nhất: giữ `removeAgent` nguyên, thêm wrapper:
   ```ts
   const handleRemovePane = useCallback((id: string) => {
     if (terminals.some(t => t.id === id)) removeTerminal(id)
     else void removeAgent(id)
   }, [terminals, removeTerminal, removeAgent])
   ```
   Và truyền `onRemove={handleRemovePane}` cho `PaneGrid`. (`removeAgent` vẫn nhận agentId — terminal
   id không bao giờ lọt vào vì đã route trước.)
6. **Merge pane** — sửa `panes` useMemo:
   ```ts
   const panes: PaneModel[] = useMemo(() => {
     if (!runtime) return []
     const agentPanes = runtime.workspace.agents.map(agent => ({...như cũ...}))
     const terminalPanes: PaneModel[] = terminals.map(term => ({
       agent: { id: term.id, name: term.name, templateId: '__terminal__', cwd: term.cwd, kind: 'pty' as const },
       state: { agentId: term.id, status: 'running' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const },
       git: runtime.git
     }))
     return [...agentPanes, ...terminalPanes]
   }, [runtime, terminals])
   ```
   Deps thêm `terminals`.
7. **Cleanup khi đổi workspace:** trong `openWorkspace` callback, sau `setRuntime(rt)` thêm
   `setTerminals([])`; và dọn `termsRef`/`buffersRef` cho terminal id cũ (filter theo `terminals`
   cũ — hoặc để main `closeAllTerminals` + `EventTerminalExit` tự dọn; nhưng setTerminals([]) là
   bắt buộc để UI không giữ pane chết). Dùng:
   ```ts
   for (const t of terminalsRef.currentTerminals ?? []) ... // đơn giản: setTerminals([]) + xóa termsRef theo list cũ
   ```
   Gọn nhất: trong `openWorkspace`, trước `setRuntime`, lấy `prevTerminals` (qua `setTerminals([])`
   và xóa từng id khỏi `termsRef`/`buffersRef` bằng vòng lặp trên state hiện tại — hoặc thêm tham
   chiếu `terminals` vào deps và loop). **Chọn:** thêm `terminals` vào deps của `openWorkspace`,
   đầu callback: `for (const t of terminals) { termsRef.current.delete(t.id); buffersRef.current.delete(t.id) }`,
   sau đó `setTerminals([])`.
8. Truyền xuống `Sidebar`: prop mới `onOpenTerminal={addTerminal}`.
9. Chạy `npm run typecheck` → pass.
10. Commit: `feat(renderer): terminal panes state + merge`

## Task 7 — Sidebar: 2 menu items

**File:** `src/renderer/src/components/Sidebar.tsx`

1. `Props` thêm `onOpenTerminal: (path: string) => void`; destructure.
2. Trong dropdown, sau "Open in VS Code" button, thêm:
   ```tsx
   <button
     className="menu-item"
     onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}
   >
     Open Folder
   </button>
   <button
     className="menu-item"
     onClick={() => { setOpenProjectMenu(null); onOpenTerminal(ws.projectPath) }}
   >
     Open Terminal
   </button>
   ```
   (Thứ tự: Open → Add Agent → Open in VS Code → Open Folder → Open Terminal → Remove.)
3. Chạy `npm run typecheck` → pass.
4. Commit: `feat(sidebar): open folder + open terminal menu items`

## Task 8 — Pane + PaneHeader: terminal menu

**Files:** `src/renderer/src/components/PaneGrid.tsx`, `Pane.tsx`, `PaneHeader.tsx`

1. `PaneGrid.tsx`:
   - `Props` thêm `isTerminal: (id: string) => boolean` (hoặc `terminalIds: Set<string>`).
     **Chọn:** prop `isTerminal: (id: string) => boolean` — App truyền `id => terminals.some(t => t.id === id)`.
   - Truyền xuống Pane: `isTerminal={isTerminal(pane.agent.id)}`.
2. `Pane.tsx`:
   - `Props` thêm `isTerminal: boolean`.
   - `handleStop` — thêm nhánh:
     ```ts
     const handleStop = useCallback(() => {
       if (isTerminal) void window.api.closeTerminal(id)
       else if (native) void window.api.stopChat(id)
       else void window.api.stopAgent(id)
     }, [id, native, isTerminal])
     ```
   - Truyền `isTerminal={isTerminal}` xuống `PaneHeader`.
3. `PaneHeader.tsx`:
   - `Props` thêm `isTerminal?: boolean` (mặc định `false`).
   - Trong dropdown: nếu `isTerminal` → chỉ render:
     ```tsx
     <button className="menu-item" onClick={() => { close(); onZoom() }}>
       {zoomed ? 'Exit zoom' : 'Zoom'}
     </button>
     <button className="menu-item danger" onClick={() => { close(); onRemove() }}>
       Close terminal
     </button>
     ```
     (thay cho toàn bộ Inject/Log/Stop/Restart/Background/Delete agent; `!native` block bỏ qua —
     terminal không bao giờ native, nhưng `native` prop vẫn undefined → render được; dùng early
     return trong JSX: `{isTerminal ? (<>...</>) : (<>...menu cũ...</>)}`).
4. Chạy `npm run typecheck` → pass.
5. Commit: `feat(renderer): terminal pane menu (zoom + close)`

## Task 9 — Verify tổng thể

1. `npm run typecheck` → pass.
2. `npm test` → pass (toàn bộ unit + integration; ipc-contract đã update).
3. Manual smoke (không bắt buộc e2e — Playwright không cover feature này; chỉ chạy nếu thay đổi
   ảnh hưởng smoke):
   - `npm run dev` → mở app.
   - Sidebar project menu → **Open Folder** mở File Explorer đúng thư mục.
   - **Open Terminal** → pane terminal mở, tiêu đề = tên project, gõ `dir`/`ls` thấy đúng cwd.
   - Menu pane terminal chỉ có Zoom + Close terminal.
   - **Close terminal** → pane biến mất, không process mồ côi (check Task Manager/`tasklist`).
   - Mở terminal rồi đổi project khác → pane terminal biến mất.
   - Thoát app khi còn terminal → process sạch.
   - Mở lại app → không có terminal pane "sống lại" (không lưu).
4. Commit cuối (nếu có fix phát sinh): `chore: verify terminal panes`
5. Cập nhật `docs/superpowers/specs/2026-08-13-...` status → Implemented (nếu muốn).

---

## Tóm tắt commit

1. `feat(ipc): terminal open/close + open folder channels`
2. `feat(pty): terminal session kind + startTerminal`
3. `feat(main): terminal shell resolution helper`
4. `feat(main): open folder + runtime terminal sessions`
5. `feat(preload): open folder + terminal api`
6. `feat(renderer): terminal panes state + merge`
7. `feat(sidebar): open folder + open terminal menu items`
8. `feat(renderer): terminal pane menu (zoom + close)`
