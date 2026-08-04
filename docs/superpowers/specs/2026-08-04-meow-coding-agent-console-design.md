# Meow Coding — Desktop Agent Console: Design Spec

Ngày: 2026-08-04 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Một desktop app cho phép người dùng **chọn thư mục project → mở nhiều CLI coding agent
(opencode, Claude Code, aider, ...) song song → xem và điều khiển tất cả ngay trong một
cửa sổ**, thay vì phải chuyển qua lại giữa nhiều cửa sổ terminal. Đối tượng chính: Windows
(ConPTY), nhưng kiến trúc giữ cross-platform (Linux/macOS) nếu có thể.

## 2. Quyết định từ brainstorm

| Chủ đề | Quyết định |
|---|---|
| Form factor | Desktop app |
| Nền tảng | Electron + React + node-pty + xterm.js (cùng bộ công nghệ VS Code terminal) |
| Tương tác | Nhúng terminal tương tác đầy đủ + thanh quick actions (stop / restart / inject prompt) |
| Loại agent | **Generic command template** — bất kỳ CLI agent nào; người dùng khai báo command |
| Bố cục | **Grid + zoom**: các pane agent hiện cùng lúc; click 1 pane → phóng to làm việc, Esc quay lại |
| Workspace | Sidebar đa project; mỗi project là 1 workspace lưu layout + danh sách agent; mở lại = spawn lại |
| Đóng app | Kill toàn bộ agent (cả process con) |
| Tính năng v1 | Git status badge mỗi pane · trạng thái agent · cảnh báo cần chú ý · lưu log lịch sử ra file |
| Pause/Resume | **Để sau** (Windows ConPTY không có SIGSTOP, cần native helper) — v1 có stop/restart/inject |

## 3. Phạm vi v1

**Có:**
- Thêm/quản lý project (chọn folder), sidebar liệt kê workspace đã lưu.
- Quản lý template agent (CRUD): `{ name, command, args, icon }`, template mặc định cho opencode, claude, aider.
- Spawn agent trong PTY, hiển thị qua xterm.js, gõ input trực tiếp.
- Quick actions: stop, restart, inject prompt.
- Grid pane + resize + zoom toàn màn hình (click header / nút, Esc để thoát).
- Git status badge: branch + số file thay đổi (poll định kỳ khi project mở).
- Trạng thái agent: running / idle / exited (code) / error / spawning.
- Cảnh báo: spawn fail, exit bất thường (code ≠ 0), idle quá ngưỡng (mặc định 5 phút, cấu hình được).
- Log mỗi agent ghi ra file; nút "open log" mở file.
- Đóng app → kill toàn bộ agent tree.

**Không có (để sau):**
- Pause/Resume native trên Windows.
- Diff review đa agent, approval per-agent.
- Restore trạng thái đang chạy sau khi đóng app.
- Tích hợp API/session của riêng opencode (SDK) hay bất kỳ agent cụ thể nào.
- Remote / SSH / giám sát từ máy khác.
- Port sang Tauri.

## 4. Kiến trúc

```
┌─────────────────────────────────────────────────┐
│  RENDERER (React)                                 │
│  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Sidebar      │  │  Grid các Pane Agent      │   │
│  │ • project A  │  │  ┌────┐ ┌────┐ ┌────┐     │   │
│  │ • project B  │  │  │xterm│ │xterm│ │xterm│    │   │
│  │ [+ add]      │  │  └────┘ └────┘ └────┘     │   │
│  └──────────────┘  │  header: badge git/status  │   │
│                    │  toolbar: stop/restart/... │   │
└───────────────────────┬─────────────────────────┘
                        │ IPC (contextBridge/preload)
┌───────────────────────┴─────────────────────────┐
│  MAIN PROCESS                                    │
│  • PtyManager        node-pty spawn/kill/write   │
│  • WorkspaceStore    JSON projects + layouts     │
│  • TemplateManager   CRUD command templates      │
│  • LogManager        output → file               │
│  • GitStatusService  git status poll + parse     │
│  • AlertService      idle/exit/spawn-fail        │
│  • AppLifecycle      before-quit → kill all      │
└─────────────────────────────────────────────────┘
```

Nguyên tắc: **core (PtyManager và các service) tách rời khỏi UI**, giao tiếp qua IPC contract
tập trung trong `src/shared` — sau này có thể port sang Tauri mà không viết lại toàn bộ.

## 5. UI Design Direction (phong cách coding)

- **Dark theme** chuyên coding (palette VS Code Dark+ / One Dark), contrast cao, không nhiều màu thừa.
- **Monospace** cho pane terminal: `Cascadia Mono`, `Fira Code`, `Consolas`, fallback `monospace`; font-size 13px mặc định, có cấu hình.
- **Dense nhưng gọn**: grid pane viền mảnh (1px, màu border phụ), gutter nhỏ, header pane cao ~28px.
- **Header pane**: tên agent + trạng thái (dot màu: xanh = running, vàng = idle, đỏ = exited/error, xám = spawning) + git badge `main ● 3` (branch + số file dirty).
- **Cảnh báo**: badge chuyển đỏ/vàng + glow nhẹ trên header; không popup ồn ào.
- **Quick actions toolbar**: icon nhỏ stop / restart / inject / copy / open log / zoom — tooltip tiếng Anh, UI label tiếng Anh (mã nguồn/terminal tiếng Anh).
- **Grid + zoom**: pane focus có border highlight rõ; zoom = full-window pane, Esc để thoát về grid.
- **Sidebar**: cây project, badge số agent đang chạy, project active được highlight.
- **Empty state**: chưa có project → màn hình hướng dẫn ngắn "+ Add project".
- **Chrome tối giản**: app là công cụ, nội dung chính là terminal; không trang trí.
- Spacing theo thang 4px; số liệu dùng tabular-nums.

## 6. Luồng dữ liệu chính

1. Sidebar chọn project (hoặc "+ Add project" → chọn folder) → IPC `workspace:open`.
2. Main đọc WorkspaceStore → với mỗi agent đã cấu hình: `PtyManager.spawn(template, cwd)`.
3. stdout/stderr → Main: (a) append LogManager ra file, (b) emit `pty:data` → Renderer ghi xterm.js.
4. Gõ phím → xterm.js → `pty:input` → `pty.write(data)`.
5. Quick actions → `pty:stop` (kill + tree-kill), `pty:restart`, `pty:inject` (write prompt + `\n`).
6. GitStatusService poll (5s khi project mở) → `git:status` → cập nhật badge.
7. AlertService theo dõi exit code / idle timer → `alert:update`.
8. Đóng app → `before-quit` → kill toàn bộ process tree.

## 7. Xử lý lỗi

- **Command không tồn tại** (agent chưa cài): pane ở trạng thái `error`, hiện nút Retry, không crash app.
- **cwd không tồn tại**: validate trước spawn, báo lỗi rõ.
- **Agent tự thoát / exit code ≠ 0**: AlertService chuyển badge đỏ, pane cho restart.
- **PTY spawn thất bại** (tài nguyên): pane ở trạng thái `failed`, thông báo.
- **App quit**: `before-quit` + `tree-kill` để không để lại process mồ côi (kể cả process con).

## 8. Kiểm thử

- **Unit (Vitest):** TemplateManager, WorkspaceStore, GitStatusService (parse `--porcelain=v2 -b`), AlertService (heuristic idle/exit).
- **Integration:** fake CLI (script echo loop) — spawn qua PtyManager, assert output tới renderer model, kill, restart; chạy trên ConPTY Windows.
- **E2E (Playwright cho Electron):** mở app, tạo project, spawn agent, gõ input, thấy output, đóng app → agent chết.

## 9. Cấu trúc thư mục

```
meow-coding/
  src/
    main/        # Electron main: pty-manager, workspace-store, template-manager,
                 # log-manager, git-status-service, alert-service, app-lifecycle
    preload/     # contextBridge API
    renderer/    # React: sidebar, grid, pane, xterm-host, toolbar, badges, alerts
    shared/      # types + IPC contract
  tests/         # unit + integration
  resources/     # icon, template defaults (JSON)
  package.json
```

## 10. Tiêu chí thành công

1. Mở app → tạo project → spawn 3 agent khác nhau (opencode, claude, aider) hiển thị đồng thời, gõ được vào từng cái.
2. Grid + zoom hoạt động mượt; resize không vỡ layout xterm.
3. Badge git + trạng thái + cảnh báo hiển thị đúng khi agent đang chạy / idle / thoát lỗi.
4. Đóng app không để lại process mồ côi (kiểm tra Task Manager).
5. Log lịch sử ghi đủ output mỗi agent.
6. Bộ test unit + integration + E2E chạy xanh trên Windows.
