# AGENTS.md — src/main

Electron main process. Nơi duy nhất được spawn/kill process. Sở hữu PTY, stores, services, IPC
handlers và vòng đời app.

## Các file chính

- `index.ts` — `MainApp` điều phối toàn bộ: setState, forward sự kiện `pty:data`/`agent:state`/
  `git:status` ra renderer; `registerIpcHandlers`; window lifecycle; `before-quit` → `pty.stopAll()`.
- `meow-agent-manager.ts` — `MeowAgentManager`: orchestrate agent chat loop, sessions, commands,
  permissions, subagents, MCP/user tools, stats, settings. Nơi duy nhất điều phối native agent.
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
- `notification-service.ts` — native Electron `Notification` cho sự kiện cần input/done.
- `file-suggest.ts` — gợi ý file cho `@`-mention (deep search cả cây project, ignore
  node_modules/.git/out/dist).
- `file-watcher.ts` — watch đệ quy project, lọc text file, gộp thay đổi (debounce 500ms).
- `models-catalog.ts` / `model-variants.ts` — catalog model providers + biến thể (reasoning, pricing).
- `terminal-shell.ts` — `resolveShell`: chọn shell mặc định theo platform.
- `updater.ts` — electron-updater wrapper, phát `UpdaterStatusEvent`.
- `window-chrome.ts` — `getWindowChromeOptions`: title-bar ẩn trên Windows/Linux.
- `connections/` — Model Connections: vault (safeStorage) + account store + provider adapters
  (Claude OAuth, Codex OAuth, API key vault) + quota monitoring.
- `browser/` — BrowserBridge (WS server local + pairing) + Chrome launcher + snapshot format.

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

- Unit: `tests/unit/` — một file test cho một module: pty-spawn-command, terminal-shell,
  window-chrome, updater, models-catalog, model-variants, notification-service, file-suggest,
  file-watcher, git-status-service, alert-service, json-store, log-manager, template-manager,
  workspace-store, meow-agent-manager, ipc-contract, ...
- Integration: `tests/integration/pty-manager.test.ts` (spawn thật qua ConPTY, dùng fixture CLI),
  `agent-stream-overlap.test.ts`, `browser/bridge-flow.test.ts`.
- Chạy: `npm run typecheck`, `npm test`.
