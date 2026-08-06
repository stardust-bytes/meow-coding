# Meow Coding — UI/UX Prototype Designer (Figma Make style) : Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Cho phép BA tạo prototype nghiệp vụ và giao diện (kiểu Figma Make) **trước khi viết code logic**.
BA làm việc trong một cửa sổ riêng của app: **chat trái + preview phải**. Prototype được gen bởi một
agent kind `design` thiên về UI/UX, tạo ra **app React + Vite thật, đa màn hình, dùng mock data**, và
được lưu tại `<project>/docs/uiux-design/<name>/`. Khi code frontend thật, meow agent dev chỉ cần lấy
source prototype này dựng thành frontend thật bên ngoài.

Khác biệt với mô tả ban đầu: "Figma Make" chính là cách Figma gen functional prototype + code và preview
bằng **app chạy thật** (không phải ảnh tĩnh) — ta bám sát cách đó.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cửa sổ làm việc | Cả hai: **BrowserWindow thứ 2 trong Electron** (nơi BA chat + chỉnh sửa) + **Open in Browser** (mở tab trình duyệt ngoài chỉ để xem preview mirror, không có chat) |
| Nơi chat | Chỉ trong cửa sổ Electron — browser ngoài không có contextBridge/IPC nên không chat được |
| Framework prototype | React + Vite, full app đa màn hình (react-router + mock data trong `src/data/mock.ts`) |
| Vị trí lưu | `<project>/docs/uiux-design/<name>/` (trong project đang mở) |
| Chat engine | Dùng chung `MeowAgentManager` — agent kind `design` mới (kế thừa tools/undo/redo/session/cost/snapshot) |
| Preview | App chạy thật qua **Vite dev server** (HMR tự cập nhật), panel phải là `<iframe>` load localhost |
| Phân vai | Cửa sổ Electron = BA làm việc; Open in Browser = demo/xem toàn màn hình/DevTools |
| Thêm agent design | Không thêm field UI; **suy từ template** "Design Prototype" (`kind: 'design'`), main tự đặt `cwd = docs/uiux-design/<name>` |
| Tái sử dụng khi code | Nút **Promote to Dev**: inject prompt vào agent dev kèm đường dẫn thư mục prototype |
| Phạm vi MVP | Full cả Open in Browser ngay từ đầu |

## 3. Kiến trúc / luồng dữ liệu

```
┌─────────────────────────────────────────────────────────────┐
│  Electron — main process                                     │
│  ┌───────────────┐   ┌─────────────────────────────┐        │
│  │ MeowAgentManager                                   │      │
│  │  ├─ agent kind 'native'  (dev team, cwd = project) │      │
│  │  └─ agent kind 'design'  (BA, cwd = docs/uiux-design/<name>)│
│  └───────┬───────────────────────────────────────────┘        │
│          │ ChatEvent (IPC)                                    │
│  ┌───────▼──────────┐   ┌───────────────────────────────┐     │
│  │ Main window       │   │ Prototype window (mới)        │     │
│  │ (renderer: sidebar│   │ ┌────────┐  ┌────────────┐   │     │
│  │  /panes/chat)     │   │ │ Chat   │  │ Preview    │   │     │
│  └───────────────────┘   │ │ (design│  │ (iframe -> │   │     │
│                          │ │  agent)│  │  localhost)│   │     │
│                          │ └────────┘  └────────────┘   │     │
│                          └───────────────┬───────────────┘     │
│  PrototypePreviewServer (mới)                                   │
│   ├─ Vite dev server cho prototype (preview trong app)          │
│   └─ HTTP server tĩnh cho "Open in Browser"                     │
└─────────────────────────────────────────────────────────────────┘
```

**Cửa sổ prototype:**
- `BrowserWindow` thứ 2, load cùng bundle renderer với query `?view=prototype` → React app render
  layout "chat trái + preview phải" thay vì sidebar/panes.
- Dùng **chung preload** (`window.api`) — IPC contract tập trung, chỉ thêm channel prototype mới.
- Chat gọi `sendChat(agentId, text)` với agentId của design agent — không cần engine chat mới.
- Preview panel dùng **`<iframe>`** (không dùng `<webview>` — không cần bật `webviewTag`, an toàn hơn).
  Vite server chỉ serve trên localhost, nội dung do chính agent design gen → chấp nhận được.

**Agent design** (`AgentKind` mở rộng thêm `'design'`):
- Template mặc định "Design Prototype" (`kind: 'design'`) trong `default-templates.ts`.
- `AddAgentDialog` giữ nguyên — BA chọn template; main tự đặt cwd thư mục prototype.
- `MeowAgentManager.register()`: agent kind `design` dùng system prompt riêng (thiên về UI prototyping:
  React/Vite, mock data, đa màn hình) + `collectSkills` quét thêm thư mục design-skills riêng
  (chứa skill `ui-ux-pro-max`).
- Tái sử dụng toàn bộ tools/snapshot/session/cost.

**Scaffold prototype** (`src/main/prototype-scaffold.ts`, mới):
- Khi tạo prototype, main scaffold React + Vite tối thiểu trong `docs/uiux-design/<name>/`:
  ```
  <name>/
    package.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx        → react-router, routes theo màn hình
      data/mock.ts   → mock data cho luồng nghiệp vụ
      pages/…        → từng màn hình (agent gen tiếp)
    .meow/           → skills design riêng (ui-ux-pro-max)
  ```
- `npm install` lần đầu (hoặc dùng cache); agent sau đó chỉ gen code + routes.

## 4. IPC mới

Thêm vào `src/shared/ipc.ts` (`Channels` + `AgentApi`), triển khai ở main handler + preload:

- `PrototypeCreate(name, cwd?)` → tạo prototype (scaffold + design agent trong workspace), trả runtime.
- `PrototypeList()` → danh sách prototype của project đang mở.
- `PrototypeOpen(name)` → mở cửa sổ prototype + start preview server, trả preview URL.
- `PrototypeClose(name)` → đóng cửa sổ, stop preview server.
- `PrototypePreviewUrl(name)` → URL hiện tại để renderer đặt vào iframe.
- `PrototypeOpenInBrowser(name)` → build/serve tĩnh + `shell.openExternal`, trả URL.
- `PrototypePromote(name)` → tìm agent dev đầu tiên trong workspace, inject prompt kèm đường dẫn.
- `EventPrototypePreview` → push URL/hot-reload trạng thái khi server sẵn sàng.

## 5. Xử lý lỗi

- `npm run dev` fail (thiếu node_modules / port bận) → preview panel hiện thông báo tiếng Việt prefix
  `[meow]` + hướng dẫn, không crash app. Port bận → Vite tự chọn port khác.
- Agent design thiếu API key → thông báo `[meow]` trong chat panel (pattern sẵn có).
- Scaffold lỗi (npm install fail) → hiện lỗi nhưng vẫn tạo thư mục rỗng để BA tự sửa.
- Đóng cửa sổ prototype → stop preview server (tree-kill, không để process mồ côi); **không kill**
  agent design (giữ session/bối cảnh, giống agent dev).

## 6. Kiểm thử

- `npm run typecheck`, `npm test` pass.
- Unit mới (`tests/unit/`): scaffold prototype tạo đúng cấu trúc; resolve agent kind `design` từ
  template; IPC contract mới.
- Integration (`tests/integration/`): spawn thật 1 prototype + Vite dev server, xác nhận URL trả HTTP 200.
- `npm run build && npm run e2e` không vỡ; thêm smoke: mở prototype window + chat.

## 7. Thay đổi file

- `src/shared/types.ts` — `AgentKind` thêm `'design'`.
- `src/shared/ipc.ts` — channel + method prototype.
- `src/main/default-templates.ts` — template "Design Prototype".
- `src/main/index.ts` — tạo prototype window, handlers mới, khởi tạo PreviewServer.
- `src/main/prototype-scaffold.ts` (mới) — scaffold React + Vite.
- `src/main/prototype-preview-server.ts` (mới) — Vite dev server + HTTP server tĩnh.
- `src/main/meow-agent-manager.ts` — system prompt design + design skills dir.
- `src/preload/index.ts` — expose method mới.
- `src/renderer/src/App.tsx` — route `?view=prototype` render layout prototype.
- `src/renderer/src/components/prototype/*` (mới) — `PrototypeWindow`, `PrototypeChatPanel` (tái dùng
  logic chat), `PreviewPanel`.
- `src/renderer/src/styles.css` — layout 2 cột prototype.

## 8. Tiêu chí thành công

- BA thêm agent "Design Prototype" → mở cửa sổ prototype (chat trái, preview phải).
- BA chat yêu cầu màn hình/luồng → agent gen app React/Vite đa màn hình có mock data, preview hiển thị
  và HMR cập nhật theo từng lần sửa.
- Source prototype nằm tại `<project>/docs/uiux-design/<name>/`, agent dev có thể đọc và dựng frontend
  thật qua nút Promote.
- Open in Browser mở tab trình duyệt xem preview mirror.
- `npm run typecheck`, `npm test` pass; `npm run build && npm run e2e` không vỡ.
