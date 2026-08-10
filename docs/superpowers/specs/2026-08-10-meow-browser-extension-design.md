# Meow Coding — Browser Control qua Chrome Extension (debug web / auto thao tác): Design Spec

Ngày: 2026-08-10 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Cho phép **native Meow agent** (và sau này CLI agent ngoài) tự điều khiển Chrome để **debug/test web**:
mở trang, click, nhập liệu, đọc DOM, chụp screenshot, đọc console/network, chờ element xuất hiện — **trên
đúng profile Chrome thật của user** (có session đăng nhập, bookmark, extension cài sẵn), giống "Claude on
Chrome". Không tách profile riêng theo project.

### Yêu cầu phi chức năng

- Chạy trên Chrome profile **thật đang dùng hàng ngày** — không restart Chrome với cờ đặc biệt, không
  dùng profile tạm (Playwright-style) trừ khi user tự chọn.
- Auto thao tác không cần user duyệt từng thao tác (permission mặc định `allow` — user đã chốt).
- Meow tự mở Chrome + hướng dẫn cài extension khi chưa sẵn sàng.
- Xác thực kết nối bằng **pairing code** để website lạ không điều khiển được extension.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cơ chế | **Chrome Extension MV3** (kiểu Claude on Chrome), load unpacked, chạy trên profile thật |
| Kênh extension ↔ Meow | **Localhost WebSocket** do Meow chạy (Phương án A) — extension là client, connect ra `ws://127.0.0.1:<port>` |
| Xác thực | **Pairing code** 6 chữ số, TL ngắn, sinh mỗi lần khởi động app; bắt buộc trước khi nhận lệnh |
| Agent dùng trước | **Native Meow agent** (tool trực tiếp trong main process). CLI helper + MCP server cho agent ngoài → phase 2 |
| Permission tool browser | Mặc định **`allow`** (không hỏi) — user chốt; đổi được trong settings |
| Cho phép tab | **Tất cả tab** (host permission `<all_urls>`) — user chốt; có cảnh báo log |
| Chrome chưa sẵn sàng | Meow mở Chrome (`shell.openExternal`) + dialog hướng dẫn cài extension (`[meow]`, tiếng Việt) |
| Cài extension | Meow copy build extension tới `userData/browser-extension/` (đường dẫn ổn định) → hướng dẫn Load unpacked 1 lần |
| Screenshot | Lưu PNG vào `userData/browser-screenshots/`, trả path cho agent |
| Pane xem trong Meow | **Ngoài MVP** (phase 2) |
| CLI/MCP cho agent ngoài | **Ngoài MVP** (phase 2) — dùng sẵn `@modelcontextprotocol/sdk` + quy tắc cmd shim Windows |
| Thêm dependency | `ws` (WS server trong main) |

## 3. Kiến trúc

```
┌──────────────────── Meow (Electron) ────────────────────┐
│ main process                                            │
│  ┌─────────────┐   ┌──────────────────────────────┐    │
│  │ Native agent│──▶│ BrowserBridge:                │    │
│  │ (browser.ts)│   │  • WS server 127.0.0.1:0      │    │
│  └─────────────┘   │  • pairing (sinh/xác thực mã) │    │
│  ┌─────────────┐   │  • command router + timeout   │    │
│  │ IPC Browser:*│──▶│  • ring buffer console/net    │    │
│  └─────────────┘   │  • event stream (status, dom) │    │
│                    └──────────▲───────────────────┘    │
└───────────────────────────────┼───────────────────────┘
                                │ WS connect (client-side, có pairing code)
                    ┌───────────┴───────────┐
                    │ Chrome Extension (MV3) │  ← chạy trên profile THẬT
                    │ background SW + content│    (session đăng nhập của user)
                    └───────────────────────┘
```

**Luồng 1 lệnh:** agent gọi tool (vd `browser_click`) → `BrowserBridge.execute(cmd)` → gửi JSON qua WS →
extension chạy content script → trả `result` → bridge resolve → tool result về agent.

## 4. Chrome Extension (MV3)

- **Vị trí**: `src/browser-extension/` (TS, build riêng bằng vite lib mode → `out/browser-extension/`);
  main process copy sang `userData/browser-extension/` khi app khởi động (nếu chưa có / có version mới).
- **Background service worker**: giữ WS connection (reconnect với backoff), xử lý pairing, route command
  tới tab đúng, tab management (`chrome.tabs`), screenshot (`chrome.tabs.captureVisibleTab`).
- **Content script**: inject mọi tab (`<all_urls>`), thực thi DOM ops (click, type, select, scroll, đọc
  text/snapshot), `MutationObserver` (theo dõi thay đổi), intercept console (`console.*` + `window.onerror`)
  và network (performance entries + hook fetch/XHR).
- **Popup**: trạng thái kết nối + ô nhập pairing code.
- **Permissions**: `tabs`, `scripting`, `storage`, host permissions `<all_urls>`.

### Bộ lệnh MVP (bridge ↔ extension)

| Nhóm | Lệnh |
|---|---|
| Điều hướng | `navigate`, `openTab`, `switchTab`, `closeTab`, `reload`, `listTabs` |
| DOM | `click`, `type`, `select`, `scroll`, `read` (text + snapshot), `waitFor` |
| Quan sát | `screenshot`, `getConsoleLogs`, `getNetworkLogs` |
| Theo dõi | `watchStart` / `watchStop` (DOM change events đẩy về bridge) |

## 5. BrowserBridge (main process)

- **WS server**: package `ws`, bind `127.0.0.1:0` (port random), chỉ nhận kết nối local. Port được lưu
  trong memory + expose qua IPC.
- **Pairing**: sinh mã 6 chữ số ngẫu nhiên, hiển thị cho user (dialog/UI). Extension gửi
  `{type:'pair', code}` → xác thực → trạng thái `paired`. Mã có TL (5 phút), mỗi khởi động app sinh mã
  mới. Sau khi paired, giữ WS session; mất kết nối → `disconnected`, extension tự reconnect.
- **Command router**: `execute(cmd: BrowserCommand, opts?: {timeoutMs})` → gửi xuống extension → chờ
  `{type:'result', id, ok, data?, error?}` → resolve/reject. Timeout mặc định 30s. Chưa paired/connected →
  trả lỗi rõ ràng (agent nhận "browser not connected", và `browser_start` sẽ mở Chrome + hướng dẫn).
- **Event stream**: extension đẩy `console`, `network`, `domChanged`, `tabUpdated`, `status` → bridge lưu
  ring buffer (console/network, giới hạn số entry) + broadcast cho tools/renderer.
- **Chrome launcher** (`chrome-launcher.ts`): mở Chrome bằng `shell.openExternal` (profile mặc định thật,
  trang blank), hiện dialog hướng dẫn: mở `chrome://extensions` → bật Developer mode → Load unpacked →
  `userData/browser-extension/`.

## 6. Native agent tools (MVP)

File `src/main/agent/tools/browser.ts`, đăng ký trong `createDefaultTools` (permission `allow` mặc định):

| Tool | Mô tả |
|---|---|
| `browser_start` | Kiểm tra kết nối; mở Chrome + hướng dẫn cài nếu chưa sẵn sàng; chờ `paired` (timeout) |
| `browser_navigate` | `(url)` mở/điều hướng tab hiện tại |
| `browser_click` | `(selector | x, y)` click element / tọa độ |
| `browser_type` | `(selector, text)` focus + nhập (kèm input events) |
| `browser_select` | `(selector, value)` chọn option |
| `browser_scroll` | `(direction | selector)` cuộn trang / vào view |
| `browser_read` | `(selector?)` text + snapshot DOM (interactive elements) |
| `browser_screenshot` | Chụp PNG → `userData/browser-screenshots/<ts>.png`, trả path |
| `browser_list_tabs` / `browser_switch_tab` / `browser_close_tab` | Quản lý tab |
| `browser_console` / `browser_network` | `(limit?)` entries gần nhất từ ring buffer |
| `browser_wait_for` | `(selector, timeoutMs)` chờ element xuất hiện |

Mỗi tool: schema zod, gọi `BrowserBridge.execute`, map kết quả thành `ToolRunResult` (`output`/`error`).

## 7. Protocol & types (shared)

- `src/shared/browser-types.ts` (không import Node/Electron):
  - `BrowserStatus = 'idle' | 'connecting' | 'paired' | 'disconnected' | 'error'`
  - `BrowserCommand` (discriminated union), `BrowserCommandResult`, `BrowserEvent`
    (`console` | `network` | `domChanged` | `tabUpdated` | `status`)
  - `PairingInfo { code, expiresAt }`
- WS messages: `{type:'pair', code}`, `{type:'cmd', id, ...}`, `{type:'result', id, ok, data?, error?}`,
  `{type:'event', name, data}`.
- `src/shared/ipc.ts` — thêm channels (qua `Channels`):
  `Browser:getStatus`, `Browser:pair` (sinh mã mới), `Browser:openInstallGuide`, `Browser:openExtensionFolder`,
  `Browser:getConsoleLogs`, `Browser:getNetworkLogs`.
- Preload: expose `window.api.browser.*` tương ứng. Renderer chỉ hiện trạng thái/hướng dẫn (không có pane xem).

## 8. Bảo mật

- **Pairing code bắt buộc** trước khi nhận bất kỳ lệnh nào → website lạ trong Chrome không connect được
  tới WS server.
- **Chỉ bind `127.0.0.1`** — không expose ra mạng.
- Permission tool browser mặc định `allow` (user chốt) — **rủi ro đã ghi nhận**: agent tự động thao tác
  trên profile thật có session đăng nhập; user có thể đổi thành `ask` trong settings.
- Cho phép tất cả tab (`<all_urls>`) — user chốt; bridge log cảnh báo `[meow]` khi thao tác domain lạ.

## 9. MVP scope

**Có**: extension MV3 load unpacked trên profile thật; pairing + WS bridge + reconnect; 12 tools native;
Meow tự mở Chrome + hướng dẫn cài; ring buffer console/network; DOM change events.

**Chưa có (phase 2)**: pane xem trực tiếp trong Meow; CLI helper `meow-browser`; MCP server cho agent ngoài;
persist pairing giữa các lần khởi động app (MVP: mã mới mỗi lần chạy — extension chỉ cần pair lại 1 lần
mỗi phiên app).

## 10. File layout

```
src/browser-extension/           # MV3 extension (build riêng)
  manifest.json
  background.ts
  content.ts
  popup.html / popup.ts
src/main/browser/
  bridge.ts                      # WS server + pairing + command router + events
  chrome-launcher.ts             # mở Chrome + hướng dẫn cài
  install-guide.ts               # nội dung dialog tiếng Việt [meow]
src/main/agent/tools/browser.ts  # native browser tools (zod schemas)
src/shared/browser-types.ts      # protocol types (không import Node/Electron)
src/shared/ipc.ts                # + Browser:* channels
src/preload/index.ts             # + window.api.browser.*
tests/unit/browser/              # pairing, command router, ring buffer, tool schemas
tests/integration/browser/       # BrowserBridge + WS client giả lập extension
package.json                     # + dependency: ws; + script build:extension
electron.vite.config.ts          # + build entry cho extension
```

## 11. Testing

- **Unit**: pairing (sinh mã, xác thực, hết hạn), command router (fake WS client, timeout, lỗi
  not-connected), ring buffer console/network, zod schemas của tools.
- **Integration**: `BrowserBridge` + `ws` client mô phỏng extension (không cần Chrome thật) — test toàn
  luồng execute → result, event stream, reconnect.
- **Bắt buộc trước khi hoàn thành**: `npm run typecheck` pass, `npm test` pass.
- e2e với Chrome thật + extension: để phase 2 (cần Playwright persistent context).

## 12. Tài liệu tham chiếu

- Kiến trúc app: `src/main/agent/tools/` (registry, types), `src/main/index.ts` (IPC wiring),
  `src/shared/ipc.ts` (Channels), AGENTS.md (quy ước: Windows cmd shim, chỉ main spawn process,
  thông báo tiếng Việt prefix `[meow]`).
- `@modelcontextprotocol/sdk` đã có sẵn trong dependencies — dùng cho MCP phase 2.
