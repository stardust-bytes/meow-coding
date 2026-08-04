# AGENTS.md — src/renderer

React renderer (không có quyền truy cập Node/Electron trực tiếp).

## Cấu trúc

- `index.html` + `src/main.tsx` — entry; render `<App>`; nếu thiếu `window.api` hiện fallback hướng
  dẫn (preload chưa nạp).
- `src/App.tsx` — trung tâm state: workspaces, templates, runtime đang mở; định nghĩa `PaneModel`
  (agent + state + git) cho từng pane.
- `src/components/` — `Sidebar`, `PaneGrid`, `Pane`, `PaneHeader`, `XtermHost`, `EmptyState`,
  `AddProjectDialog`, `AddAgentDialog`, `TemplatesPanel`.
- `src/styles.css` — dark theme coding, spacing theo thang 4px.

## Quy ước

- Mọi truy cập main qua `window.api` (kiểu `AgentApi` từ shared). Không import Node/electron.
- Output đến trước khi xterm mount → buffer trong `buffersRef` (App), flush khi `registerTerminal`
  được gọi. Đừng xóa bỏ cơ chế này.
- Input/resize: xterm `onData`/resize → `window.api.writeInput` / `window.api.resizePty` (qua props
  trong `Pane`).
- Grid + zoom: click pane để zoom full-window, `Esc` thoát (xử lý trong `PaneGrid`).
- Component dạng functional + hooks; khai báo interface `Props` trong cùng file.
- Label UI tiếng Anh. Dùng số liệu tabular-nums khi hiển thị.

## Kiểm thử

- Chưa có unit test renderer; đảm bảo `npm run typecheck` pass và e2e smoke
  (`npm run build && npm run e2e`) không vỡ.
