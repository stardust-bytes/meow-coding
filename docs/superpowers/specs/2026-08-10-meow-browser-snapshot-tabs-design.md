# Meow Coding — Browser Snapshot & Tab Management: Design Spec

Ngày: 2026-08-10 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Cải tiến tính năng browser control (extension MV3 + BrowserBridge) theo chuẩn bigtech, gồm 4 mục tiêu:

1. **Snapshot element nhanh + ổn định**: thay cơ chế `collectInteractive()` (gọi `innerText` từng element —
   chậm) bằng **cây ARIA lồng nhau** dựng từ a11y engine (`getComputedRole`/`getComputedName` — không gây
   layout), kèm **ref** ổn định để tương tác (kiểu Playwright `ariaSnapshot` AI-mode `[ref=e2]`, Claude on
   Chrome, WebArena).
2. **Không mở window Chrome mới từ hành động LLM**: tab mới luôn mở **background** trong window sẵn có;
   chỉ tạo window mới khi Chrome chưa có window nào.
3. **Tab group "Meow"** như Claude Code: mọi tab LLM mở được nhóm vào 1 tab group để dễ quản lý.
4. **Screenshot tab ngầm full-page không cướp focus** (kiểu extension "full page screenshot"): chụp bằng
   CDP qua `chrome.debugger`, không đổi tab, không focus window.

## 2. Vấn đề hiện tại

| Vấn đề | Nguyên nhân gốc |
|---|---|
| Tìm element rất chậm | `collectInteractive()` gọi `el.innerText` **cho từng element** → mỗi lần `innerText` Chrome layout lại; hàng trăm element = hàng trăm lần layout. Cộng thêm `root.innerText` toàn trang (thêm 1 layout). |
| Selector dễ gãy | `uniqueSelector()` sinh path `tag:nth-of-type` (depth 5) — DOM đổi là hỏng. Không có ứng viên fallback; button icon không có name (bỏ sót `aria-label`/`alt`/`placeholder`). |
| Không có handle ổn định | Agent phải re-query bằng selector string mỗi lần click; snapshot không gắn ref → không resolve được element đúng khi DOM dịch chuyển. |
| LLM có thể mở window Chrome mới | `openTab` → `chrome.tabs.create({url})` không ép `windowId` → mở ở window "last focused" hoặc tự tạo window mới. `openChrome` (launcher) spawn `--new-window` → luôn window mới. |
| Screenshot cướp focus | `chrome.tabs.captureVisibleTab` chỉ chụp tab **active + cửa sổ hiện tại** → phải đổi tab/focus window, phá vỡ trải nghiệm "user tự do làm việc khác". |

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cơ chế snapshot | **Cây ARIA lồng nhau** (`{role, name, ref?, children[]}`) dựng bằng `getComputedRole()`/`getComputedName()` — đọc thẳng a11y tree của Chrome, **không gây layout**. Fallback derive role/name thủ công cho Chrome < 119. |
| Định dạng trả về | Cây ARIA lồng nhau kiểu Playwright `ariaSnapshot`, serialize thành text indent lồng nhau cho LLM; ref gán cho node tương tác được. |
| Tương tác | **Ref-based** (ưu tiên) → `selector` → `x,y` fallback. `browser_click`/`type`/`select` nhận thêm `ref`. |
| Ref lifecycle | Content script giữ `Map<ref, Element>` của tab hiện tại. Ref hợp lệ cho tới khi navigate/read mới. Ref không còn hợp lệ → lỗi "snapshot stale — re-read". |
| Working tab | Background duy trì **working tab** (tab cuối agent mở qua `openTab` hoặc đọc qua `read`). Command không kèm `tabId` chạy trên working tab (không dựa vào active tab vì tab mở background). |
| Screenshot | CDP qua `chrome.debugger`: attach tạm tab đích → `Page.enable` → `Page.captureScreenshot {format:'png', captureBeyondViewport:true}` → detach. Chụp **full-page**, kể cả tab ngầm, không đổi tab/focus. |
| Mở tab | `openTab` mở tab **background** trong window sẵn có (window gần nhất được focus/active); chỉ `chrome.windows.create` khi không có window nào. |
| Tab group | Tab LLM mở được đưa vào group duy nhất **"Meow"** (màu `blue`), tự tạo group nếu chưa có. `listTabs` trả kèm `groupId`/`groupTitle`. |
| switchTab | Chỉ `tabs.update({active:true})` — **không** `windows.update({focused:true})` → không giật focus OS. |
| Launcher | Bỏ `--new-window` khi spawn Chrome (`chrome.exe chrome://extensions`) → Chrome đang chạy sẽ mở tab trong window sẵn có; chỉ window mới khi Chrome chưa chạy. |
| Permission manifest | Thêm `debugger`, `tabGroups`. |
| Giới hạn snapshot | ~200 node, name/text truncate 80–120 chars, toàn trang text lấy **một** lần `body.innerText` (1 layout) có cap. |

## 4. Kiến trúc / luồng dữ liệu

```
LLM ── browser_read ──▶ BrowserBridge.execute ── WS ──▶ background ── tabs.sendMessage ──▶ content script
                                                                       │
        content script: build ARIA tree (role+name, không layout),     │
        gán ref, lưu Map<ref, Element> ── result (tree JSON) ◀─────────┘

LLM ── browser_click {ref: r4} ──▶ bridge ── WS ──▶ background ── sendMessage(click, ref)
        content script: resolve ref → element (isConnected check) → scrollIntoView → click
        return result ◀───────────────────────────────────────────────┘

LLM ── browser_open_tab {url} ──▶ bridge ── WS ──▶ background:
        chọn window sẵn có → tabs.create({url, windowId, active:false})
        → group "Meow" (tabs.group + tabGroups.update) → set working tab
        → return {tabId, groupId}

LLM ── browser_screenshot ──▶ background: debugger.attach(tabId)
        Page.captureScreenshot(captureBeyondViewport:true) → detach → base64
```

Lệnh mở/đọc tab → background set **working tab** (lưu trong background, kèm theo kết nối WS). Tab ngầm
không active — content script vẫn chạy và nhận `tabs.sendMessage` bình thường.

## 5. Snapshot engine (content script)

File `src/browser-extension/content.ts`, thay `collectInteractive()`.

- **Traverse**: duyệt cây từ `document.body` một lần (pre-order), bỏ qua `script`/`style`/`template`/ẩn
  (`hidden`, `display:none` heuristic), `[aria-hidden="true"]`.
- **Role**: `getComputedRole(el)` (Chrome 119+). Fallback: map từ tag (`a`→`link`, `button`→`button`,
  `input[type]`→`textbox`/`checkbox`/... , `select`→`combobox`, `[role]` dùng thẳng) cho Chrome cũ.
- **Name**: `getComputedName(el)` — ưu tiên `aria-label`, `aria-labelledby`, alt, placeholder, value,
  `title`, rồi `textContent` (không dùng `innerText` — không layout). Truncate ~80 chars.
- **Giữ node nếu**: role meaningful (không phải `generic`/`none`/`presentation`), **hoặc** có text ngắn
  (node text → `{role:'text', name:...}`), **hoặc** là form control / có `aria-*`. Bỏ node rỗng trùng lặp.
- **Ref**: gán `ref` (`r1`, `r2`, ...) cho node tương tác được (button/link/input/select/textarea/`[role]`
  actionable). Lưu `Map<ref, Element>`.
- **Cap**: `maxElements` (đổi nghĩa từ "số element phẳng" → **số node tối đa trong cây**, mặc định 200,
  `0` = không giới hạn, tối đa 500). Depth không giới hạn riêng.
- **Toàn trang text**: giữ `body.innerText` **một** lần, truncate (giữ `MAX_READ_CHARS`).
- **Serialize**: trả JSON tree về background; tool `browser_read` in dạng text indent lồng nhau:

  ```
  document "Acme — Help"
    text "Welcome to Acme help"
    nav "Main"
      link "Docs" [r1]
      button "Chat with us" [r4]
        text "Ask anything"
  ```

- Thêm command `snapshotRefs`? Không — ref nằm sẵn trong tree của `read`. Không cần command riêng.

## 6. Interaction model (content script + tools)

- `click`/`type`/`select` nhận `ref` (string) hoặc giữ `selector`/`x,y` như cũ. Thứ tự ưu tiên: `ref` →
  `selector` → `x,y`.
- Resolve ref: lấy từ `Map<ref, Element>`; kiểm tra `isConnected`; không có → lỗi
  `snapshot stale: re-read the page` (kèm gợi ý).
- Background route: `params.tabId ?? workingTabId` (thay `activeTabId` làm mặc định).
- Tools:
  - `browser_click`/`browser_type`/`browser_select`: schema + `ref` (optional string).
  - `browser_read`: `{selector?, maxElements?}` → trả tree text + page summary. (Không có param `tabId` — việc chọn tab đích do **working tab** xử lý: command không kèm `tabId` chạy trên tab cuối agent mở/đọc, kể cả `navigate`/`reload`.)
  - `browser_open_tab`: `{url, tabId?}` → trả `{tabId, groupId, groupTitle}`.
  - `browser_list_tabs`: thêm `windowId`, `groupId`, `groupTitle`.
  - `browser_switch_tab`: `{tabId}` → active:true (không focus window).

## 7. Screenshot tab ngầm (CDP)

- `browser_screenshot` trong background: target = `params.tabId ?? workingTabId ??` tab active hiện tại
  (last resort).
- Luồng: `chrome.debugger.attach({tabId}, '1.3')` → `chrome.debugger.sendCommand({tabId}, 'Page.enable')` →
  `Page.captureScreenshot {format:'png', captureBeyondViewport:true, fromSurface:true}` → detach.
- Kết quả base64 → bridge lưu PNG (`userData/browser-screenshots/`) → trả path (giữ nguyên cơ chế hiện tại).
- Lỗi rõ ràng khi tab là `chrome://`, Chrome Web Store, page không CDP được (`debugger` không attach).
- **UX trade-off đã chốt**: attach `chrome.debugger` hiện infobar nhỏ "<extension> đang debug" trong lúc
  chụp — chấp nhận được (giống các extension full-page screenshot). Không đổi tab, không focus window.

## 8. Tab management (background + launcher)

Background `src/browser-extension/background.ts`:

- **Chọn window**: `chrome.windows.getAll({populate:false})` → ưu tiên window đang `focused`, rồi window
  `lastFocused` mới nhất; nếu rỗng → `chrome.windows.create({url})`.
- **openTab**: `tabs.create({url, windowId, active:false})` → thêm vào group Meow:
  `tabIds=[tab.id]` → `tabs.group({tabIds})` (tự tạo group nếu chưa có id → groupId) →
  `tabGroups.update(groupId, {title:'Meow', color:'blue'})`. Set working tab.
- **workingTabId**: lưu biến trong background, set khi `openTab`, `read`, `openTab` thành công.
- **listTabs**: query `chrome.tabs.query({})` + map groupId → title/color qua `chrome.tabGroups.get(id)`;
  trả `{id, title, url, active, windowId, groupId, groupTitle}`.
- **switchTab**: `tabs.update(tabId, {active:true})` — không `windows.update(focused:true)`.
- **navigate**: giữ ngữ nghĩa cũ (update URL tab có sẵn), không đổi window/group.

Launcher `src/main/browser/chrome-launcher.ts`:

- `openChrome()`: `spawn(executablePath, ['chrome://extensions'])` (bỏ `--new-window`) → tái dùng window
  Chrome đang chạy nếu có; chỉ window mới khi Chrome chưa chạy. Giữ `shell.openExternal` làm fallback.

## 9. Protocol & types (shared)

`src/shared/browser-types.ts` (không import Node/Electron):

```ts
export interface SnapshotNode {
  role: string
  name?: string
  ref?: string
  children?: SnapshotNode[]
}

export interface BrowserTabInfo {
  id?: number
  title?: string
  url?: string
  active: boolean
  windowId?: number
  groupId?: number
  groupTitle?: string
}
```

- `BrowserCommandName` giữ nguyên; params của `click/type/select/read/openTab/listTabs/switchTab/screenshot`
  mở rộng theo thiết kế (params là `Record<string, unknown>` — không đổi type union).
- Manifest: `permissions: ["tabs", "scripting", "storage", "debugger", "tabGroups"]`; bump version → `0.2.0`.

## 10. Tools thay đổi (main)

File `src/main/agent/tools/browser.ts`:

- `browser_read`: schema `{selector?, tabId?, maxElements?}`; description nói rõ trả a11y tree + ref;
  `maxElements` = số node tối đa (mặc định 200).
- `browser_click`/`browser_type`/`browser_select`: schema + `ref?: string`; run truyền `ref` qua params.
- `browser_open_tab`: schema `{url}`; trả `{tabId, groupId, groupTitle}`; description: mở tab background
  trong group "Meow" (không focus).
- `browser_list_tabs`: không đổi schema, output có thêm group info.
- `browser_switch_tab`: description ghi rõ không focus window.
- `browser_screenshot`: description ghi rõ chụp working tab full-page, không focus.

## 11. File layout

```
src/browser-extension/
  manifest.json        # + debugger, tabGroups; version 0.2.0
  background.ts        # working tab, openTab window reuse + group, CDP screenshot, listTabs group info
  content.ts           # ARIA tree builder (getComputedRole/Name + fallback), ref map, ref click/type/select
src/main/agent/tools/browser.ts  # tools: ref params, open_tab, read tree, screenshot description
src/main/browser/chrome-launcher.ts  # bỏ --new-window
src/shared/browser-types.ts      # SnapshotNode, BrowserTabInfo
tests/unit/browser/  # a11y tree builder (mock DOM), ref map/resolution, background routing, bridge
```

## 12. Testing

- **Unit (content logic)**: tách tree builder thành hàm thuần (`buildAriaTree(root)`, `resolveRef`) trong
  `content.ts` — test bằng fake DOM tối giản (jsdom không có getComputedRole → mock global).
  - role/name từ aria-label, textContent, alt/placeholder; bỏ generic/ẩn.
  - ref gán ổn định theo thứ tự duyệt; resolve đúng; stale ref → lỗi.
  - cap node theo `maxElements` (mặc định 200, 0 = không giới hạn).
- **Unit (background routing)**: mock `chrome.tabs`/`chrome.windows`/`chrome.tabGroups`/`chrome.debugger` —
  test openTab chọn window sẵn có, tạo group "Meow", working tab fallback, screenshot CDP attach/detach.
- **Integration (bridge)**: giữ `tests/unit/browser/bridge.test.ts` hiện có; thêm test params `ref`/`tabId`
  được forward nguyên vẹn qua `execute`.
- **Bắt buộc trước khi hoàn thành**: `npm run typecheck`, `npm test`, `npm run build:extension`.
- **Manual** (ghi vào hướng dẫn): mở tab background trong group "Meow"; screenshot tab ngầm không focus;
  read/click bằng ref trên page động (React app có card agent — nút Chat nay có trong snapshot).

## 13. Rủi ro & lưu ý

- `debugger` attach hiện infobar "đang debug" — chấp nhận (đã chốt).
- `chrome://*`, Chrome Web Store không CDP được → `screenshot` trả lỗi rõ ràng.
- `getComputedRole`/`getComputedName` cần Chrome 119+; fallback thủ công giữ chức năng trên Chrome cũ
  nhưng kém chính xác hơn.
- Content script reload khi navigate → `Map<ref, Element>` reset → agent phải `read` lại (lỗi stale đã
  thiết kế để báo rõ).
- Tab group chỉ nhóm tab do Meow mở — không động vào group/tab của user.
- `maxElements` đổi nghĩa (số node thay vì số element) — cập nhật description tool + spec cũ.
- Không phá vỡ `buildSpawnCommand` (Windows cmd shim) hay cơ chế `tree-kill` — nằm ngoài phạm vi này.
