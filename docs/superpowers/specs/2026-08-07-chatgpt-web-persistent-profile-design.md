# ChatGPT Web — Persistent Profile + Cloudflare Fallback: Design Spec

Ngày: 2026-08-07 · Trạng thái: chờ duyệt

## 1. Bối cảnh

Provider **chatgpt-web** (xem plan `2026-08-07-chatgpt-web-provider.md`) điều khiển một Chrome
thật để chat với `chatgpt.com` thay cho API key. Hai bug sau được phát hiện khi smoke test:

1. **Login flow**: `launchPersistentContext('', {...})` truyền empty string làm userDataDir → profile
   không thực sự persistent, storage state vẫn được save ra JSON nhưng thiếu các cookie quan trọng
   (`cf_clearance`, `__Secure-next-auth.session-token`).
2. **Chat flow**: `chromium.launch({headless: true})` + `newContext({storageState})` tạo browser
   ephemeral với fingerprint khác hoàn toàn so với Chrome visible đã login. Cloudflare phát hiện
   đổi fingerprint → trả về trang **"Just a moment..."** challenge → `#prompt-textarea` không bao
   giờ xuất hiện → timeout 30s.

Diagnostic script (`scripts/debug-chatgpt-headless.mjs`) xác nhận: title = `"Just a moment..."`,
`#prompt-textarea count = 0`, 11 cookies saved nhưng filter `cf_clearance` + session-token trả về
rỗng.

## 2. Mục tiêu

- Login flow dùng **persistent Chromium profile** thật, share được với chat flow.
- Chat flow mặc định **headless** nhưng **tự fallback sang visible** khi Cloudflare chặn.
- Browser profile preserve toàn bộ state (cookies, cache, IndexedDB, fingerprint signals) giữa
  login và chat → Cloudflare không thấy fingerprint đổi.
- Session token được capture đầy đủ (fix bug "auth cookie missing").
- UI render thông báo challenge bằng tiếng Việt, prefix `[meow]`, hiển thị trong renderer.

## 3. Phạm vi

### Trong phạm vi
- Sửa `src/main/chatgpt-web/{session-store,browser-login,browser-worker,client,manager}.ts`.
- Thêm IPC channel `EventChatGptWebChallenge` + `onChatGptWebChallenge` API.
- Renderer subscribe challenge event, render toast (tiếng Việt, prefix `[meow]`).
- Cleanup `browser-profile/` trong `logout()`.
- Plan doc `2026-08-07-chatgpt-web-provider.md` Task 14 được update với manual smoke steps mới.

### Ngoài phạm vi (defer)
- Multi-account Chrome profile (chỉ support 1 ChatGPT account).
- Tự động xoay vòng `cf_clearance` khi expire (user tự giải challenge khi cần).
- Stealth plugin (`playwright-extra` + `puppeteer-extra-plugin-stealth`).
- Tách chat flow ra khỏi main process (chạy worker process riêng).
- E2E test cho browser flow (giữ manual smoke test như plan Task 14).

## 4. Quyết định

| Chủ đề | Quyết định |
|---|---|
| userDataDir cho persistent profile | `app.getPath('userData')/chatgpt-web/browser-profile/` |
| storage-state.json | Vẫn save trong login (backup/migration nếu profile bị mất) |
| Chat mặc định | `launchPersistentContext(userDataDir, { headless: true, storageState })` |
| Phát hiện Cloudflare | `await page.title()` chứa `"Just a moment..."` |
| Fallback | Đóng context cũ → `launchPersistentContext(userDataDir, { headless: false })` → wait 5 phút |
| Cleanup khi logout | `rmSync` cả `storage-state.json` lẫn `browser-profile/` (recursive) |
| IPC notifier | Channel mới `EventChatGptWebChallenge`, payload `{ reason: 'cloudflare' \| 'session-expired' }` |
| UI | Toast/modal trong renderer, tiếng Việt prefix `[meow]` |
| Test | Unit (Vitest) + Manual smoke (Task 14); không E2E |

## 5. Kiến trúc & luồng dữ liệu

### 5.1. Thư mục userData sau fix

```
userData/chatgpt-web/
├── config.json                       ← enabled flag + custom Chrome path
├── storage-state.json                ← JSON cookies (backup, vẫn save trong login)
└── browser-profile/                  ← persistent Chromium profile (NEW)
    ├── Cookies
    ├── Local Storage/
    ├── IndexedDB/
    ├── Cache/
    └── ...
```

### 5.2. Login flow (sau fix)

```
ChatGptWebManager.login()
  → loginToChatGptWeb(store)
     1. resolveChromeExecutablePath()                      // tìm Chrome
     2. launchPersistentContext(userDataDir, {headless:false, args:[...]})
     3. goto chatgpt.com/?temporary-chat=true
     4. page.waitForSelector('#prompt-textarea', 5min)    // user login xong
     5. context.storageState() → storage-state.json       // backup
     6. close context                                      // profile persist trên disk
```

### 5.3. Chat flow (sau fix)

```
LlmClient.stream(opts)
  → createChatGptWebPage(userDataDir, storageStatePath, chromeExecutablePath)
     → launchPersistentContext(userDataDir, {headless:true, storageState})
     → return wrapPlaywrightPage(page)
  → runChatGptWebTurn(page, recreate, prompt, effort, signal, options)

runChatGptWebTurn:
  try {
    await page.goto(chatgpt.com/?temporary-chat=true)
    await page.waitForSelector(SELECTORS.composer, 30s)
    // ... type + send + poll response ...
  } catch (err) {
    if (err is timeout && (await page.title()).includes('Just a moment')) {
      options.onFallback?.('cloudflare')                   // IPC notify user
      await page.close()
      page = await recreate('visible')                     // headless:false
      await page.waitForSelector(SELECTORS.composer, 5min) // user giải challenge
      // ... retry flow ...
    } else if (page.url().includes('/auth/login')) {
      throw new Error('[meow] Phiên đăng nhập ChatGPT đã hết hạn...')
    } else {
      throw err
    }
  }
```

### 5.4. Cleanup khi logout

```
ChatGptWebManager.logout()
  → rmSync(storage-state.json, { force: true })
  → rmSync(userDataDir/browser-profile, { recursive, force: true })
  → getStatus()  // loggedIn = false
```

## 6. IPC contracts

### 6.1. Channel mới

| Channel string | Hằng số | Payload | Hướng |
|---|---|---|---|
| `'chatgpt-web:challenge'` | `EventChatGptWebChallenge` | `ChallengeEvent` | main → renderer |

### 6.2. Types (thêm vào `src/shared/ipc.ts`)

```typescript
export type ChallengeReason = 'cloudflare' | 'session-expired'

export interface ChallengeEvent {
  reason: ChallengeReason
  timestamp: string   // ISO
}
```

### 6.3. Preload API

```typescript
onChatGptWebChallenge(cb: (e: ChallengeEvent) => void): () => void
```

### 6.4. Wire-up (`src/main/index.ts`)

```typescript
chatGptWeb = new ChatGptWebManager(userDataDir, {
  notifyChallenge: (event) => {
    mainWindow.webContents.send(Channels.EventChatGptWebChallenge, event)
  }
})
```

## 7. File-by-file changes

| File | Thay đổi chi tiết |
|---|---|
| `src/main/chatgpt-web/session-store.ts` | Thêm `userDataDir(): string { return this.dir }` |
| `src/main/chatgpt-web/browser-login.ts` | `loginToChatGptWeb(store, userDataDir)`. Body: `launchPersistentContext(userDataDir, {...})` (bỏ `''`) |
| `src/main/chatgpt-web/browser-worker.ts` | `createChatGptWebPage(userDataDir, storageStatePath, chromeExecutablePath?)`. Đổi sang `launchPersistentContext(userDataDir, { headless: true, storageState })`. Thêm `title(): Promise<string>` vào `ChatGptWebPage`. `runChatGptWebTurn(page, recreate, prompt, effort, signal, options)`. Options có `onFallback?: (r: ChallengeReason) => void` |
| `src/main/chatgpt-web/client.ts` | Tạo factory closure `(mode: 'headless' \| 'visible') => Promise<ChatGptWebPage>` truyền cho `runChatGptWebTurn` làm `recreate`. Yield `kind: 'info'` part khi fallback triggered |
| `src/main/chatgpt-web/manager.ts` | Constructor nhận thêm `notifyChallenge`. `login()` pass `userDataDir` cho `loginToChatGptWeb`. `logout()` rmSync cả `storage-state.json` lẫn `browser-profile/` |
| `src/shared/ipc.ts` | Thêm `EventChatGptWebChallenge`, `ChallengeReason`, `ChallengeEvent`, `onChatGptWebChallenge` |
| `src/main/index.ts` | Khởi tạo `ChatGptWebManager(userDataDir, { notifyChallenge })` với callback gọi `webContents.send`. Handler IPC cho `EventChatGptWebChallenge` không cần (chỉ send từ main) |
| `src/preload/index.ts` | Expose `onChatGptWebChallenge` qua `contextBridge` |
| Renderer (nơi có alert UI) | Subscribe `window.api.onChatGptWebChallenge`, render toast tiếng Việt prefix `[meow]` |
| `docs/superpowers/plans/2026-08-07-chatgpt-web-provider.md` | Update Task 14 manual smoke test với steps mới (xem §10) |
| `tests/unit/chatgpt-web/` (nếu chưa có) | Vitest cho `manager`, `runChatGptWebTurn` với mock page |

## 8. Interface contracts

### 8.1. `ChatGptWebPage` (mở rộng)

```typescript
export interface ChatGptWebPage {
  goto(url: string): Promise<void>
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<void>
  click(selector: string): Promise<void>
  insertText(text: string): Promise<void>
  readDialogText(): Promise<string | null>
  readSnapshot(): Promise<{ hasStopButton: boolean; hasCopyButton: boolean; text: string }>
  title(): Promise<string>                                  // NEW
  close(): Promise<void>
}
```

### 8.2. `runChatGptWebTurn` (mới)

```typescript
export type PageMode = 'headless' | 'visible'

export interface RunTurnOptions {
  pollIntervalMs?: number
  timeoutMs?: number
  onFallback?: (reason: ChallengeReason) => void           // NEW
}

export async function runChatGptWebTurn(
  page: ChatGptWebPage,
  recreate: (mode: PageMode) => Promise<ChatGptWebPage>,    // NEW — caller provides factory
  prompt: string,
  effort: ChatGptWebEffortLevel,
  signal?: AbortSignal,
  options?: RunTurnOptions
): Promise<string>
```

## 9. Xử lý lỗi

| # | Tình huống | Message (tiếng Việt, prefix `[meow]`) | Hành động |
|---|---|---|---|
| E1 | CF challenge khi chat headless | `[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở.` | Fallback visible, retry với timeout 5 phút |
| E2 | User không giải trong 5 phút | `[meow] Cloudflare challenge không được giải. Vui lòng thử lại.` | Throw, kết thúc turn |
| E3 | URL = `/auth/login` sau khi pass CF | `[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.` | Throw, kết thúc turn |
| E4 | Browser profile locked | `[meow] ChatGPT Web provider đang bận. Vui lòng thử lại sau.` | Throw nếu `err.message.includes('already in use')` |
| E5 | `storage-state.json` corrupted | `[meow] Stored session bị lỗi. Vui lòng đăng nhập lại từ Settings.` | Catch trong `createChatGptWebPage`, throw |
| E6 | Chrome version cũ | `[meow] Chrome của bạn quá cũ. Vui lòng cập nhật hoặc chọn Chrome khác trong Settings.` | Catch `chromium.launch` error, throw |
| E7 | Không tìm thấy Chrome | `"No Chrome installation found. Set a custom Chrome path in Settings."` | Đã có sẵn ở `resolveChromeExecutablePath` |
| E8 | userData dir không writable | Error từ `launchPersistentContext`, bubble lên UI | Không wrap |
| E9 | Network fail giữa turn | Error từ page operations, AbortSignal + poll deadline | Đã có sẵn |

## 10. Kiểm thử

### 10.1. Unit tests (Vitest, không cần browser thật)

File mới: `tests/unit/chatgpt-web/manager.test.ts`, `tests/unit/chatgpt-web/browser-worker.test.ts`.

- `manager.test.ts`:
  - `login()` gọi `loginToChatGptWeb(store, userDataDir)`, persist marker.
  - `login()` throw "No Chrome" → bubble.
  - `logout()` xóa cả `storage-state.json` lẫn `browser-profile/` (dùng mock `rmSync`).
  - `getStatus()` đúng sau login/logout.
  - `setEnabled(true)` không ảnh hưởng `loggedIn`.

- `browser-worker.test.ts`:
  - `runChatGptWebTurn`: composer xuất hiện bình thường → không gọi `recreate`.
  - `runChatGptWebTurn`: timeout + title `"Just a moment..."` → gọi `recreate()` + `onFallback('cloudflare')`.
  - `runChatGptWebTurn`: timeout + title khác → throw không gọi recreate.
  - `runChatGptWebTurn`: AbortSignal.aborted() → throw ngay.

### 10.2. Manual smoke test (cập nhật Task 14 trong plan)

1. App mới cài: Settings → "Login ChatGPT Web" → Chrome visible mở → login thủ công → đóng →
   verify `userData/chatgpt-web/storage-state.json` và `browser-profile/Cookies` tồn tại.
2. Gửi message qua chatgpt-web provider → chat flow mở headless Chrome → response trả về.
3. Xóa `storage-state.json` thủ công nhưng giữ `browser-profile/` → gửi message → vẫn work
   (cookies trong profile vẫn còn, ephemeral context load từ profile).
4. Test fallback: corrupt cookies trong profile (`browser-profile/Cookies` rỗng) → gửi message →
   Chrome visible pop up + toast `[meow] Cloudflare cần xác minh` → giải → chat tiếp tục.
5. Logout từ Settings → verify cả `storage-state.json` lẫn `browser-profile/` bị xóa.
6. Login lại → verify `browser-profile/` mới được tạo.

### 10.3. Không test

- Live Cloudflare detection (flaky, Cloudflare liên tục đổi).
- Real ChatGPT login (cần account thật + CAPTCHA thủ công).
- Fingerprinting internals.

## 11. Tiêu chí thành công

- [ ] `npm run typecheck` pass.
- [ ] `npm test` pass (unit tests mới + existing).
- [ ] Manual smoke §10.2 hoàn thành 6 bước.
- [ ] Headless chat trong app thực sự gửi được message và nhận response (không còn lỗi timeout
      `#prompt-textarea`).
- [ ] Fallback visible kích hoạt khi cookies bị corrupt, user giải được challenge, chat tiếp tục.
- [ ] Logout xóa sạch cả JSON lẫn profile directory.
- [ ] Toast tiếng Việt prefix `[meow]` hiển thị trong renderer khi fallback.
- [ ] Plan doc Task 14 được update với manual smoke mới.

## 12. Rủi ro & mở rộng tương lai

| Rủi ro | Hiện tại | Mở rộng nếu cần |
|---|---|---|
| Fallback visible fires quá thường xuyên | Acceptable, user tự giải khi cần | Thêm stealth plugin, dùng `headless: 'new'` |
| Cloudflare rotate `cf_clearance` liên tục | User phải giải lại mỗi lần | Tự động re-solve bằng headless stealth + 2captcha |
| Multi-account | Chỉ 1 account | Thêm profile dir theo account ID |
| Browser profile disk usage | Tăng theo thời gian (~50-200 MB) | Thêm cleanup policy (LRU, hoặc xóa khi >X MB) |
| Chat flow chạy trong main process | Ảnh hưởng perf nếu nhiều turn | Tách ra worker process riêng |