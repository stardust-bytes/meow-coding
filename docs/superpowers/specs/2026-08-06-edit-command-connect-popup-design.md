# Meow Coding — Edit Command + Connect Provider Popup — Design

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

1. **Edit command**: thêm nút edit cho command đã thêm (hiện chỉ có add + remove).
2. **Connect provider qua popup**: thay inline form trong row catalog và manual bằng popup điền
   thông tin rồi submit.

## 2. Hiện trạng

- `CommandsTab.tsx`: list command + nút remove; nút "+ Add command" mở form inline (name/description/
  template) — **không có edit**.
- `ProvidersTab.tsx`: row catalog có inline form (apiKey + baseUrl) khi bấm connect; "+ Connect
  provider" mở `provider-manual` inline (id + key + baseUrl).

## 3. Thiết kế mới

### 3a. Component popup chung `Modal.tsx` (mới)

`src/renderer/src/components/settings/Modal.tsx`:

```tsx
interface Props {
  title: string
  onClose(): void
  children: ReactNode
  submitLabel?: string        // default "Save"
  onSubmit?(): void
  submitDisabled?: boolean
}
```

- Overlay tối + panel giữa (style giống SettingsDialog), tiêu đề, nội dung, footer Cancel/Submit.
- Esc đóng, click overlay đóng.

### 3b. CommandsTab — Add/Edit qua popup

- Nút "+ Add command" → `modal = { mode: 'add' }` → popup Add (trống).
- Mỗi row thêm nút **"edit"** → `modal = { mode: 'edit', command }` → popup Edit với dữ liệu điền sẵn.
  - **Tên command không sửa** (là key) — chỉ description + template (nếu sửa tên → tạo mới + xóa cũ,
    phức tạp; ngoài scope).
- Save → `window.api.saveCommand({ name, description, template })` → refresh → đóng popup.

### 3c. ProvidersTab — Connect qua popup

- Row catalog "connect" → popup: tên provider (read-only) + API key (password) + baseUrl (optional)
  → Submit `connectProvider(id, key, baseUrl)`.
- "+ Connect provider" → popup: field **provider id** + API key + baseUrl → Submit.
- **Xóa** inline `provider-connect-form` trong row + `provider-manual` inline.
- Giữ `connected`/disconnect/models như cũ.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/components/settings/Modal.tsx` | Mới — popup chung |
| `src/renderer/src/components/settings/CommandsTab.tsx` | Add/Edit qua Modal |
| `src/renderer/src/components/settings/ProvidersTab.tsx` | Connect qua Modal, bỏ inline form |
| `src/renderer/src/styles.css` | Style `.modal-overlay`, `.modal`, form rows |

## 5. Không đổi

- Backend IPC: `saveCommand`/`removeCommand`/`connectProvider` đã tồn tại — không đụng shared/main/preload.
- Logic connect/manual hiện tại (connectProvider signature giữ nguyên).

## 6. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build && npm run e2e` — PASS. **E2E phải update** `tests/e2e/smoke.spec.ts` (test "settings
  screen connects a provider"): hiện dùng `.provider-key` + `.provider-connect-form button` (inline)
  → đổi thành: click connect → popup `.modal` → fill `.modal .provider-key` → click `.modal .submit`
- Manual: Add/Edit command qua popup; connect catalog + manual qua popup; Esc đóng.

## 7. Out of scope

- Rename command (sửa tên = key).
- Xác thực API key trước submit.
