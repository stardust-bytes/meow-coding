# Plan: Browser Navigate Luôn Mở Tab Mới Trong Meow Group

Spec: `docs/superpowers/specs/2026-08-12-browser-navigate-new-tab-design.md`
Ngày: 2026-08-12

## Mục tiêu

- `navigate` luôn mở tab nền mới trong group "Meow", bỏ qua `tabId` — không bao giờ chuyển hướng
  tab đang mở.
- `defaultTabId()` ưu tiên `workingTabId` trước, tab active chỉ là fallback — mọi lệnh mặc định
  không đụng tab user nếu đã có tab làm việc.
- Cập nhật mô tả tool `browser_navigate` cho đúng hành vi mới.

## File structure

| File | Vai trò | Thay đổi |
|---|---|---|
| `src/browser-extension/background.ts` | Extension service worker xử lý lệnh từ bridge | Sửa `navigate` + `defaultTabId()` |
| `src/main/agent/tools/browser.ts` | Định nghĩa tool MCP cho agent | Sửa description `browser_navigate` |
| `tests/unit/browser/agent-tools-browser.test.ts` | Unit test tool layer | Có thể không đổi (assert chỉ forward command) |

Không có test unit cho `background.ts` (extension build bằng esbuild, test thủ công/e2e) — nên phần
verify là `npm run typecheck` + `npm test` + manual smoke.

---

## Task 1: `navigate` luôn mở tab mới trong group "Meow"

**File:** `src/browser-extension/background.ts`

**Bối cảnh:** Case `navigate` hiện tại (khoảng dòng 402-412):

```ts
case 'navigate': {
  const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
  if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
  await chrome.tabs.update(tabId, { url: String(params.url) })
  persistWorkingTab(tabId)
  send({ ok: true, data: { url: params.url } })
  return
}
```

Case `openTab` (khoảng dòng 364-380) là mẫu cần bắt chước:

```ts
case 'openTab': {
  const url = String(params.url ?? '')
  const windowId = await lastFocusedWindowId()
  const tab = windowId != null
    ? await chrome.tabs.create({ url, windowId, active: false })
    : await chrome.tabs.create({ url })
  persistWorkingTab(tab.id ?? null)
  let group: { groupId?: number; groupTitle?: string } = {}
  if (tab.id != null) {
    try {
      group = await addToMeowGroup(tab.id)
    } catch {
      /* group creation failed; the tab itself is still open */
    }
  }
  send({ ok: true, data: { id: tab.id, tabId: tab.id, url: tab.url, ...group } })
  return
}
```

**Sửa:** thay toàn bộ thân case `navigate` bằng luồng giống `openTab`:
- `const url = String(params.url ?? '')` (giữ nguyên, không validate thêm — tool layer đã validate
  `^https?://`).
- Lấy `windowId` từ `lastFocusedWindowId()`, tạo tab với `active: false`.
- `persistWorkingTab(tab.id ?? null)`.
- `addToMeowGroup(tab.id)` bọc try/catch im lặng.
- `send({ ok: true, data: { id: tab.id, tabId: tab.id, url: tab.url, ...group } })`.
- **Không** đọc `params.tabId`, **không** gọi `chrome.tabs.update`.

**Commit:** `feat(browser): navigate always opens a new tab in the Meow group`

---

## Task 2: Đảo ưu tiên `defaultTabId()` — working trước, active fallback

**File:** `src/browser-extension/background.ts`

**Bối cảnh:** hàm `defaultTabId()` hiện tại (khoảng dòng 202-215):

```ts
async function defaultTabId(): Promise<number | undefined> {
  // Prefer the tab the user is looking at; a stale "working" background tab can be
  // discarded/blank and makes read/wait/scroll return empty results.
  const active = await activeTabId()
  if (active != null) return active
  if (workingTabId != null) {
    try {
      const t = await chrome.tabs.get(workingTabId)
      return t.id
    } catch {
      workingTabId = null
    }
  }
  return undefined
}
```

**Sửa:**

```ts
async function defaultTabId(): Promise<number | undefined> {
  // Prefer the agent's working tab so we never hijack the tab the user is
  // looking at; fall back to the active tab only when there is no working tab.
  if (workingTabId != null) {
    try {
      const t = await chrome.tabs.get(workingTabId)
      return t.id
    } catch {
      workingTabId = null
    }
  }
  return activeTabId()
}
```

Cập nhật comment (không thêm comment thừa — comment này giải thích quyết định, giữ ngắn gọn).
Không đổi gì khác — các lệnh `reload`/`read`/`click`/`type`/`select`/`scroll`/`screenshot`/`waitFor`
đã dùng `defaultTabId()` nên tự động hưởng hành vi mới.

**Commit:** `fix(browser): default actions prefer the working tab over the active tab`

---

## Task 3: Cập nhật mô tả tool `browser_navigate`

**File:** `src/main/agent/tools/browser.ts`

**Sửa** description của `browser_navigate` từ:

```
'Navigate the active/visible tab (or the working tab) to a URL (http/https).'
```

thành:

```
'Open a URL in a new background tab of an existing Chrome window, grouped under "Meow". ' +
'Never navigates or hijacks an existing tab. Returns a tabId you can pass as the tabId ' +
'argument of other browser_* tools to act on that tab.'
```

(Giữ schema `{ url }` nguyên vẹn; không thêm tham số.)

**Verify:** `npm run typecheck` + `npm test` (test `agent-tools-browser.test.ts` chỉ assert tên tool,
url validation và forward command — không assert description, nên không cần sửa test).

**Commit:** `docs(browser): update browser_navigate tool description`

---

## Task 4: Verify tổng thể

Chạy:
- `npm run typecheck` — pass.
- `npm test` — pass.

Manual smoke (cần Chrome thật + extension load unpacked từ `out/browser-extension` sau
`npm run build:extension`):
1. Mở tab bất kỳ user đang xem (VD: Gmail).
2. Gọi `browser_navigate` tới URL bất kỳ → xuất hiện tab nền mới trong group "Meow";
   tab user **không bị** chuyển hướng.
3. Gọi `browser_read` không kèm `tabId` → snapshot của **tab mới** (working tab), không phải tab user.
4. Đóng tab mới → gọi `browser_read` → fallback tab active, không crash.
5. Gọi `browser_navigate` kèm `tabId` của tab user → vẫn mở tab mới, tab user không đổi.

Nếu smoke pass → hoàn tất, push branch (nếu có).
