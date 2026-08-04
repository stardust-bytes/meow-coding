# AGENTS.md

Meow Coding — desktop app (Electron + React) quản lý nhiều CLI coding agent (opencode, Claude Code,
aider, ...) chạy song song trong các pane terminal trên một cửa sổ.

## Công nghệ

- Electron 41 + electron-vite 5 + React 19 + TypeScript (strict).
- PTY: `@lydell/node-pty`; terminal UI: `@xterm/xterm` + `@xterm/addon-fit`.
- Test: Vitest (unit + integration), Playwright (e2e).

## Cấu trúc

3 tiến trình tách biệt, giao tiếp qua IPC contract tập trung:

- `src/main` — main process: PTY, stores, services, IPC handlers, vòng đời app.
- `src/preload` — contextBridge, expose `window.api` (implement `AgentApi`).
- `src/renderer` — React UI: sidebar, pane grid, xterm.
- `src/shared` — types + IPC contract chung. **KHÔNG** import Node/Electron ở đây.

Alias `@shared` → `src/shared` (đã cấu hình trong electron.vite.config.ts, vitest.config.ts, tsconfig).

## Lệnh

- `npm run dev` — chạy dev (electron-vite).
- `npm run build` / `npm run start` — build / preview.
- `npm test` — unit + integration (Vitest).
- `npm run typecheck` — tsc node + web.
- `npm run e2e` — Playwright smoke (cần `npm run build` trước).

## Cài đặt trên Windows

- Sau `npm install`, nếu thiếu binding native cho node-pty:
  `npx @electron/rebuild -f -w @lydell/node-pty`.
- node-pty dùng prebuilds; đừng sửa code node-pty trực tiếp.
- Trên Windows (ConPTY), lệnh non-`.exe` (opencode, claude, ... chỉ là `.cmd` shim) phải được bọc qua
  `cmd.exe` — xem `buildSpawnCommand` trong `src/main/pty-manager.ts`. Đừng phá vỡ logic này.

## Quy ước

- IPC: **không hardcode** channel string; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- Dữ liệu bền: `userData/templates.json`, `userData/workspaces.json`; log mỗi agent trong
  `userData/logs/<agentId>.log`.
- Chỉ main process được spawn/kill process; renderer truy cập mọi thứ qua `window.api`.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. Không expose
  `ipcRenderer` ra window.
- Ngôn ngữ: mã nguồn + UI label tiếng Anh; thông báo system-style từ main dùng tiếng Việt, prefix
  `[meow]`.
- Không thêm comment thừa; chỉ comment khi giải thích quyết định phức tạp (VD: Windows shim, tree-kill).
- Agent thoát phải được xử lý: kill cả process tree (`tree-kill`), không để process mồ côi.

## Kiểm thử bắt buộc trước khi hoàn thành

- `npm run typecheck` pass.
- `npm test` pass.
- Nếu ảnh hưởng tới e2e: `npm run build && npm run e2e`.

## Docs

- `docs/superpowers/specs` — design specs; `docs/superpowers/plans` — kế hoạch triển khai.
- Workflow: brainstorm → spec → plan → thực thi (chi tiết trong docs hiện có).
