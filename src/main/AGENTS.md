# AGENTS.md — src/main

Electron main process. Nơi duy nhất được spawn/kill process. Sở hữu PTY, stores, services, IPC
handlers và vòng đời app.

## Các file chính

- `index.ts` — `MainApp` điều phối toàn bộ: setState, forward sự kiện `pty:data`/`agent:state`/
  `git:status` ra renderer; `registerIpcHandlers`; window lifecycle; `before-quit` → `pty.stopAll()`.
- `pty-manager.ts` — wrapper node-pty, phát sự kiện `data`/`exit`. `buildSpawnCommand` bọc lệnh
  non-`.exe` qua `cmd.exe` trên Windows (ConPTY không spawn được `.cmd` shim trực tiếp). Dùng
  `tree-kill` để kill cả process tree khi stop.
- `workspace-store.ts` / `template-manager.ts` — CRUD trên `JsonStore<T>` (`userData/workspaces.json`,
  `userData/templates.json`). TemplateManager giữ template mặc định không bị xóa.
- `json-store.ts` — interface `JsonStore<T>` + `createJsonStore` (đọc/ghi file JSON, lỗi parse → `[]`).
- `default-templates.ts` — template mặc định: opencode, claude, aider.
- `log-manager.ts` — append output mỗi agent ra `userData/logs/<agentId>.log`.
- `git-status-service.ts` — `git status --porcelain=v2 -b` (timeout 5s), parse branch + dirty count.
- `alert-service.ts` — phát `idle` sau ngưỡng (mặc định 5 phút) và `exit` (theo exit code).

## Quy ước

- Service thuần (PtyManager, các store/service) không import Electron UI — test được với Vitest.
- Trạng thái agent chỉ đổi qua `MainApp.setState`; renderer chỉ được notify khi có field "visible"
  thay đổi (status/exitCode/alert).
- Event push ra renderer qua `win.webContents.send(Channels.Event*)`; payload phải khớp contract
  trong `src/shared/ipc.ts`.
- Thêm IPC: thêm channel vào `Channels` + method vào `AgentApi` (`src/shared/ipc.ts`), handler trong
  `registerIpcHandlers`, triển khai tương ứng trong preload. Không hardcode channel string.
- Khi agent exit: chèn hint tiếng Việt prefix `[meow]` nếu thoát lỗi (code ≠ 0) và không có output.
- Tránh để process mồ côi: mọi path stop đều đi qua `tree-kill`; kiểm tra sau khi đổi logic stop.

## Kiểm thử

- Unit: `tests/unit/{template-manager,workspace-store,git-status-service,alert-service,json-store,log-manager,ipc-contract}`.
- Integration: `tests/integration/pty-manager.test.ts` (spawn thật qua ConPTY, dùng fixture CLI).
- Chạy: `npm run typecheck`, `npm test`.
