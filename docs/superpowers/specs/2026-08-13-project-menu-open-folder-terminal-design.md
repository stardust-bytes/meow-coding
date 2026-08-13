# Project Menu: Open Folder + Open Terminal — Design

Ngày: 2026-08-13
Trạng thái: Approved (design) — chờ review spec

## Vấn đề

Menu dropdown của từng project trong sidebar (`Sidebar.tsx`) hiện chỉ có: Open, Add Agent,
Open in VS Code, Remove. User muốn thêm 2 hành động:

1. **Open Folder** — mở thư mục project trong file manager của OS (Windows Explorer / Finder /
   file manager Linux).
2. **Open Terminal** — mở một cửa sổ terminal (pane) ngay trong app Meow Coding, working
   directory = thư mục project đó.

Yêu cầu đã chốt qua trao đổi:
- "Open folder" = mở trong **File Explorer** (không phải VS Code — vì menu đã có "Open in VS Code").
- "Open terminal" = **pane terminal trong app** (không phải cửa sổ terminal OS riêng).
- Terminal là session **tạm (runtime-only), không lưu** vào `workspaces.json` (Approach 1).

## Hành vi mục tiêu

1. Menu project có thêm 2 mục: **Open Folder** và **Open Terminal** (thứ tự: Open → Add Agent →
   Open in VS Code → Open Folder → Open Terminal → Remove).
2. **Open Folder**: mở thư mục `projectPath` trong file manager mặc định của OS. Không đổi
   workspace active, không spawn process nào trong app.
3. **Open Terminal**: mở 1 pane terminal trong app với shell mặc định của OS, `cwd = projectPath`.
   - Nếu project chưa phải workspace đang mở → mở project đó trước, rồi tạo terminal.
   - Pane terminal hiển thị cùng grid với các agent pane, có thể gõ lệnh, resize, nhận output.
   - Khi shell thoát (exit) → pane bị xóa khỏi UI.
   - Khi đổi workspace khác hoặc thoát app → toàn bộ terminal session bị đóng (tree-kill).
   - Terminal **không** được lưu vào `workspaces.json`, không có template, không có log file,
     không kích hoạt alert/logic "[meow] Agent thoát...".
4. Pane terminal trong `PaneHeader` chỉ hiển thị các hành động có nghĩa: **Zoom** và
   **Close terminal** (đóng + xóa pane). Vì shell exit tự xóa pane nên "Stop" và "Delete" sẽ trùng
   nghĩa → gộp thành một hành động duy nhất. Ẩn Inject / Log / Restart / Toggle Background /
   "Delete agent" (nhãn agent không hợp nghĩa với terminal).

## Kiến trúc

### Flow

```
Sidebar (menu item Open Terminal)
  → window.api.openTerminal(projectPath)            [renderer → preload → main]
  → MainApp.openTerminal(cwd) → pty.startTerminal(id, shell, cwd)   [main]
  → trả về TerminalInfo { id, cwd, name, status }   [main → renderer]
  → App thêm vào state terminals[], merge thành pane (agent ảo)
  → XtermHost mount, input/resize qua pty:input / pty:resize (key = terminal id)
  → data từ EventPtyData (key = terminal id) hiển thị như bình thường
  → shell thoát → main gửi EventTerminalExit → App xóa pane
```

### Shell mặc định theo platform

- `win32`: `cmd.exe` (spawn trực tiếp, **không** qua `buildSpawnCommand` — không cần `/c` wrapper
  vì đã là `.exe`, và cần shell interactive).
- `darwin`/`linux`: `process.env.SHELL || '/bin/bash'`.
- Gọi `pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: projectPath, env })`.

## Thay đổi

### 1. `src/shared/ipc.ts`

- Thêm channel:
  - `ProjectOpenFolder: 'project:open-folder'`
  - `TerminalOpen: 'terminal:open'`
  - `TerminalClose: 'terminal:close'`
  - `EventTerminalExit: 'terminal:exit'`
- Thêm vào `AgentApi`:
  - `openFolder(projectPath: string): Promise<void>`
  - `openTerminal(cwd: string): Promise<TerminalInfo>`
  - `closeTerminal(id: string): Promise<void>`
- Thêm event `TerminalExitEvent { id: string; exitCode: number | null }` và subscription
  `onTerminalExit(cb): () => void`.
- Tận dụng lại (không thêm): `PtyInput`, `PtyResize`, `EventPtyData`.

### 2. `src/shared/types.ts`

```ts
export interface TerminalInfo {
  id: string        // "term-<nanoid>"
  cwd: string
  name: string      // basename(cwd), dùng làm tiêu đề pane
  status: 'running' | 'exited'
}
```

### 3. `src/main/pty-manager.ts`

- `PtyManager` đang key session theo `agentId` và emit `data`/`exit` theo `agentId`.
  Giữ nguyên cho agent; thêm khả năng terminal:
  - Thêm field `kind?: 'agent' | 'terminal'` vào `PtySession` (mặc định `'agent'`).
  - `startTerminal(id: string, shell: string, cwd: string): PtySession` — spawn shell interactive
    (không qua `buildSpawnCommand`), set `session.kind = 'terminal'`.
  - `isTerminal(id: string): boolean`.
  - `stop(id)` (đã có tree-kill) tái sử dụng cho terminal — không cần method riêng.
  - `stopAll()` (đã có, dùng trong `before-quit`) tự bao gồm terminal session.

### 4. `src/main/index.ts`

- Helper trong `MainApp`:
  - `openTerminal(cwd)`: sinh id `term-<random>`, `pty.startTerminal(...)`, trả `TerminalInfo`.
  - `closeTerminal(id)`: `pty.stop(id)`.
  - `closeAllTerminals()`: đóng hết terminal session hiện có (duyệt `pty` sessions, lọc
    `isTerminal` → `stop`).
- Trong constructor, `pty.on('exit')`: nếu `pty.isTerminal(agentId)` → gửi
  `EventTerminalExit { id, exitCode }` và **không** chạy nhánh agent (log hint "[meow] Agent
  thoát...", `alerts.onExit`, `setState`).
- `pty.on('data')`: nếu là terminal → vẫn `win?.webContents.send(Channels.EventPtyData, ...)` nhưng
  **bỏ qua** `logs.append` / `alerts.onOutput` / `setState`.
- `openWorkspace(projectPath)`: gọi `closeAllTerminals()` ở đầu (terminal là session runtime gắn
  với view project; agent PTY giữ nguyên như hành vi hiện tại).
- `resetActiveProject()`: gọi `closeAllTerminals()`.
- `before-quit` đã có `mainApp.pty.stopAll()` → terminal được dọn tự động, không cần thêm.
- IPC handlers mới:
  - `ipcMain.handle(Channels.ProjectOpenFolder, (_e, p) => shell.openPath(p))`
  - `ipcMain.handle(Channels.TerminalOpen, (_e, cwd) => mainApp.openTerminal(cwd))`
  - `ipcMain.handle(Channels.TerminalClose, (_e, id) => mainApp.closeTerminal(id))`

### 5. `src/preload/index.ts`

- Implement 3 API mới qua `ipcRenderer.invoke`.
- `onTerminalExit`: dùng `subscribe` sẵn có, subscribe `Channels.EventTerminalExit`.

### 6. `src/renderer/src/App.tsx`

- State mới `terminals: TerminalInfo[]`.
- `useEffect` subscribe `window.api.onTerminalExit` → xóa terminal đó khỏi state + dọn
  `termsRef`/`buffersRef`.
- `addTerminal(projectPath)`:
  - nếu `runtime?.workspace.projectPath !== projectPath` → `openWorkspace(projectPath)` trước;
  - `const t = await window.api.openTerminal(projectPath)`; thêm vào `terminals`.
- `removeTerminal(id)`: `window.api.closeTerminal(id)` + xóa khỏi state + xóa khỏi
  `termsRef`/`buffersRef`. (Exit event cũng xóa — idempotent, `setTerminals` filter an toàn.)
- `onRemove(id)` hiện tại là `removeAgent` — đổi thành: nếu id là terminal → `removeTerminal(id)`,
  ngược lại → `removeAgent(id)`. Có thể check qua `terminals.some(t => t.id === id)`.
- Merge pane: `panes = [...agentPanes, ...terminals.map(term => agent ảo)]`:
  ```ts
  {
    agent: { id: term.id, name: term.name, templateId: '__terminal__', cwd: term.cwd, kind: 'pty' },
    state: { agentId: term.id, status: 'running', exitCode: null, lastOutputAt: null, alert: 'normal' },
    git: runtime.git
  }
  ```
- Pass `isTerminal` xuống `PaneGrid` → `Pane` → `PaneHeader` (`isTerminal = id.startsWith('term-')`
  hoặc qua check `terminals`).
- Khi `openWorkspace` đổi project → set `terminals = []` + dọn `termsRef`/`buffersRef` cho terminal
  id (main đã `closeAllTerminals`).

### 7. `src/renderer/src/components/Sidebar.tsx`

- Thêm 2 mục menu:
  - **Open Folder**: `void window.api.openFolder(ws.projectPath)`; đóng menu.
  - **Open Terminal**: `onOpenTerminal(ws.projectPath)` (prop mới từ App); đóng menu.
- `Props` thêm `onOpenTerminal: (path: string) => void`.

### 8. `src/renderer/src/components/Pane.tsx` + `PaneHeader.tsx`

- Prop mới `isTerminal?: boolean` (mặc định `false`) ở cả `Pane` và `PaneHeader`.
- `Pane` khi `isTerminal`:
  - `handleStop` → `window.api.closeTerminal(id)` (không qua `stopAgent`).
  - Không gọi `handleRestart`/`handleInject`/`handleOpenLog`/`handleToggleBackground`
    (ẩn menu tương ứng ở header).
- `PaneHeader` khi `isTerminal`: menu chỉ gồm **Zoom** và **Close terminal** (danger, gọi `onRemove`
  → App route `removeTerminal`); ẩn Inject/Log/Stop/Restart/Toggle Background/"Delete agent".
- `XtermHost` hoạt động không đổi (id = terminal id → input/resize/data route đúng).
- `PaneGrid`/`BackgroundPanel` truyền `isTerminal` xuống; terminal pane không bao giờ backgrounded
  (`backgrounds[termId]` luôn undefined).

### 9. Styles (`src/renderer/src/styles.css`)

- Không cần style mới đáng kể: tái dùng `.sidebar-menu-dropdown`, `.menu-item`, `.pane`, `.pane-menu-dropdown`.
- Có thể thêm icon nhỏ cho 2 mục mới nếu muốn (không bắt buộc).

## Quyết định & trade-off

- **Không lưu terminal vào workspace**: tránh rác trong `workspaces.json`, không cần template,
  restart app không "sống lại" terminal cũ. Đánh đổi: cần plumbing mới (IPC + merge pane).
- **Terminal id dùng chung hạ tầng PTY data/input/resize**: render route theo id sẵn có, không
  nhân đôi luồng xterm.
- **Phân biệt terminal vs agent ở main qua `PtySession.kind`**: giữ logic agent (logs/alerts/
  setState) không đổi, terminal đi nhánh riêng.
- **`cmd.exe` trên Windows spawn trực tiếp**: vì là `.exe` thật, không qua `buildSpawnCommand`
  (cái đó dành cho shim `.cmd` của CLI agent, cần `/c` wrapper).

## Kiểm thử

- Unit test cho helper main: `openTerminal` trả `TerminalInfo` đúng id/name;
  `closeTerminal` dừng session; `closeAllTerminals` dừng hết terminal (không đụng agent session).
- Unit test shell resolution (win32 → `cmd.exe`, non-win32 → `$SHELL`/`/bin/bash`).
- Unit test: main route `pty.on('exit')` cho terminal gửi `EventTerminalExit` và không chạy nhánh
  agent (mock PtyManager).
- `npm run typecheck` pass; `npm test` pass.
- Không đụng e2e smoke (không cần `npm run e2e` trừ khi thay đổi ảnh hưởng Playwright flow).
- Manual: mở menu project → Open Folder mở Explorer; Open Terminal mở pane, gõ lệnh được, đóng
  bằng "Close terminal", đổi workspace thì terminal biến mất, thoát app không để process mồ côi.
