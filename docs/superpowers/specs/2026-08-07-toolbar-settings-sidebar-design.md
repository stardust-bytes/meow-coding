# Toolbar Settings Button + Sidebar Header Simplification

Ngày: 2026-08-07 · Trạng thái: đã duyệt

## 1. Mục tiêu

- Thêm nút **Settings** lên toolbar (title bar), ngay kế bên logo "Meow Coding", hiển thị trên mọi platform.
- Đơn giản hoá header sidebar "Projects": bỏ menu "⋯" (Add project / Templates / Settings), chỉ còn nút text **"Add Project"**.
- Chuyển **Templates** từ sidebar vào Settings (tab "Templates").

## 2. Thay đổi

### 2.1 TitleBar — nút Settings cạnh logo

`src/renderer/src/components/TitleBar.tsx`:
- Thêm prop `onOpenSettings: () => void`.
- Trong `.title-bar-brand`, sau `<span className="title-bar-title">Meow Coding</span>` thêm:

```tsx
<button className="title-bar-toolbar-btn" onClick={onOpenSettings}>⚙ Settings</button>
```

`styles.css` — thêm:

```css
.title-bar-toolbar-btn {
  -webkit-app-region: no-drag;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  padding: 2px 8px;
  margin-left: 8px;
  cursor: pointer;
}
.title-bar-toolbar-btn:hover { color: var(--text-strong); background: var(--bg-hover); }
```

(Quan trọng: title-bar là `-webkit-app-region: drag`, nút phải `no-drag` để click được.)

### 2.2 Sidebar header — chỉ còn "Add Project"

`src/renderer/src/components/Sidebar.tsx`:
- Bỏ menu "⋯" (`MoreIcon` trong header), bỏ state `menuOpen`, `closeMenu`, `showTemplates`, `showSettings`.
- Header thành:

```tsx
<div className="panel-head sidebar-head">
  <span className="panel-title">Projects</span>
  <button className="btn ghost small" onClick={() => setShowAddProject(true)}>Add Project</button>
</div>
```

- Bỏ import/render `TemplatesPanel`; bỏ props `templates`, `onTemplatesChange`.
- Bỏ `showSettings && <SettingsDialog .../>` (Settings render ở App level).
- `handleAddProject` giữ nguyên.

### 2.3 App — nâng Settings lên App level

`src/renderer/src/App.tsx`:
- Thêm state `showSettings`.
- Render `<SettingsDialog onClose={...} projectPath={...} templates={templates} onTemplatesChange={setTemplates} />` bên trong `.app`.
- Truyền `onOpenSettings={() => setShowSettings(true)}` cho `<TitleBar />`.
- Sidebar bỏ props `templates`/`onTemplatesChange`.

### 2.4 Templates vào Settings

- Tạo `src/renderer/src/components/settings/TemplatesTab.tsx`: dựa trên `TemplatesPanel.tsx` (form name/command/args, list, add/remove) nhưng gọi `window.api` trực tiếp và nhận props `templates` + `onChange`.
- Xoá `src/renderer/src/components/TemplatesPanel.tsx` (không còn dùng).
- `SettingsDialog.tsx`: thêm `'templates'` vào `TabId`, tab "Templates", nhận props `templates` + `onTemplatesChange`, render `<TemplatesTab templates={templates} onChange={onTemplatesChange} />`.

## 3. Phạm vi / Không ảnh hưởng

- Không đổi window controls (Linux-only) trong title bar.
- Không đổi behavior AddProjectDialog/AddAgentDialog (AddAgentDialog vẫn nhận `templates` từ App state).
- Không đổi backend/IPC.

## 4. Kiểm thử

- `npm run typecheck` pass.
- `npm test` pass.
- Thay đổi renderer → `npm run build && npm run e2e`.
