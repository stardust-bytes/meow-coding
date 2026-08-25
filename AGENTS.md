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
- `src/renderer` — React UI: sidebar, pane grid, xterm + native-agent chat.
- `src/shared` — types + IPC contract chung. **KHÔNG** import Node/Electron ở đây.
- `src/browser-extension` — Chrome MV3 extension (build riêng bằng esbuild → `out/browser-extension`,
  copy sang `userData/browser-extension/` để Load unpacked trên profile Chrome thật).
- `src/main/browser` — BrowserBridge (WS server local + pairing code) + Chrome launcher/hướng dẫn cài.

Alias `@shared` → `src/shared` (đã cấu hình trong electron.vite.config.ts, vitest.config.ts, tsconfig).

## Lệnh

- `npm run dev` — chạy dev (electron-vite; pre-hook tự build extension).
- `npm run build` / `npm run start` — build / preview (pre-hook tự build extension).
- `npm test` — unit + integration (Vitest).
- `npm run typecheck` — tsc node + web + extension.
- `npm run build:extension` — build Chrome extension (esbuild → `out/browser-extension`).
- `npm run e2e` — Playwright smoke (cần `npm run build` trước).
- `npm run dist` / `dist:dir` / `dist:linux` / `dist:mac` — đóng gói qua electron-builder.
- `npm run regen:models` — regenerate `src/main/models-snapshot.json`.

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
- Browser bridge: chỉ bind `127.0.0.1` (không expose mạng), pairing code bắt buộc trước khi nhận lệnh;
  chạy trên profile Chrome **thật** của user — không tách profile riêng theo project.

## Kiểm thử bắt buộc trước khi hoàn thành

- `npm run typecheck` pass.
- `npm test` pass.
- Nếu ảnh hưởng tới e2e: `npm run build && npm run e2e`.

## Docs

- `docs/superpowers/specs` — design specs; `docs/superpowers/plans` — kế hoạch triển khai.
- `docs/changelog-format.md` — format viết changelog giữa các version (tái sử dụng mỗi release).
- Workflow: brainstorm → spec → plan → thực thi (chi tiết trong docs hiện có).

## AGENTS.md — Documentation Sync Rule

Each module directory has an `AGENTS.md` file describing its purpose, status, key files, API endpoints, dependencies, and TODOs. A sibling `CLAUDE.md` only contains `@AGENTS.md` (Claude Code import syntax).

**ALWAYS** update `AGENTS.md` when any of the following changes occur:
- New or changed business logic (endpoints, service methods, DTOs)
- File structure changes (adding/removing/renaming key files)
- Status changes (SKELETON → PARTIAL → IMPLEMENTED)
- New or changed dependencies (entities, modules, packages)
- TODOs completed or new TODOs to add

Principle: **Code changes → AGENTS.md updated before commit.**

When updating any `AGENTS.md` file:
- **ONLY** modify the entries that reflect the code, structure, status, dependency, endpoint, or TODO items that were actually changed or newly added.
- **DO NOT** rewrite the whole file, **DO NOT** "clean up" unrelated sections, and **DO NOT** change wording just because you prefer different phrasing when the current meaning is still correct.
- **DO NOT** change the existing file format on your own, including heading levels, section order, bullet style, checkbox style, tables, label conventions, indentation, line spacing, and the presentation conventions already used in that specific file.
- If new information must be added, insert it into the correct section using the existing format instead of restructuring the whole file.
- If an existing entry is not affected by the code change, leave it unchanged.
- If the current format seems imperfect but is still consistent, **prefer preserving it**; only adjust formatting when the user explicitly asks for that specific file.
