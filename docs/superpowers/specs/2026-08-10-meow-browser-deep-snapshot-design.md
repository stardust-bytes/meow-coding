# Meow Coding — Browser Deep Snapshot qua CDP (Accessibility tree) + Debug Session bền vững: Design Spec

Ngày: 2026-08-10 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Nâng cấp tính năng browser control để `browser_read` **đọc được đầy đủ cấu trúc DOM sâu** (shadow DOM cả
closed root, iframe cross-origin, phần tử offscreen) và tương tác tới mọi element đó — **theo cách MCP /
Puppeteer / "Claude on Chrome"**: snapshot bằng **CDP Accessibility tree** (Chrome tự tính role + name),
tương tác bằng **ref → `backendDOMNodeId` → `DOM.resolveNode` + `Runtime.callFunctionOn`**. Đồng thời giữ
**`chrome.debugger` attach bền vững** trong suốt phiên làm việc để hết hiện tượng infobar "debug" bật/tắt
chập chờn (do attach/detach từng lệnh screenshot như hiện tại).

## 2. Vấn đề hiện tại

| Vấn đề | Nguyên nhân |
|---|---|
| `browser_read` không đọc hết element | Snapshot hiện tại là content-script tự traverse DOM (`buildAriaTree`): (1) cap mặc định 200 node; (2) **không đọc được shadow DOM** (`childNodes` bỏ qua `shadowRoot`); (3) **không đọc được iframe** (manifest `all_frames: false`); (4) lọc `aria-hidden`/`display:none`/generic; (5) không đọc nội dung vẽ (canvas/SVG). |
| Infobar "debug" bật/tắt chập chờn | `screenshot` attach/detach `chrome.debugger` mỗi lần gọi → Chrome hiện/tắt thông báo "đang debug" liên tục. |

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cơ chế snapshot | **CDP `Accessibility.getFullAXTree`** — cây accessibility đầy đủ do Chrome tính (role + name chuẩn), bao gồm shadow DOM (mở + đóng) và iframe cross-origin, offscreen. Map thành `SnapshotNode` (giữ shape hiện tại). |
| Tương tác | **ref → `backendDOMNodeId` → `DOM.resolveNode` → `Runtime.callFunctionOn`** (click/type/select). Puppeteer-style, tới được shadow DOM + iframe cross-origin. Giữ `selector`/`x,y` → content script (top frame) như cũ. |
| Debug session | **Attach 1 lần cho working tab**, tái sử dụng cho read/click/type/select/screenshot. Detach khi tab đóng / WS ngắt / idle 60s. Hết attach/detach từng lệnh. |
| mode snapshot | `read` nhận `mode: "interactive"` (mặc định; lọc ignored/generic, ref cho node tương tác) hoặc `"full"` (giữ mọi node non-ignored, ref mọi node). |
| Giới hạn | `maxNodes` cap (mặc định 200 interactive / 500 full; `0` = không giới hạn); name/text truncate. |
| Trang không CDP được | `chrome://*`, Chrome Web Store → attach fail → trả lỗi rõ ràng. **Không** fallback về content-script snapshot (tránh hai nguồn ref khác nhau). |
| Content script | Giữ: console/network intercept, MutationObserver (`watchStart/Stop`), `tabUpdated`, action theo `selector`/`x,y` (click/type/select), `scroll`, `waitFor`. **Bỏ**: `read` (chuyển CDP), ref-path trong click/type/select. |
| snapshot.ts | **Xóa** cùng unit test (không còn dùng cho `read`; tránh dead code). |
| Permission | Giữ nguyên `debugger`, `tabGroups`, `tabs`, `scripting`, `storage`. |

## 4. Kiến trúc / luồng dữ liệu

```
LLM ── browser_read {mode} ──▶ background (CDP session):
        ensureDebugSession(tabId)   // attach 1 lần + enable DOM/Page/Runtime/Accessibility
        Accessibility.getFullAXTree → axTreeToSnapshot(nodes, {mode,maxNodes})
                → { tree: SnapshotNode[], refs: {ref, backendDOMNodeId}[] }   (hàm thuần, unit-test)
        text = Runtime.evaluate document.body.innerText (1 layout)
        → { url, title, text, tree }   // url/title từ chrome.tabs.get(tabId)

LLM ── browser_click {ref} ──▶ background (CDP):
        DOM.resolveNode({backendNodeId}) → Runtime.callFunctionOn(click + scrollIntoView)
        → kết quả (node detached → "snapshot stale: re-read the page")

LLM ── browser_click {selector|x,y} / type / select / scroll / waitFor / watch ──▶ content script (như cũ)

LLM ── browser_screenshot ──▶ background (CDP session sẵn, không attach/detach):
        Page.captureScreenshot {captureBeyondViewport, fromSurface}
```

Ref `rN` chỉ hợp lệ trong phiên snapshot hiện tại; node bị detach → `DOM.resolveNode` fail → báo
"snapshot stale". Khi `ensureDebugSession` gặp tab khác working tab → detach session cũ, attach tab mới.

## 5. Debug session bền vững (background)

File `src/browser-extension/background.ts`:

```ts
let debugTabId: number | null = null
let debugIdleTimer: ReturnType<typeof setTimeout> | null = null
const DEBUG_IDLE_MS = 60_000

async function ensureDebugSession(tabId: number): Promise<void> {
  if (debugTabId === tabId) { resetDebugIdle(); return }
  await closeDebugSession()
  await chrome.debugger.attach({ tabId }, '1.3')
  await Promise.all([
    chrome.debugger.sendCommand({ tabId }, 'DOM.enable'),
    chrome.debugger.sendCommand({ tabId }, 'Page.enable'),
    chrome.debugger.sendCommand({ tabId }, 'Runtime.enable'),
    chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable')
  ])
  debugTabId = tabId
  resetDebugIdle()
}

function resetDebugIdle(): void {
  if (debugIdleTimer) clearTimeout(debugIdleTimer)
  debugIdleTimer = setTimeout(() => { void closeDebugSession() }, DEBUG_IDLE_MS)
}

async function closeDebugSession(): Promise<void> {
  if (debugIdleTimer) { clearTimeout(debugIdleTimer); debugIdleTimer = null }
  if (debugTabId != null) {
    await chrome.debugger.detach({ tabId: debugTabId }).catch(() => {})
    debugTabId = null
  }
}
```

- Gọi `ensureDebugSession(tabId)` ở đầu `read`, `screenshot`, và nhánh `ref` của `click/type/select`.
- `closeDebugSession()` khi: `socket.onclose` (app ngắt), `pair_result ok:false` (unpair), tab đóng
  (`chrome.tabs.onRemoved` lọc tabId trùng `debugTabId`), idle timeout.
- `screenshot` bỏ attach/detach cũ, dùng session sẵn.
- MV3 SW suspend sẽ detach debugger; lệnh kế tiếp gọi `ensureDebugSession` re-attach (1 lần). Trong lúc
  agent làm việc liên tục, SW không bị suspend nên session được giữ.

## 6. Snapshot sâu: `Accessibility.getFullAXTree`

CDP trả dạng:

```json
{
  "nodes": [
    { "nodeId": "1.1", "ignored": false,
      "role": { "value": "button" }, "name": { "value": "Chat" },
      "backendDOMNodeId": 42, "childIds": ["1.2", "1.3"] }
  ]
}
```

Hàm thuần `axTreeToSnapshot(nodes, opts)` (file mới `src/browser-extension/ax-snapshot.ts`, không chrome/
node, unit-test được):

- Nhận `nodes` AX (flat list) + `childIds`; dựng cây theo `nodeId` → `children` theo thứ tự `childIds`.
- Defensive với CDP shape: `role`/`name` có thể là `{value}` hoặc string — normalize.
- **interactive mode**: bỏ node `ignored: true`, bỏ `generic`/`none`/`presentation` không có name; gán ref
  `r1..rN` cho node có role tương tác (`button`, `link`, `textbox`, `combobox`, `checkbox`, `radio`,
  `switch`, `menuitem*`, `tab`, `option`, `slider`, `spinbutton`, `treeitem`, `gridcell`, `searchbox`,
  `listbox`, `scrollbar`).
- **full mode**: giữ mọi node `ignored: false`; gán ref cho mọi node **element** (không gán cho node text —
  node text chỉ hiển thị nội dung, không tương tác).
- `maxNodes` cap tổng node (đếm cả node text); `textMaxChars` truncate name (mặc định 120).
- Trả `{ tree: SnapshotNode[]; refs: Array<{ ref: string; backendDOMNodeId: number }> }`.
- Text: vẫn trả `text` của trang — lấy bằng `Runtime.evaluate` `document.body.innerText` (1 layout),
  truncate `MAX_READ_CHARS`. `url`/`title` từ `chrome.tabs.get(tabId)`.

Ghi chú: AX tree của Chrome đã tự bỏ presentation thuần — không cần heuristic lọc của content-script cũ.
Element `display:none` không xuất hiện trong AX tree (không tương tác được) — chấp nhận. Canvas/SVG không
có name thường → cần screenshot + LLM vision (ngoài phạm vi, ghi ở Rủi ro).

## 7. Tương tác CDP (click/type/select theo ref)

Background, trong nhánh `ref`:

```ts
// click
const { object } = await chrome.debugger.sendCommand({ tabId }, 'DOM.resolveNode', { backendNodeId })
await chrome.debugger.sendCommand({ tabId }, 'Runtime.callFunctionOn', {
  objectId: object.objectId,
  functionDeclaration: `function(){ const el = this; el.scrollIntoView({block:'center',inline:'center'}); el.click(); return true; }`,
  returnByValue: true
})
```

- `type`: callFunctionOn focus + native setter + dispatch `input`/`change` (giữ logic `setNativeValue` hiện
  tại, truyền text qua `arguments: [{ value: text }]`).
- `select`: callFunctionOn `this.value = value; dispatch change`.
- `DOM.resolveNode` fail (node detached / backend id hết hạn) → trả
  `snapshot stale: re-read the page (ref rN no longer valid)`.
- Nếu `ensureDebugSession` fail → trả lỗi rõ ràng (`browser not capturable / page not CDP-accessible`).
- Khi params có `selector` hoặc `x/y` (không có `ref`) → chuyển content script như cũ.

## 8. Content script giữ lại / bỏ

Giữ (không đổi): console intercept, network intercept, `window.onerror`/`unhandledrejection`,
MutationObserver `watchStart/Stop`, `tabUpdated`, `navigate` (location.href), `scroll`, `waitFor`,
`click/type/select` theo `selector`/`x,y`, `setNativeValue`, `query`, `scrollIntoView`.

Bỏ: `read` case (CDP thay thế), ref-path trong `click/type/select` (CDP thay thế), `refMap`,
import `buildAriaTree/createRefMap/resolveRef/DEFAULT_MAX_NODES` từ `./snapshot`.

Xóa file `src/browser-extension/snapshot.ts` + `tests/unit/browser/snapshot.test.ts` (dead code).

## 9. Types & tools

- `src/shared/browser-types.ts`: `SnapshotNode` giữ nguyên. Thêm:
  ```ts
  export type BrowserReadMode = 'interactive' | 'full'
  ```
- `src/main/agent/tools/browser.ts` `browser_read`: thêm `mode`:
  ```ts
  mode: z.enum(['interactive', 'full']).optional().describe('interactive (default): refs on interactive elements; full: every accessible node.')
  ```
  run truyền `mode` qua params. Description cập nhật: snapshot dùng Chrome accessibility tree, đọc được
  shadow DOM + iframe.
- `browser_click/type/select`: giữ `ref` (giờ resolve qua CDP) + `selector`/`x,y`. Không đổi schema.
- `browser_screenshot`: không đổi API (chỉ đổi cơ chế session).

## 10. File layout

```
src/browser-extension/
  ax-snapshot.ts          # MỚI — thuần: axTreeToSnapshot(nodes, opts) → {tree, refs}
  background.ts           # SỬA — debug session bền vững; read/click/type/select/screenshot qua CDP
  content.ts              # SỬA — bỏ read + ref-path; giữ console/network/watch/selector-actions
  snapshot.ts             # XÓA
  manifest.json           # không đổi (debugger đã có)
src/main/agent/tools/browser.ts   # SỬA — browser_read + mode
tests/unit/browser/
  ax-snapshot.test.ts     # MỚI — unit test axTreeToSnapshot (fake AX nodes)
  snapshot.test.ts        # XÓA
  bridge.test.ts          # không đổi (bridge WS params pass-through)
```

## 11. Testing

- **Unit (`ax-snapshot.test.ts`)**: fake AX node list → assert:
  - dựng cây theo `childIds` đúng thứ tự; role/name từ `{value}` và từ string (defensive).
  - interactive mode: bỏ ignored/generic-không-name; ref chỉ cho role tương tác, đúng thứ tự `r1..rN`.
  - full mode: giữ mọi non-ignored; ref mọi node.
  - `maxNodes` cap (0 = unlimited), `textMaxChars` truncate.
- **Unit (background)**: mock `chrome.debugger` — test `ensureDebugSession` attach 1 lần + không attach lại
  khi cùng tab; `closeDebugSession` gọi detach; lệnh read gọi `getFullAXTree`; click ref gọi
  `resolveNode`+`callFunctionOn`; selector đi content script.
- **Bắt buộc**: `npm run typecheck`, `npm test`, `npm run build:extension`.
- **Manual** (cần Chrome thật):
  - trang có shadow DOM / web components → `browser_read` thấy element bên trong; click theo ref hoạt động.
  - trang có iframe cross-origin → `browser_read` thấy nội dung iframe; click theo ref trong iframe hoạt động.
  - infobar "debug" hiện 1 lần khi bắt đầu, **không** bật/tắt chập chờn khi liên tục screenshot/click.
  - `maxElements: 0` + `mode: full` trên trang lớn → snapshot đầy đủ, token lớn (đo trước khi dùng).

## 12. Rủi ro & lưu ý

- **Infobar "X đang debug" hiện liên tục khi làm việc** — trade-off đã chốt (hết chập chờn).
- **Chrome Web Store / chrome://** không attach debugger → read/click ref trả lỗi rõ ràng; agent nên tránh.
- **Canvas/SVG / nội dung vẽ** không nằm trong AX tree (không có role/name) → cần screenshot + LLM vision
  (phase sau, ngoài phạm vi).
- **Element `display:none` / virtualized chưa render** không có trong DOM/AX → không đọc được (bản chất
  trình duyệt; không phải lỗi snapshot).
- **backendDOMNodeId hết hạn khi DOM đổi** → click fail "snapshot stale" → agent re-read (đã thiết kế).
- **`Accessibility.getFullAXTree` trên trang rất lớn** tốn token (đặc biệt `mode: full`) — dùng cap hoặc
  `selector` scope.
- Không phá vỡ `buildSpawnCommand` (Windows shim), pairing, `127.0.0.1` binding.
