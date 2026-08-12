# Browser Navigate Luôn Mở Tab Mới Trong Meow Group — Design

Ngày: 2026-08-12
Trạng thái: Approved

## Vấn đề

Hiện tại `browser_navigate` (lệnh `navigate` trong Chrome extension bridge) điều hướng **tab
đang active / working tab** — tức là có thể chuyển hướng tab user đang xem, làm gián đoạn công việc
của user trong Chrome. Yêu cầu: khi Meow mở web / navigate thì phải **mở tab mới trong Meow group**,
tuyệt đối không chuyển hướng bất kỳ tab nào đang mở.

## Hành vi mục tiêu

1. `navigate` luôn tạo **tab nền (background) mới** trong group "Meow" (title `Meow`, màu blue),
   giống hệt `openTab` hiện tại — kể cả khi được gọi kèm `tabId` (tham số bị bỏ qua).
2. Tab mới trở thành `workingTabId` (tab làm việc của agent).
3. Khi agent đã có tab làm việc, **mọi lệnh mặc định** (không có `tabId`) ưu tiên `workingTabId`
   thay vì tab user đang xem — không bao giờ đụng tab user nếu đã có tab làm việc.
4. Chỉ khi **không có** tab làm việc hợp lệ mới fallback sang tab active.

## Thay đổi

### 1. Lệnh `navigate` — `src/browser-extension/background.ts`

- Bỏ hoàn toàn nhánh `chrome.tabs.update(tabId, { url })` hiện tại.
- Tái sử dụng luồng của `openTab`:
  - `const tab = await chrome.tabs.create({ url, windowId, active: false })` (windowId từ
    `lastFocusedWindowId()`, `active: false` để không focus Chrome).
  - `persistWorkingTab(tab.id)`.
  - `addToMeowGroup(tab.id)` (bọc try/catch, fail im lặng như `openTab`).
- Response shape đổi thành `{ ok: true, data: { id, tabId, url, groupId, groupTitle } }`
  (cùng shape với `openTab`).
- Tham số `tabId` nếu có: **bỏ qua**, không dùng.

### 2. Đảo ưu tiên `defaultTabId()` — `src/browser-extension/background.ts`

Thứ tự hiện tại (active trước, working sau):

```ts
const active = await activeTabId()
if (active != null) return active
if (workingTabId != null) { ... validate ... }
```

Thứ tự mới (working trước, active fallback):

```ts
if (workingTabId != null) {
  try { const t = await chrome.tabs.get(workingTabId); return t.id }
  catch { workingTabId = null }
}
return activeTabId()
```

Giữ nguyên logic validation: nếu `chrome.tabs.get(workingTabId)` fail (tab đóng / discarded / tabId
stale) → xóa `workingTabId` và fallback tab active.

Các lệnh bị ảnh hưởng (đều dùng `defaultTabId()` khi thiếu `tabId`): `reload`, `read`, `click`,
`type`, `select`, `scroll`, `screenshot`, `waitFor`.

### 3. Mô tả tool — `src/main/agent/tools/browser.ts`

- `browser_navigate`: đổi description thành mở URL trong **tab nền mới** trong group "Meow",
  không bao giờ điều hướng tab đang mở (để agent/LLM hiểu đúng hành vi mới).
- `browser_open_tab`: giữ nguyên (đã đúng).

## Edge cases

| Case | Hành vi |
|---|---|
| `navigate` kèm `tabId` | Bỏ qua `tabId`, vẫn mở tab mới trong group |
| Chưa có tab làm việc + gọi `read`/`click`/... | Fallback tab active (như hiện tại) |
| Tab làm việc bị đóng | `defaultTabId()` tự fallback, không crash |
| Không có Chrome window | `chrome.tabs.create` tạo window mới (giống `openTab`) |
| Group "Meow" chưa tồn tại | `addToMeowGroup` tạo group mới |
| Group creation fail | Tab vẫn mở; response không có groupId (giống `openTab`) |

## Không thay đổi

- `src/shared/browser-types.ts` — `BrowserCommandName` vẫn có `navigate`/`openTab`; params/result
  không cần type mới (result là object lỏng).
- `src/main/browser/bridge.ts` — chỉ forward command, không đổi.
- IPC contract / preload — không đổi.

## Kiểm thử

- `tests/unit/browser/agent-tools-browser.test.ts`: giữ test forward command + url validation cho
  `browser_navigate` (không có gì thay đổi ở tầng tool gọi `bridge.execute('navigate', { url })`).
- Manual smoke (extension build + load unpacked):
  1. `browser_navigate` tới một URL → mở tab nền mới trong group "Meow".
  2. Tab user đang xem **không bị** chuyển hướng.
  3. `browser_read` không kèm `tabId` → đọc chính tab mới (working tab), không đọc tab user.
  4. Đóng tab làm việc → `browser_read` fallback tab active, không crash.
- `npm run typecheck` pass.

## Ghi chú

- Không đổi luồng pairing / heartbeat / snapshot.
- Group "Meow" được tái sử dụng (không tạo group mới mỗi lần) — giữ nguyên logic `meowGroupId()`
  trong `addToMeowGroup`.
