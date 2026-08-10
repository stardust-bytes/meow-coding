# Sidebar "Projects" Header Background — Design

Ngày: 2026-08-07 · Trạng thái: đã duyệt

## 1. Mục tiêu

Làm nổi bật header "Projects" trong sidebar (phần `.panel-head`) bằng một
background đậm hơn phần content danh sách projects bên dưới, kèm viền dưới
mờ để tách biệt rõ ràng — theo phong cách section header của VS Code.

## 2. Thay đổi

Chỉ 2 file, thuần CSS + thêm 1 class:

1. `src/renderer/src/components/Sidebar.tsx` — đổi `<div className="panel-head">`
   thành `<div className="panel-head sidebar-head">`.

2. `src/renderer/src/styles.css` — thêm rule:

```css
.sidebar-head {
  background: var(--bg);             /* #1e1e1e — tối hơn --bg-panel (#2526) */
  border-bottom: 1px solid var(--hairline);
  margin: -8px -8px 4px;             /* tràn full-width sidebar (padding 8px của .sidebar) */
  padding: 6px 8px;
}
```

## 3. Phạm vi / Không ảnh hưởng

- Dùng class riêng `sidebar-head` thay vì sửa `.panel-head` chung, vì
  `.panel-head` còn được dùng bởi `TemplatesPanel.tsx` — TemplatesPanel giữ nguyên.
- Không đổi layout/semantics; không đổi màu nội dung title.

## 4. Kiểm thử

- `npm run typecheck` pass.
- `npm test` pass.
- Thay đổi renderer → chạy `npm run build && npm run e2e` nếu cần.
