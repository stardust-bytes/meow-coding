# Meow Coding — Browser Control via Chrome Extension: Implementation Plan

Ngày: 2026-08-10 · Spec: `docs/superpowers/specs/2026-08-10-meow-browser-extension-design.md` · Trạng thái: chờ thực thi (cập nhật 2026-08-10 sau pull codebase 0.17.0)

## 0. Cập nhật sau pull (2026-08-10) — delta so với bản plan gốc

Codebase đã nâng lên **0.17.0**; các commit code từ bản triển khai cũ (Task 1-7) **không còn trên branch**
(chỉ trong stash/reflog) → thực thi lại từ đầu trên codebase mới. Khác biệt ảnh hưởng:

| Thay đổi trong codebase 0.17.0 | Ảnh hưởng tới plan |
|---|---|
| Đã có `playwright-core@^1.62.0` + `src/main/chatgpt-web/` (automation chatgpt.com, **persistent context riêng**) | Feature này **không dùng** playwright-core (vẫn dùng extension MV3 + WS). Nhưng **tái sử dụng** `resolveChromeExecutablePath()` từ `src/main/chatgpt-web/browser-login.ts` cho Chrome launcher (thay vì chỉ `shell.openExternal`) |
| `src/main/agent/tools/registry.ts` có `office` tool + option `getUserDataDir` | Task 6: thêm option `browser` cạnh `getUserDataDir`, không phá `office` |
| `src/main/agent/config.ts` permission đã có `office: 'ask'` | Task 6: thêm `browser_*: 'allow'` cạnh đó |
| `src/shared/ipc.ts` đã có `ChatGptWeb*` channels + `ChallengeEvent`; `AgentApi` có `getChatGptWebStatus`... | Task 2: thêm browser channels cạnh, không trùng tên; cập nhật `tests/unit/ipc-contract.test.ts` (đã có chatgpt stubs) |
| `package.json` scripts có `dist:mac`/`dist:mac:dir` | Task 1: thêm `predist:mac` + `predist:mac:dir`; extraResources hiện chỉ có `skills` |
| `tsconfig.json` references chỉ node + web | Task 1: thêm reference extension (như cũ) |
| `app.whenReady().then(() => {...})` sync | Task 7: dùng `.then(async () => ...)` để start bridge + copy extension |
| `src/main/index.ts` MainApp có field `chatGptWeb` | Task 7: wire bridge/launcher cạnh `chatGptWeb`, không đụng tới nó |

## 1. Tổng quan

Triển khai MVP "Browser Control": extension Chrome MV3 chạy trên profile thật của user, kết nối tới
WS server do Meow main process chạy (`ws` package), xác thực bằng pairing code. Native Meow agent có
14 tool `browser_*` (permission mặc định `allow`). Renderer chỉ hiện status chip + dialog ghép nối.

Phạm vi MVP: native agent tools + extension + bridge + pairing + launcher/hướng dẫn. **Không có**
pane xem, CLI helper, MCP cho agent ngoài (phase 2).

## 2. Quyết định kỹ thuật bổ sung (làm rõ spec)

| Chủ đề | Quyết định |
|---|---|
| WS server port | Mặc định cố định **3927** (để extension popup auto-detect), HTTP + WS chung 1 server trên cùng port. Nếu 3927 bận → chọn port random, `/api/status` trả port thật, popup có ô nhập port thủ công (rare) |
| Discovery | Bridge phục vụ `GET /api/status` → `{ port, status }`; popup fetch `http://127.0.0.1:3927/api/status` để tìm port thật |
| Extension build | `scripts/build-extension.mjs` dùng **esbuild** (devDep khai báo rõ), output **IIFE** (MV3 service worker + content script classic, không dùng ES module) → `out/browser-extension/` |
| Extension path | Main copy từ `out/browser-extension` (dev) / `process.resourcesPath/browser-extension` (packaged, qua extraResources) → `userData/browser-extension/` (path ổn định để Chrome Load unpacked nhớ) |
| Packaged | Thêm `extraResources` `{ from: "out/browser-extension", to: "browser-extension" }` |
| Typecheck extension | `tsconfig.extension.json` riêng (`types: ["chrome"]`), thêm vào root references + script `typecheck` |
| Protocol types | `src/shared/browser-types.ts` (thuần types); extension dùng `import type` đường dẫn tương đối → single source of truth |
| Tool schemas | `src/main/agent/tools/browser.ts` factory `createBrowserTools(bridge, launcher)`; đăng ký trong registry khi `opts.browser` có |
| Permission | Build mode: `browser_*: 'allow'` (user chốt). Plan mode (`PLAN_RULES`): `browser_*: 'ask'` (overrides config trong plan mode — an toàn, đúng nguyên tắc read-only) |
| Screenshot | Extension trả base64 PNG → bridge ghi `userData/browser-screenshots/<ts>.png` → tool trả path |
| Console/network | Content script intercept → event WS → bridge lưu ring buffer (cap 200 mỗi loại) |

## 3. File structure

```
src/browser-extension/               # MỚI — Chrome MV3 extension (TS, build riêng)
  manifest.json                      # MV3, permissions: tabs/scripting/storage, host <all_urls>
  background.ts                      # service worker: WS client + reconnect, pairing, cmd routing, tabs, screenshot
  content.ts                         # DOM ops, selector gen, console/network intercept, MutationObserver, waitFor
  popup.html                         # status + port + pairing code input
  popup.ts                           # logic popup, auto-detect port qua /api/status
scripts/
  build-extension.mjs                # MỚI — esbuild bundle 3 entry + copy manifest/popup.html → out/browser-extension
src/shared/
  browser-types.ts                   # MỚI — BrowserCommand union, BrowserCommandResult, BrowserEvent,
                                     #   BrowserStatus, PairingInfo, BrowserStatusInfo (thuần types, không import Node)
  ipc.ts                             # SỬA — Channels Browser:* + EventBrowserStatus; AgentApi + browser methods
src/main/browser/                    # MỚI
  bridge.ts                          # BrowserBridge: HTTP+WS server (ws), pairing code, command router,
                                     #   ring buffer console/network, status events, waitForPaired, close()
  chrome-launcher.ts                 # openChrome(), openExtensionFolder(), showInstallGuide()
src/main/agent/tools/
  browser.ts                         # MỚI — createBrowserTools(bridge, launcher): 14 tools + BrowserLauncher interface
  registry.ts                        # SỬA — DefaultToolsOptions.browser?; đăng ký khi có
src/main/agent/
  permission.ts                      # SỬA — PLAN_RULES thêm browser_*: 'ask'
  config.ts                          # SỬA — DEFAULT_MEOW_CONFIG.permission thêm browser_*: 'allow'
src/main/index.ts                    # SỬA — tạo bridge+launcher, truyền vào createDefaultTools, IPC handlers,
                                     #   forward EventBrowserStatus, start/close theo lifecycle
src/preload/index.ts                 # SỬA — window.api.browser.*
src/renderer/src/
  components/StatusBar.tsx           # SỬA — chip trạng thái browser (click → dialog)
  components/BrowserDialog.tsx       # MỚI — pairing code, port, nút mở hướng dẫn / extension folder
  styles.css                         # SỬA — style chip + dialog
  App.tsx                            # SỬA — state browser status + dialog open
package.json                         # SỬA — deps ws/@types/ws/@types/chrome/esbuild; scripts build:extension + pre-* hooks
electron-builder (build config)      # SỬA — extraResources browser-extension
tsconfig.extension.json              # MỚI — typecheck extension
tsconfig.json                        # SỬA — reference tsconfig.extension.json
tests/unit/
  ipc-contract.test.ts               # SỬA — browser channels/methods
  agent-config.test.ts               # SỬA — permission default có browser_*
  agent-permission.test.ts           # SỬA — plan mode browser_* ask
  browser/bridge.test.ts             # MỚI — pairing, router, timeout, ring buffer (ws client thật)
  browser/agent-tools-browser.test.ts# MỚI — schemas + run với fake bridge
tests/integration/browser/
  bridge-flow.test.ts                # MỚI — ws client mô phỏng extension: pair → cmd → result, events
docs/AGENTS.md                       # SỬA — ghi chú browser feature (main + root nếu cần)
```

## 4. Các task

---

### Task 1: Dependencies + build scaffolding

**File**: `package.json`, `tsconfig.json`, `tsconfig.extension.json`, `scripts/build-extension.mjs` (skeleton)

1. Thêm dependencies:
   - `dependencies`: `"ws": "^8.18.0"`
   - `devDependencies`: `"@types/ws": "^8.5.13"`, `"@types/chrome": "^0.0.313"`, `"esbuild": "^0.25.12"`
   - Chạy `npm install`.
2. Thêm scripts:
   - `"build:extension": "node scripts/build-extension.mjs"`
   - `"predev": "npm run build:extension"`, `"prebuild": "npm run build:extension"`,
     `"predist": "npm run build:extension"`, `"predist:dir": "npm run build:extension"`,
     `"predist:linux": "npm run build:extension"`, `"predist:linux:dir": "npm run build:extension"`
   - **0.17.0 có thêm** `dist:mac`/`dist:mac:dir` → thêm `"predist:mac"` và `"predist:mac:dir"`
   - `"typecheck"` thêm: `&& tsc --noEmit -p tsconfig.extension.json`
3. `tsconfig.extension.json` (mới):
   ```json
   {
     "compilerOptions": {
       "composite": true, "target": "ES2022", "module": "ESNext",
       "moduleResolution": "Bundler", "strict": true, "skipLibCheck": true,
       "noEmit": true, "types": ["chrome"], "lib": ["ES2022", "DOM"]
     },
     "include": ["src/browser-extension/**/*", "src/shared/browser-types.ts"]
   }
   ```
   Lưu ý: `src/shared/browser-types.ts` nằm cả trong node/web/extension config — file phải **không import gì**.
4. `tsconfig.json` references: thêm `{ "path": "./tsconfig.extension.json" }`.
5. electron-builder `build.extraResources`: thêm `{ "from": "out/browser-extension", "to": "browser-extension" }`.
6. `scripts/build-extension.mjs` — viết đủ ngay ở Task 3 (ở đây chỉ tạo file tối thiểu để `npm run build:extension` chạy được; tạm `console.log('ok')`).

**Kiểm thử**: `npm run typecheck` pass (chưa có file mới thì vẫn pass); `npm run build:extension` chạy được.
**Commit**: `chore: add ws/esbuild/chrome types deps and extension build scaffolding`

---

### Task 2: Shared protocol types + IPC contract

**File**: `src/shared/browser-types.ts` (mới), `src/shared/ipc.ts` (sửa), `tests/unit/ipc-contract.test.ts` (sửa)

1. `src/shared/browser-types.ts` — thuần types, **không import** bất kỳ module nào:
   ```ts
   export type BrowserStatus = 'idle' | 'listening' | 'paired' | 'disconnected' | 'error'
   export interface BrowserStatusInfo {
     status: BrowserStatus
     port: number
     paired: boolean
     pairingCode?: string      // chỉ khi chưa paired
     pairingExpiresAt?: number
   }
   export type BrowserCommandName =
     | 'navigate' | 'openTab' | 'switchTab' | 'closeTab' | 'reload' | 'listTabs'
     | 'click' | 'type' | 'select' | 'scroll' | 'read' | 'screenshot'
     | 'waitFor' | 'watchStart' | 'watchStop' | 'getConsoleLogs' | 'getNetworkLogs'
   export interface BrowserCommand {
     id: string
     name: BrowserCommandName
     params?: Record<string, unknown>
   }
   export type BrowserCommandResult =
     | { ok: true; data?: unknown }
     | { ok: false; error: string }
   export type BrowserEventName = 'console' | 'network' | 'domChanged' | 'tabUpdated' | 'status'
   export interface BrowserEvent { name: BrowserEventName; data: unknown }
   export interface PairingInfo { code: string; expiresAt: number }
   // Wire messages bridge ↔ extension (JSON over WS)
   export interface PairMessage { type: 'pair'; code: string }
   export interface PairResultMessage { type: 'pair_result'; ok: boolean; error?: string }
   export interface CmdMessage extends BrowserCommand { type: 'cmd' }
   export interface ResultMessage extends BrowserCommandResult { type: 'result'; id: string }
   export interface EventMessage extends BrowserEvent { type: 'event' }
   export type ExtensionToBridge = PairMessage | ResultMessage | EventMessage
   export type BridgeToExtension = PairResultMessage | CmdMessage | { type: 'pong' }
   ```
2. `src/shared/ipc.ts`:
   - Channels: `BrowserGetStatus: 'browser:get-status'`, `BrowserPair: 'browser:pair'`,
     `BrowserOpenInstallGuide: 'browser:open-install-guide'`, `BrowserOpenExtensionFolder: 'browser:open-extension-folder'`,
     `BrowserGetConsoleLogs: 'browser:get-console-logs'`, `BrowserGetNetworkLogs: 'browser:get-network-logs'`,
     `EventBrowserStatus: 'browser:status'`
   - AgentApi thêm:
     ```ts
     getBrowserStatus(): Promise<BrowserStatusInfo>
     pairBrowser(): Promise<PairingInfo>
     openBrowserInstallGuide(): Promise<void>
     openBrowserExtensionFolder(): Promise<void>
     getBrowserConsoleLogs(limit?: number): Promise<unknown[]>
     getBrowserNetworkLogs(limit?: number): Promise<unknown[]>
     onBrowserStatus(cb: (info: BrowserStatusInfo) => void): () => void
     ```
3. `tests/unit/ipc-contract.test.ts`: thêm method stub vào mock `AgentApi`, thêm `expect(Channels.X).toBe('browser:...')`, thêm `BrowserStatusInfo` vào event payload type test.

**Kiểm thử**: `npm test` (ipc-contract pass), `npm run typecheck` pass.
**Commit**: `feat(shared): browser protocol types and IPC contract`

---

### Task 3: Chrome extension (MV3) + build script

**File**: `src/browser-extension/manifest.json`, `background.ts`, `content.ts`, `popup.html`, `popup.ts`, `scripts/build-extension.mjs`

1. `manifest.json`:
   ```json
   {
     "manifest_version": 3,
     "name": "Meow Browser Bridge",
     "version": "0.1.0",
     "permissions": ["tabs", "scripting", "storage"],
     "host_permissions": ["<all_urls>"],
     "background": { "service_worker": "background.js" },
     "action": { "default_popup": "popup.html", "default_title": "Meow Browser Bridge" },
     "content_scripts": [{
       "matches": ["<all_urls>"],
       "js": ["content.js"],
       "run_at": "document_idle",
       "all_frames": false
     }]
   }
   ```
2. `background.ts` (service worker, IIFE):
   - `connect()`: fetch `http://127.0.0.1:3927/api/status` → port thật → `new WebSocket('ws://127.0.0.1:'+port)`; send `{type:'pair', code}` (code từ `chrome.storage.local`); nhận `pair_result` → set trạng thái, send `chrome.runtime` broadcast cho popup.
   - Reconnect với backoff (1s → 30s), lưu timeout để test clean.
   - `chrome.runtime.onMessage`: nhận `{kind:'pair', code}` từ popup → lưu storage → reconnect ngay.
   - Nhận `{type:'cmd', id, name, params}` từ WS:
     - tab commands (`openTab/switchTab/closeTab/reload/listTabs/navigate`) → `chrome.tabs.*`
     - page commands (`click/type/select/scroll/read/waitFor/watchStart/watchStop`) → `chrome.tabs.sendMessage(tabId, cmd)` (tabId = params.tabId ?? active tab)
     - `screenshot` → `chrome.tabs.captureVisibleTab(winId, {format:'png'})` → dataURL
     - `getConsoleLogs/getNetworkLogs` → từ `chrome.storage.local` buffer (content script ghi)
     - Trả `{type:'result', id, ok, data?, error?}` qua WS.
   - Content script events: `chrome.runtime.onMessage` nhận `{kind:'event', name, data}` → forward qua WS `{type:'event', ...}`.
   - Trạng thái lưu `chrome.storage.local` `{bridgeConnected, bridgePort}`; broadcast cho popup.
3. `content.ts`:
   - `receiveMessage` handler: thực thi từng command, trả `Promise<{ok, data?, error?}>`:
     - `click`: `{selector}` (querySelector → `el.click()`, scrollIntoView trước) hoặc `{x,y}` (elementFromPoint → click)
     - `type`: `{selector, text}` → focus, set value (native setter), dispatch `input`+`change`
     - `select`: `{selector, value}` → set value + `change`
     - `scroll`: `{direction: 'up'|'down'|'top'|'bottom'}` hoặc `{selector}` (scrollIntoView)
     - `read`: `{selector?}` → `{url, title, text: innerText/outerText truncated (maxChars 12000), elements: interactiveElems(20) with uniqueSelector}`
     - `waitFor`: `{selector, timeoutMs}` → poll querySelector 200ms
     - `watchStart`/`watchStop`: MutationObserver → gửi `{kind:'event', name:'domChanged', data:{added, removed}}` debounce 300ms
     - `navigate` (fallback nếu background không xử lý): `location.href = url`
   - `uniqueSelector(el)`: ưu tiên `#id` → `[data-testid]` → `tag:nth-of-type` path (giới hạn depth 5).
   - Console intercept: override `console.log/info/warn/error/debug` + `window.onerror` + `unhandledrejection` → `{kind:'event', name:'console', data:{level, text, ts}}`.
   - Network intercept: hook `window.fetch` + `XMLHttpRequest` (open/send/onloadend) → `{kind:'event', name:'network', data:{method, url, status, ts}}`; đồng thời lưu vào `chrome.storage.local` buffer (cap 200).
   - Page load: `window.addEventListener('load')` → `{kind:'event', name:'tabUpdated', data:{status:'complete', url}}`.
4. `popup.html` + `popup.ts`: hiện trạng thái (port, connected/paired), ô nhập port (mặc định 3927, nút "Detect" gọi `/api/status`), ô nhập pairing code + nút Save (gửi background). CSS tối giản inline.
5. `scripts/build-extension.mjs`:
   ```js
   import { build } from 'esbuild'
   import { cpSync, mkdirSync } from 'node:fs'
   import path from 'node:path'
   const out = path.resolve('out/browser-extension')
   mkdirSync(out, { recursive: true })
   await build({ entryPoints: ['src/browser-extension/background.ts', 'src/browser-extension/content.ts', 'src/browser-extension/popup.ts'],
     bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', outdir: out, logLevel: 'info' })
   cpSync('src/browser-extension/manifest.json', path.join(out, 'manifest.json'))
   cpSync('src/browser-extension/popup.html', path.join(out, 'popup.html'))
   ```
   `--json` không cần; script dùng top-level await (package.json không có `"type":"module"` → đổi script thành `import()`? → dùng `esbuild` API qua CJS require hoặc đặt `scripts/build-extension.mjs` với ESM syntax chạy được vì `.mjs` luôn là ESM. OK).

**Kiểm thử**: `npm run build:extension` tạo `out/browser-extension/{manifest.json,background.js,content.js,popup.html,popup.js}`; `npm run typecheck` pass (extension TS hợp lệ, `@types/chrome`).
**Commit**: `feat(browser-extension): MV3 extension with DOM/console/network/screenshot commands`

---

### Task 4: BrowserBridge (main process)

**File**: `src/main/browser/bridge.ts` (mới), `tests/unit/browser/bridge.test.ts` (mới), `tests/integration/browser/bridge-flow.test.ts` (mới)

`BrowserBridge` — thuần Node (không import Electron), test được với Vitest:

```ts
export interface BridgeDeps {
  host?: string            // default '127.0.0.1'
  preferredPort?: number   // default 3927
  screenshotDir?: string   // nếu có, screenshot tự ghi file
  codeTtlMs?: number       // default 5 * 60_000
  maxLogEntries?: number   // default 200
  createServer?: () => HttpServer   // injectable cho test (mặc định node:http)
}

export class BrowserBridge {
  constructor(deps?: BridgeDeps)
  getStatus(): BrowserStatusInfo        // pairingCode chỉ khi chưa paired
  pair(): PairingInfo                   // sinh code mới (nếu hết hạn), reset trạng thái
  async start(): Promise<number>        // listen; trả port thật
  execute(name: BrowserCommandName, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<BrowserCommandResult>
  waitForPaired(timeoutMs: number): Promise<boolean>
  getConsoleLogs(limit?: number): ConsoleEntry[]
  getNetworkLogs(limit?: number): NetworkEntry[]
  onStatusChange(cb: (info: BrowserStatusInfo) => void): () => void
  close(): Promise<void>
}
```

Cấu trúc bên trong:
- `createServer()` → `http.createServer`; xử lý `GET /api/status` → `{port, status}` (kèm CORS header cho popup). Dùng `WebSocketServer({ server, host })` từ `ws`; `connection` → lắng nghe message.
- Pairing: `code` = 6 chữ số ngẫu nhiên (`crypto.randomInt(0, 1_000_000).toString().padStart(6,'0')`), `expiresAt = now + ttl`. Nhận `{type:'pair', code}`:
  - đúng + chưa hết hạn → `paired=true`, gửi `{type:'pair_result', ok:true}`, status → `paired`
  - sai/hết hạn → `{type:'pair_result', ok:false, error}` , giữ kết nối mở (cho phép thử lại)
- Command router: `execute()` tạo `id = crypto.randomUUID()`, lưu `{resolve, reject, timer}` trong Map; gửi `{type:'cmd', id, name, params}`; nhận `{type:'result', id, ok, data?, error?}` → resolve. Timeout → reject `{ok:false, error:'browser command timed out'}`. Chưa paired → reject `{ok:false, error:'browser not connected — run browser_start first'}`. Không có WS client → reject tương tự.
- Ring buffer: `console`/`network` events append, trim cap.
- `waitForPaired`: promise chờ status `paired` (dùng `onStatusChange`), resolve khi đúng hoặc hết timeout.
- Screenshot: khi `screenshotDir` set và result `ok` với `data.base64` → decode + ghi `<screenshotDir>/<ts>.png`, trả `{path, size}`.
- `close()`: clear timers, close clients, close server, resolve pending.

**Test unit** (`tests/unit/browser/bridge.test.ts`) — dùng `ws` client thật tới `127.0.0.1:0`:
- start trả port > 0; `/api/status` trả port khớp.
- `pair()` sinh code 6 số; client gửi `{type:'pair', code}` đúng → `paired`, status = `paired`; sai → `ok:false`.
- `execute('listTabs')` chưa paired → error 'not connected'.
- Sau khi paired: client nhận `{type:'cmd', id, name:'listTabs'}`, trả `{type:'result', id, ok:true, data:{tabs:[]}}` → execute resolve.
- Timeout: client không trả lời → reject sau timeout ngắn (dùng timeoutMs=100).
- Ring buffer: gửi event console/network × 5 → `getConsoleLogs(3)` trả 3 mới nhất.
- `waitForPaired(1000)` resolve sau khi pair; reject nếu quá hạn.
- `close()` — kết nối client đóng, không treo.

**Test integration** (`tests/integration/browser/bridge-flow.test.ts`):
- Fake extension client: connect WS, pair bằng code từ `bridge.pair()`, xử lý loop: nhận cmd → trả result theo name (vd navigate → `{ok:true, data:{url}}`, read → fake DOM), forward events.
- Assert: `execute('navigate', {url})` trả result; console event từ client xuất hiện trong `getConsoleLogs`; sau `close()` client nhận close.

**Kiểm thử**: `npm test` (browser tests pass), `npm run typecheck`.
**Commit**: `feat(main): BrowserBridge ws server with pairing, command router, ring buffers`

---

### Task 5: Chrome launcher + install guide

**File**: `src/main/browser/chrome-launcher.ts` (mới)

```ts
export interface BrowserLauncherDeps {
  getWindow?: () => BrowserWindow | null
  extensionDir: string
}
export function createChromeLauncher(deps: BrowserLauncherDeps): BrowserLauncher
export interface BrowserLauncher {
  openChrome(): Promise<void>            // mở Chrome thật (executable path) tới chrome://extensions
  openExtensionFolder(): Promise<void>   // shell.openPath(extensionDir)
  showInstallGuide(): Promise<void>      // dialog.showMessageBox tiếng Việt [meow]
}
```

**0.17.0**: tái sử dụng `resolveChromeExecutablePath()` (export từ `src/main/chatgpt-web/browser-login.ts`)
để tìm đường dẫn Chrome thật. `openChrome()` spawn `chrome.exe --new-window chrome://extensions` thay vì
`shell.openExternal` (tránh phụ thuộc default browser). Import: `import { resolveChromeExecutablePath } from '../chatgpt-web/browser-login'`.

Nội dung guide (tiếng Việt, prefix `[meow]`):
```
[meow] Cài extension Meow Browser Bridge để agent điều khiển Chrome.
1. Nhấn "Mở chrome://extensions" (Chrome sẽ mở trang extension).
2. Bật Developer mode (góc phải trên).
3. Nhấn "Load unpacked" và chọn thư mục: <extensionDir>
4. Quay lại Meow, nhấn "Ghép nối" để lấy mã, nhập mã vào popup extension.
```
Buttons: `['Mở chrome://extensions', 'Mở thư mục extension', 'Đóng']`; xử lý click qua `dialog.showMessageBox` return value.

**Kiểm thử**: `npm run typecheck`. (Hàm dùng Electron dialog → không unit test; giữ mỏng.)
**Commit**: `feat(main): chrome launcher and install guide dialog`

---

### Task 6: Native browser tools + permission

**File**: `src/main/agent/tools/browser.ts` (mới), `src/main/agent/tools/registry.ts` (sửa), `src/main/agent/permission.ts` (sửa), `src/main/agent/config.ts` (sửa), `tests/unit/browser/agent-tools-browser.test.ts` (mới), `tests/unit/agent-config.test.ts` (sửa), `tests/unit/agent-permission.test.ts` (sửa)

1. `browser.ts`:
   ```ts
   export interface BrowserBridgeLike {
     getStatus(): BrowserStatusInfo
     execute(name, params?, timeoutMs?): Promise<BrowserCommandResult>
     waitForPaired(timeoutMs): Promise<boolean>
     getConsoleLogs(limit?): unknown[]
     getNetworkLogs(limit?): unknown[]
   }
   export interface BrowserLauncherLike {
     openChrome(): Promise<void>
     openExtensionFolder(): Promise<void>
     showInstallGuide(): Promise<void>
   }
   export function createBrowserTools(bridge: BrowserBridgeLike, launcher: BrowserLauncherLike): ToolDefinition[]
   ```
   Tools (zod schema, mô tả tiếng Anh — quy ước AGENTS.md):
   - `browser_start`: kiểm tra status; nếu chưa paired → `launcher.openChrome()` + `launcher.showInstallGuide()` + `waitForPaired(60_000)`; trả `{status, port, paired}` hoặc error nếu timeout.
   - `browser_navigate {url}` → `execute('navigate', {url})`
   - `browser_click {selector?, x?, y?}` → `execute('click', ...)`
   - `browser_type {selector, text}`
   - `browser_select {selector, value}`
   - `browser_scroll {direction? | selector?}`
   - `browser_read {selector?, maxChars?}` → output text + elements (compact)
   - `browser_screenshot {}` → trả path PNG
   - `browser_list_tabs` / `browser_switch_tab {tabId}` / `browser_close_tab {tabId}`
   - `browser_console {limit?}` / `browser_network {limit?}` — đọc ring buffer, output JSON compact
   - `browser_wait_for {selector, timeoutMs?}` → `execute('waitFor', ..., timeoutMs+5000)`
   Mỗi tool map kết quả: `ok` → `{output: JSON.stringify(data, null, 2)}`; `!ok` → `{error}`.
2. `registry.ts`: `DefaultToolsOptions` thêm `browser?: { bridge: BrowserBridgeLike; launcher: BrowserLauncherLike }`; trong `createDefaultTools`, nếu có → `...createBrowserTools(opts.browser.bridge, opts.browser.launcher)`.
   **0.17.0**: registry đã có `getUserDataDir?: () => string` + `office` tool (tạo sau khi có `userDataDir`) — thêm `browser` cạnh đó, **không phá logic office**.
3. `permission.ts` `PLAN_RULES`: thêm `'browser_*': 'ask'`.
4. `config.ts` `DEFAULT_MEOW_CONFIG.permission`: thêm `'browser_*': 'allow'`.
5. Test:
   - `agent-tools-browser.test.ts`: fake bridge (`execute` trả kết quả mặc định, `waitForPaired` true, logs mẫu); fake launcher (spy). Test từng tool: schema nhận input đúng, output/error mapping, `browser_start` khi chưa paired gọi launcher + trả status, khi paired không gọi launcher.
   - `agent-config.test.ts`: `DEFAULT_MEOW_CONFIG.permission['browser_*']` = `'allow'`.
   - `agent-permission.test.ts`: plan mode + `{...PLAN_RULES}` → `decidePermission('plan', DEFAULT_MEOW_CONFIG.permission, ()=>false, 'browser_click')` = `'ask'`; build mode → `'allow'`.

**Kiểm thử**: `npm test`, `npm run typecheck`.
**Commit**: `feat(agent): native browser tools with allow-by-default permission`

---

### Task 7: Wire vào MainApp + IPC + preload

**File**: `src/main/index.ts` (sửa), `src/preload/index.ts` (sửa)

1. `src/main/index.ts`:
   - Import `BrowserBridge`, `createChromeLauncher`.
   - Trong `MainApp` (hoặc module scope sau `mainApp`): tạo
     ```ts
     const extensionDir = path.join(app.getPath('userData'), 'browser-extension')
     const browserBridge = new BrowserBridge({ screenshotDir: path.join(app.getPath('userData'), 'browser-screenshots') })
     const browserLauncher = createChromeLauncher({ getWindow: () => win, extensionDir })
     ```
     (copy extension build → `extensionDir` ở `whenReady` — helper `copyExtensionToUserData()` trong chrome-launcher.ts hoặc inline: dev: `path.join(app.getAppPath(), 'out', 'browser-extension')`; packaged: `path.join(process.resourcesPath, 'browser-extension')`; copy nếu manifest version khác)
   - `createDefaultTools({ ..., browser: { bridge: browserBridge, launcher: browserLauncher } })`.
   - `app.whenReady()`: **0.17.0 đang sync** (`app.whenReady().then(() => {...})`) → đổi thành
     `app.whenReady().then(async () => {...})` để `await browserBridge.start()`;
     `browserBridge.onStatusChange(info => win?.webContents.send(Channels.EventBrowserStatus, info))`; copy extension.
   - `registerIpcHandlers` thêm:
     - `BrowserGetStatus` → `browserBridge.getStatus()`
     - `BrowserPair` → `browserBridge.pair()`
     - `BrowserOpenInstallGuide` → `browserLauncher.showInstallGuide()`
     - `BrowserOpenExtensionFolder` → `browserLauncher.openExtensionFolder()`
     - `BrowserGetConsoleLogs` / `BrowserGetNetworkLogs` → ring buffers
   - `before-quit` cleanup: `await browserBridge.close()` (thêm vào khối cleanup hiện có).
2. `src/preload/index.ts`: implement `browser.*` theo AgentApi (dùng `Channels.*`), `onBrowserStatus` qua helper `subscribe`.

**Kiểm thử**: `npm run typecheck`; `npm test` (ipc-contract pass). Build tay: `npm run build` không lỗi.
**Commit**: `feat(main): wire browser bridge, launcher, ipc handlers and preload api`

---

### Task 8: Renderer — status chip + pairing dialog

**File**: `src/renderer/src/components/BrowserDialog.tsx` (mới), `StatusBar.tsx` (sửa), `App.tsx` (sửa), `styles.css` (sửa)

1. `App.tsx`: state `browserStatus: BrowserStatusInfo | null`, `browserDialogOpen: boolean`; useEffect đăng ký `window.api.onBrowserStatus`; render `<StatusBar ... browser={browserStatus} onBrowserClick={() => setBrowserDialogOpen(true)} />` + `{browserDialogOpen && <BrowserDialog status={browserStatus} onClose={() => setBrowserDialogOpen(false)} />}`.
2. `StatusBar.tsx`: nhận props `browser?: BrowserStatusInfo | null`, `onBrowserClick?: () => void`; render chip `.sb-item sb-mono` với chấm màu (paired=green, listening/idle=amber, disconnected/error=red) + text `browser: paired|off`; click → `onBrowserClick`.
3. `BrowserDialog.tsx`:
   - Hiện trạng thái + port.
   - Nếu chưa paired: nút **"Ghép nối"** → `window.api.pairBrowser()` → hiện `pairingCode` (monospace, chọn được) + `expiresAt`; nút **"Mở hướng dẫn cài"** → `openBrowserInstallGuide()`; nút **"Mở thư mục extension"** → `openBrowserExtensionFolder()`.
   - Nếu paired: nút **"Đổi mã"** (pair lại) + text trạng thái.
   - Đóng bằng Escape (giống AddAgentDialog).
4. `styles.css`: `.sb-dot` (màu theo trạng thái), `.browser-code` (monospace), tái dùng `.dialog`, `.btn`.

**Kiểm thử**: `npm run typecheck`, `npm test`, `npm run build` (renderer build OK).
**Commit**: `feat(renderer): browser status chip and pairing dialog`

---

### Task 9: Docs + verification cuối

**File**: `docs/AGENTS.md` (sửa — ghi chú `src/browser-extension`, `src/main/browser`, lệnh `build:extension`), spec giữ nguyên.

1. Cập nhật `docs/AGENTS.md` (nếu tồn tại) và ghi chú ngắn vào AGENTS.md gốc: mục "Cấu trúc" thêm `src/browser-extension`, `src/main/browser`; lưu ý `npm run dev`/`build` chạy `build:extension` trước; browser chạy trên profile Chrome thật, chỉ bind 127.0.0.1, pairing code bắt buộc.
2. Kiểm thử bắt buộc:
   - `npm run typecheck` pass
   - `npm test` pass
   - `npm run build` pass (không cần e2e — browser không ảnh hưởng luồng e2e hiện có; nếu build có lỗi thì chạy `npm run e2e` theo AGENTS.md)
3. Kiểm thử tay (ghi vào PR description / hướng dẫn dùng):
   - `npm run dev` → chip browser hiện `listening`; mở dialog → Ghép nối → hiện code.
   - Load unpacked `userData/browser-extension` vào Chrome → nhập code → chip thành `paired`.
   - Chat với native agent: `browser_start`, `browser_navigate https://example.com`, `browser_read`, `browser_screenshot`, `browser_console`.

**Commit**: `docs: note browser feature and extension build step`

---

## 5. Rủi ro & lưu ý

- **Chrome không tự reload extension khi file thay đổi**: nếu sửa `src/browser-extension`, phải `npm run build:extension` và bấm Reload trong `chrome://extensions`.
- **`ws` là dependency runtime** (main build externalize) → đặt trong `dependencies`, không phải `devDependencies`.
- **Extension không dùng ES module** (IIFE) vì content script classic; tránh `import.meta` trong extension code.
- **Content script `<all_urls>` + cho phép tất cả tab** — rủi ro đã ghi nhận trong spec; chỉ bind 127.0.0.1 + pairing code là 2 lớp phòng vệ.
- **Plan mode**: `browser_*` trở thành `ask` — không làm lộ write path trong plan mode.
- **KHÔNG** expose `ipcRenderer` ra window; mọi thứ qua `window.api`.
- Screenshot file có thể lớn — content script gửi base64 qua WS; bridge ghi file rồi trả path (không giữ base64 trong tool output).
