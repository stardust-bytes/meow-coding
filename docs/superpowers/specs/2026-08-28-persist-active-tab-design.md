# Lưu Agent Tab Active Theo Project — Design Spec

Ngày: 2026-08-28 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Khi chuyển project trong sidebar rồi quay lại, hiển thị đúng **agent tab** đang active lần cuối
của project đó, thay vì luôn reset về tab đầu tiên.

Hiện tại `PaneTabs` giữ `activeId` trong local state và mỗi lần panes đổi (chuyển project) nó
nhảy về `panes[0]` — mất vị trí tab khi đi project khác rồi quay lại.

Ngoài phạm vi: lưu tab con chat/trace trong `PaneHeader`, lưu terminal tabs, lưu vị trí tab qua
main process/workspaces.json.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Chỉ agent tab trong tab bar (`PaneTabs`) |
| Nơi lưu | `localStorage`, key `meow.active-tabs` |
| Format | JSON object `{ [projectPath]: agentId }` |
| Điểm khôi phục | Effect trong `PaneTabs` khi panes đổi và activeId không còn hợp lệ |
| Tab bị xóa / chưa lưu | Fallback `panes[0]` |
| Terminal tabs | Không lưu (chúng bị xóa khi chuyển project) |
| Đụng main process | Không — thuần renderer, đúng pattern `meow.rightpanel.*` |
| Test | Typecheck + e2e; tách hàm thuần `restoreActiveTab` nếu test đơn vị |

## 3. Kiến trúc

```
App.tsx                          PaneTabs.tsx
  runtime.workspace.projectPath ─▶ prop projectPath
                                    │
                                    ├─ onClick tab → saveActiveTab(projectPath, id)
                                    │        → localStorage["meow.active-tabs"] = { [path]: id }
                                    │
                                    └─ effect khi panes đổi:
                                         activeId còn trong panes? → giữ
                                         không → restore từ localStorage[projectPath]
                                                 → id tồn tại? → dùng id
                                                 → không → panes[0]
```

### 3.1 `PaneTabs.tsx`

- Thêm prop `projectPath: string | null`.
- Hàm helper module-scope (thuần, test được):

```ts
export function saveActiveTab(projectPath: string | null, agentId: string, storage: Storage = window.localStorage): void
export function restoreActiveTab(
  panes: PaneModel[], projectPath: string | null, storage: Storage = window.localStorage
): string | null
```

- `saveActiveTab`: đọc object hiện có từ `meow.active-tabs`, set `[projectPath] = agentId`, ghi lại.
  `projectPath === null` → no-op.
- `restoreActiveTab`: trả `agentId` nếu `panes.some(p => p.agent.id === agentId)`, ngược lại
  `panes[0]?.agent.id ?? null`.
- Click tab: `setActiveId(id)` + `saveActiveTab(projectPath, id)`.
- Effect hiện có: giữ nguyên nhánh "activeId còn hợp lệ"; thay nhánh fallback bằng
  `setActiveId(restoreActiveTab(panes, projectPath))`.

### 3.2 `App.tsx`

- Truyền `projectPath={runtime?.workspace.projectPath ?? null}` vào `<PaneTabs>`.

## 4. Hành vi biên

| Tình huống | Hành vi |
|---|---|
| Chuyển project khác rồi quay lại | Restore đúng agent tab đã lưu (nếu agent còn tồn tại) |
| Agent được lưu đã bị xóa | Fallback `panes[0]` |
| Project chưa từng lưu | `panes[0]` như cũ |
| Thêm/xóa agent khi đang xem | Giữ tab hiện tại — không nhảy |
| Terminal tab | Không lưu |
| projectPath null (chưa mở project) | No-op khi lưu; restore fallback `panes[0]` |

## 5. Test

- Tách 2 hàm thuần `saveActiveTab`/`restoreActiveTab` (storage inject) → unit test với mock Storage.
- Typecheck + e2e smoke.

## 6. Tiêu chí thành công

- Chuyển project → quay lại → hiển thị đúng agent tab cũ.
- Xóa agent được lưu → không crash, fallback tab đầu.
- Typecheck pass, unit test pass, e2e pass.
