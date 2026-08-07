# Sidebar Project Item — Show Path Line Under Name

Ngày: 2026-08-07 · Trạng thái: đã duyệt

## 1. Mục tiêu

Trong sidebar, mỗi item project hiển thị thêm một dòng path mờ hơn bên dưới
tên project. Path hiển thị đầy đủ; nếu quá dài so với width sidebar thì cắt
bằng ellipsis (…); khi hover hiện tooltip chứa full path.

## 2. Thay đổi

Chỉ 2 file:

1. `src/renderer/src/components/Sidebar.tsx` — bọc tên project thành 2 dòng:

```tsx
<div className="project-info">
  <span className="project-name">{ws.name}</span>
  <span className="project-path" title={ws.projectPath}>{ws.projectPath}</span>
</div>
```

(`.project-row` giữ nguyên onClick/onContextMenu; `.project-count` giữ nguyên
bên phải.)

2. `src/renderer/src/styles.css` — thêm:

```css
.project-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.project-path {
  color: var(--text-faint);
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

## 3. Chi tiết

- `title={ws.projectPath}` → tooltip native của trình duyệt/Electron hiện full path khi hover.
- `min-width: 0` + `text-overflow: ellipsis` → path dài bị cắt "...", không đẩy vỡ layout row.
- `.project-path` dùng `--text-faint` (#6e7681) — mờ hơn `--text-dim` (#9d9d9d) của count, và font nhỏ hơn (12px vs 15px).

## 4. Phạm vi / Không ảnh hưởng

- Không đổi hành vi click/context-menu/active highlight của project item.
- Không ảnh hưởng TemplatesPanel hay các phần khác.

## 5. Kiểm thử

- `npm run typecheck` pass.
- `npm test` pass.
- Thay đổi renderer → `npm run build && npm run e2e`.
