# Meow Coding — Move Settings Button to Sidebar Footer — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user · Bước: sau brainstorm

## 1. Mục tiêu

Di chuyển nút Settings khỏi title bar (app bar) xuống **đáy sidebar**, cố định; danh sách project
scroll trong khoảng còn lại. Title bar chỉ còn brand + drag region.

## 2. Quyết định đã chốt với user

- **Vị trí**: đáy sidebar, cố định (pinned), **chỉ gear icon** (không text), tooltip "Settings".
- **Cấu trúc sidebar** (3 phần):
  - Header cố định (Projects + Add + toggle).
  - Danh sách project scroll (`flex: 1; overflow-y: auto`) — cả 2 chế độ expanded list & collapsed rail.
  - Footer cố định (border-top) chứa gear.
- **Collapsed (rail)**: gear icon centered ở đáy; rail scroll tương tự.
- Handler `onOpenSettings` truyền từ App (cùng handler mở SettingsDialog).

## 3. Thiết kế chi tiết

- `App.tsx`: truyền `onOpenSettings={() => setShowSettings(true)}` xuống `<Sidebar>`.
- `Sidebar.tsx`:
  - Thêm prop `onOpenSettings: () => void`.
  - Render `<footer className="sidebar-footer">` sau list: `<button className="sidebar-settings-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>` với gear SVG.
- `styles.css`:
  - `.sidebar`: `overflow-y: auto` → `overflow: hidden` (container không scroll), giữ flex column.
  - `.project-list`, `.project-rail`: `flex: 1 1 auto; min-height: 0; overflow-y: auto;`.
  - `.sidebar-footer`: `flex: 0 0 auto; border-top: 1px solid var(--hairline); padding: 6px 8px; display: flex; justify-content: center;` (rail) / `justify-content: flex-start` (expanded).
  - `.sidebar-settings-btn`: ghost icon button 20x20, hover highlight, color `--text-dim` → `--text-strong`.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/App.tsx` | truyền `onOpenSettings` cho Sidebar |
| `src/renderer/src/components/Sidebar.tsx` | prop + footer gear |
| `src/renderer/src/components/TitleBar.tsx` | bỏ nút Settings (title bar chỉ brand) |
| `src/renderer/src/styles.css` | scroll structure + footer/gear styles |

Không đổi IPC / contract / logic main.

## 5. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- Manual: sidebar list scroll giữa header/footer; gear mở Settings; rail collapsed vẫn có gear;
  title bar không còn nút Settings.

## 6. Out of scope

- Keyboard shortcut mới (Ctrl+,) — giữ nguyên.
