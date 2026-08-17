# Meow Coding — Todo List Collapse/Expand — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user · Bước: sau brainstorm

## 1. Mục tiêu

Thêm nút collapse/expand cho TODO LIST trong chat panel (native agent Meow). Collapsed chỉ hiện
header + count `x/y`; expanded hiển thị đầy đủ list như hiện tại (in-place, cùng kích thước box,
không đổi layout feed/input).

## 2. Quyết định đã chốt với user

- **Pattern**: nút chevron icon (approach A) cạnh phải header, sau count badge; xoay 180° theo
  trạng thái; `title="Collapse"` / `"Expand"`.
- **Default**: **expanded** (giữ hành vi hiện tại); user tự thu gọn khi cần.
- **Collapsed**: ẩn `<ul class="chat-todos-list">`, chỉ còn header + count.
- State là local `useState` trong ChatPanel (không persist, không IPC).

## 3. Thiết kế chi tiết

- `ChatPanel.tsx`:
  - `const [todosCollapsed, setTodosCollapsed] = useState(false)`
  - Header: thêm nút ghost icon `<button className="chat-todos-toggle" title={todosCollapsed ? 'Expand' : 'Collapse'} onClick={() => setTodosCollapsed(v => !v)}>` với SVG chevron, class `collapsed` khi đang thu gọn (CSS xoay 180°).
  - `<ul>` render có điều kiện `{!todosCollapsed && ...}`.
- `styles.css`:
  - `.chat-todos-toggle`: ghost button (transparent bg, border none), `color: var(--text-dim)`, hover `var(--text-strong)`; chevron `transition: transform 120ms`; `.collapsed` → `transform: rotate(-90deg)` (hoặc dùng ▸/▾ swap).
  - Không đổi box kích thước khi toggle (chỉ ẩn list).

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/components/chat/ChatPanel.tsx` | state + nút chevron + conditional render `<ul>` |
| `src/renderer/src/styles.css` | style `.chat-todos-toggle` + state xoay |

Không đổi IPC / contract / logic main / class name hiện có.

## 5. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- Manual: todo có → mặc định hiện list; click → ẩn còn header+count; click lại → hiện lại; tooltip đổi Collapse/Expand.

## 6. Out of scope

- Persist trạng thái (per-agent/per-session) — chỉ local state phiên.
- Đổi layout/tự động collapse khi có nhiều todo.
