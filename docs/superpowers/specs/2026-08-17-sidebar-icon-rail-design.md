# Meow Coding — Sidebar Collapse to Icon Rail — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user · Bước: sau brainstorm

## 1. Mục tiêu

Cho phép collapse sidebar Projects thành icon rail hẹp (~48px) và expand về full list (268px),
giúp tiết kiệm màn hình khi làm việc sâu. Trạng thái được nhớ qua phiên (localStorage).

## 2. Quyết định đã chốt với user

- **Pattern**: nút chevron icon (approach A) ở góc phải header sidebar; xoay theo trạng thái.
- **Collapsed**: sidebar 268px → ~48px icon rail — mỗi project là avatar chữ cái đầu tên project,
  tooltip hiện tên đầy đủ; click mở project; active project highlight accent. Chỉ còn nút expand
  (Add Project ẩn khi rail vì không có chỗ).
- **Expanded**: hiển thị full list như hiện tại.
- **Persist**: `localStorage` key `meow.sidebar.collapsed` (`'1'`/`'0'`), khởi tạo state từ đó.
- Local state trong Sidebar, không IPC.

## 3. Thiết kế chi tiết

- `Sidebar.tsx`:
  - `const [collapsed, setCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')`
  - `useEffect` persist khi đổi.
  - Header: thêm `<button className="sidebar-toggle" title={collapsed ? 'Expand' : 'Collapse'}>`
    chevron SVG; xoay -180° khi collapsed.
  - Root `<aside className="sidebar ${collapsed ? 'collapsed' : ''}">`.
  - Khi collapsed: render rail — mỗi project `<button className="project-avatar">` chữ cái đầu
    (`ws.name[0]`), `title={ws.name}`, active class, onClick mở project. Ẩn "Add Project".
- `styles.css`:
  - `.sidebar.collapsed { width: 48px; padding: 8px; }` — ẩn `.panel-title`, `.project-info`, nút
    Add Project (`.sidebar-head .btn` display none).
  - `.project-avatar`: 28px circle, mono font, `--bg-active` nền, active → accent border/bg.
  - `.sidebar-toggle`: ghost icon button, hover, chevron transition.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/components/Sidebar.tsx` | state + toggle + rail render |
| `src/renderer/src/styles.css` | `.sidebar.collapsed`, `.project-avatar`, `.sidebar-toggle` |

Không đổi IPC / contract / logic main / class name hiện có.

## 5. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- Manual: collapse → rail; expand → full; active project hiển thị; reload app giữ trạng thái;
  click avatar mở đúng project.

## 6. Out of scope

- Kéo thả resize sidebar (chỉ 2 trạng thái fixed).
- Auto-collapse theo window width.
