# Meow Coding — Chuyển PaneGrid sang dạng Tabs (Add Agent): Design Spec

Ngày: 2026-08-27 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Khi thêm một Agent (hoặc mở Terminal từ project menu), thay vì hiển thị dạng
**lưới / split màn hình** (PaneGrid 1–2 cột) như hiện tại, tất cả agents +
terminals trong workspace hiện tại được hiển thị dạng **tabs ngang** (giống tab
trình duyệt): chỉ tab đang active chiếm toàn bộ vùng nội dung còn lại.

1. **Thay thế hoàn toàn** chế độ lưới split bằng tabs (không giữ toggle grid).
2. Mỗi agent / terminal là một tab; tab bar nằm trên cùng vùng `<main>`.
3. Mỗi pane vẫn giữ header riêng (status, git, menu) — tab bar là một dải riêng
   phía trên, không gộp vào header.
4. Giữ nguyên nhóm tính năng: background, menu (Stop/Restart/Inject/Open log/
   Background/Remove), Chat/Trace toggle (native).
5. **Bỏ hẳn mục Zoom** khỏi menu pane (trong chế độ tabs, tab active đã chiếm
   toàn bộ vùng nội dung nên zoom vô nghĩa).

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Component | Đổi tên `PaneGrid` → `PaneTabs`, viết lại logic hiển thị (giữ file cũ nhưng đổi nội dung) |
| Layout | Column: tab bar trên + vùng nội dung dưới; chỉ render pane active |
| Active tab | State `activeId`; mặc định = tab đầu tiên; giữ khi chuyển; xử lý khi danh sách thay đổi (thêm/bớt) |
| Zoom | Bỏ hẳn `zomedId` + prop `zomed`/`onZoom` + mục menu Zoom |
| Tab | Status-dot + tên (+ nút đóng ✕ gọi `onRemove`) |
| Background | Giữ nguyên cơ chế: khi background, pane-body ẩn, hiện badge "click to open"; vẫn là một tab |
| Terminal | Là tab riêng (đã có trong `panes`); đóng tab → `removeTerminal` (đóng PTY) |
| Không tab | Giữ `EmptyState` |
| IPC/main | Không đổi (thuần renderer) |

## 3. Thay đổi chi tiết

### 3.1 `src/renderer/src/components/PaneGrid.tsx` → chuyển thành `PaneTabs.tsx`
- Bỏ `gridTemplateColumns` / `.pane-grid`; dùng container column.
- Bỏ `zomedId` + keydown Escape cho zoom.
- Thêm state `activeId`, khởi tạo từ `panes[0]?.agent.id`.
- `useEffect` giữ `activeId` khi `panes` thay đổi: nếu tab đang active còn tồn
  tại thì giữ; nếu bị xóa thì về tab đầu tiên còn lại.
- Render:
  - `<div className="pane-tab-bar">` chứa các nút tab.
  - Mỗi nút tab: `{status-dot} {name}` + nút đóng (chỉ hiện nút đóng khi hover
    hoặc luôn hiển thị).
  - Một `<Pane>` duy nhất cho tab active.
- Props: giữ `panes`, `backgrounds`, `isTerminal`, `onRemove`,
  `onRegisterTerminal`, `onUnregisterTerminal` (bỏ `onZoom`).

### 3.2 `src/renderer/src/components/Pane.tsx`
- Bỏ props `zomed`, `onZoom` (và việc dùng chúng trong className + PaneHeader).
- Giữ `active`, `onFocus`, `onRemove`, `background`.
- `onClick={onFocus}` → đặt tab active.

### 3.3 `src/renderer/src/components/PaneHeader.tsx`
- Bỏ mục menu "Zoom" / "Exit zoom" (cả hai chỗ trong dropdown).
- Bỏ prop `zomed`; không dùng `zoomed` trong JSX.

### 3.4 `src/renderer/src/App.tsx`
- Đổi import `PaneGrid` → `PaneTabs`.
- Đổi `<PaneGrid ... />` → `<PaneTabs ... />`; bỏ không truyền gì liên quan zoom
  (vốn không truyền ở App).
- Phần còn lại (panes, backgrounds, isTerminal, onRemove, register/unregister)
  giữ nguyên.

### 3.5 `src/renderer/src/styles.css`
- Thêm styles cho `.pane-tab-bar`, `.pane-tab`, `.pane-tab.active`,
  `.pane-tab-close`, `.pane-tab .status-dot`.
- Bỏ hoặc để lại `.pane-grid`/`.zoom-mode` (đang không được dùng; ưu tiên dọn
  để tránh CSS chết).

## 4. Ảnh hưởng
- Người dùng: thêm Agent / mở Terminal → hiển thị dạng tab thay vì chia đôi màn
  hình; mất mục Zoom (line cảnh báo).
- Không phá IPC contract / typecheck (thuần renderer; props nội bộ đổi).

## 5. Kiểm thử
- `npm run typecheck`.
- `npm test`.
- `npm run build && npm run e2e` (kiểm tra `smoke.spec.ts`, `trace-panel.spec.ts`
  — `trace-panel` dùng `.pane-tab` cho Chat/Trace toggle, vẫn giữ nguyên).
- Kiểm tra `PaneGrid` không còn được import/được gọi ở đâu.
