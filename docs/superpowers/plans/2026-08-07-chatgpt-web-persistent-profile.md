# ChatGPT Web — Persistent Profile + Cloudflare Fallback: Implementation Plan

Trạng thái: chờ duyệt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa bug Cloudflare block headless Chrome và bug empty-string userDataDir trong provider chatgpt-web (xem spec `docs/superpowers/specs/2026-08-07-chatgpt-web-persistent-profile-design.md`). Login + chat flow dùng chung persistent Chromium profile; chat mặc định headless, tự fallback visible khi Cloudflare chặn.

**Architecture:** Mở rộng module `src/main/chatgpt-web/` hiện có. Thay `chromium.launch + newContext(storageState)` bằng `chromium.launchPersistentContext(userDataDir, {headless, storageState})` ở cả login lẫn chat. Thêm IPC channel `EventChatGptWebChallenge` để renderer nhận thông báo khi cần user xác minh.

**Tech Stack:** TypeScript, `playwright-core` (đã có), Vitest cho unit test. Không thêm E2E (giữ manual smoke như plan gốc `2026-08-07-chatgpt-web-provider.md`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-chatgpt-web-persistent-profile-design.md` — mọi task dưới đây implement đúng theo spec.
- Giữ nguyên hành vi các provider khác (anthropic, openai-compatible, ...).
- IPC channel mới **không hardcode** string; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- System messages tiếng Việt, prefix `[meow]` (theo AGENTS.md).
- File path trong test/code dùng forward slash (`path.join` trong code).
- Mỗi task có verification step (typecheck hoặc test chạy được).
- Commit nhỏ, mỗi task 1 commit nếu có thể.

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `src/main/chatgpt-web/session-store.ts` | Sửa | Thêm `userDataDir()` getter |
| `src/main/chatgpt-web/manager.ts` | Sửa | Nhận `notifyChallenge` dep; `login()` pass `userDataDir`; `logout()` xóa cả JSON lẫn profile |
| `src/main/chatgpt-web/browser-login.ts` | Sửa | `loginToChatGptWeb(store, userDataDir)`; `launchPersistentContext(userDataDir, ...)` (bỏ `''`) |
| `src/main/chatgpt-web/browser-worker.ts` | Sửa | `ChatGptWebPage.title()` mới; `createChatGptWebPage(userDataDir, storageState, chromePath?)` dùng `launchPersistentContext`; `runChatGptWebTurn(page, recreate, ...)` với fallback logic |
| `src/main/chatgpt-web/client.ts` | Sửa | Tạo factory closure cho `recreate`; yield info part khi fallback |
| `src/shared/ipc.ts` | Sửa | Thêm `EventChatGptWebChallenge`, `ChallengeReason`, `ChallengeEvent`, `onChatGptWebChallenge` |
| `src/main/index.ts` | Sửa | Khởi tạo `ChatGptWebManager` với `notifyChallenge` callback |
| `src/preload/index.ts` | Sửa | Expose `onChatGptWebChallenge` qua `contextBridge` |
| `src/renderer/src/...` (nơi có alert/notification UI) | Sửa | Subscribe challenge event, render toast tiếng Việt `[meow]` |
| `docs/superpowers/plans/2026-08-07-chatgpt-web-provider.md` | Sửa | Update Task 14 manual smoke test với 6 steps mới |
| `tests/unit/chatgpt-web/manager.test.ts` | Mới | Unit test cho `manager` |
| `tests/unit/chatgpt-web/browser-worker.test.ts` | Mới | Unit test cho fallback logic |

---

## Task 1: Thêm types & IPC contracts (no behavior change)

**Files:**
- `src/shared/ipc.ts`

**Steps:**
- [ ] Mở `src/shared/ipc.ts`.
- [ ] Trong `Channels` const object (xem file hiện tại để biết vị trí), thêm:
  ```ts
  EventChatGptWebChallenge: 'chatgpt-web:challenge'
  ```
- [ ] Trong types section, thêm:
  ```ts
  export type ChallengeReason = 'cloudflare' | 'session-expired'

  export interface ChallengeEvent {
    reason: ChallengeReason
    timestamp: string
  }
  ```
- [ ] Trong interface API (preload contract), thêm:
  ```ts
  onChatGptWebChallenge(cb: (e: ChallengeEvent) => void): () => void
  ```
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `chore(chatgpt-web): add EventChatGptWebChallenge IPC contract`

---

## Task 2: session-store.userDataDir() getter

**Files:**
- `src/main/chatgpt-web/session-store.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/session-store.ts`.
- [ ] Trong class `ChatGptWebSessionStore`, thêm method public:
  ```ts
  userDataDir(): string {
    return this.dir
  }
  ```
- [ ] Không thêm comment thừa.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): expose userDataDir from session store`

---

## Task 3: manager.login() pass userDataDir + logout() clean both

**Files:**
- `src/main/chatgpt-web/manager.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/manager.ts`.
- [ ] Sửa `ChatGptWebManagerDeps` interface, thêm:
  ```ts
  export interface ChatGptWebManagerDeps {
    login?: (store: ChatGptWebSessionStore, userDataDir: string) => Promise<{ authenticated: boolean; verifiedAt: string }>
    notifyChallenge?: (event: ChallengeEvent) => void
  }
  ```
- [ ] Import `ChallengeEvent` từ `../../shared/ipc` (đã có sẵn `ipc.ts` import trong file? Kiểm tra; nếu chưa thì thêm).
- [ ] Constructor: giữ nguyên, không lưu `notifyChallenge` vào field (chỉ pass vào `login` flow nếu cần — nhưng `login` không cần notifier, chỉ `client.ts` mới cần).
- [ ] Sửa `login()`:
  ```ts
  async login(): Promise<ChatGptWebStatus> {
    const loginFn = this.deps.login ?? (await import('./browser-login')).loginToChatGptWeb
    const marker = await loginFn(this.store, this.store.userDataDir())
    this.store.writeVerifiedMarker(marker)
    return this.getStatus()
  }
  ```
- [ ] Sửa `logout()`:
  ```ts
  logout(): ChatGptWebStatus {
    const dir = this.store.userDataDir()
    rmSync(path.join(dir, 'storage-state.json'), { force: true })
    rmSync(path.join(dir, 'browser-profile'), { recursive: true, force: true })
    return this.getStatus()
  }
  ```
- [ ] Thêm `import { rmSync } from 'node:fs'` ở đầu file (nếu chưa có).
- [ ] Import `path` từ `node:path` (nếu chưa có).
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): manager passes userDataDir to login and cleans both on logout`

---

## Task 4: browser-login dùng userDataDir thật (bỏ `''`)

**Files:**
- `src/main/chatgpt-web/browser-login.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/browser-login.ts`.
- [ ] Sửa signature `loginToChatGptWeb`:
  ```ts
  export async function loginToChatGptWeb(
    store: ChatGptWebSessionStore,
    userDataDir: string
  ): Promise<{ authenticated: boolean; verifiedAt: string }>
  ```
- [ ] Thay `chromium.launchPersistentContext('', {...})` thành:
  ```ts
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  })
  ```
- [ ] Đảm bảo `mkdirSync` cho `userDataDir` trước khi `launchPersistentContext` (nếu chưa có). `launchPersistentContext` thường tự tạo, nhưng thêm `mkdirSync(userDataDir, { recursive: true })` để chắc.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `fix(chatgpt-web): use real userDataDir for persistent login context`

---

## Task 5: browser-worker - thêm title() vào ChatGptWebPage abstraction

**Files:**
- `src/main/chatgpt-web/browser-worker.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/browser-worker.ts`.
- [ ] Trong `interface ChatGptWebPage`, thêm method:
  ```ts
  title(): Promise<string>
  ```
- [ ] Trong hàm `wrapPlaywrightPage(page)` (đã có trong file — tìm `return wrapPlaywrightPage`), thêm implementation:
  ```ts
  title: () => page.title()
  ```
  (Đặt trong object spread cùng các method khác.)
- [ ] Cập nhật mock `wrapPlaywrightPage` trong test (nếu đã có trong file test cũ) — sẽ làm trong Task 9.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): add title() to ChatGptWebPage abstraction`

---

## Task 6: browser-worker - createChatGptWebPage với launchPersistentContext

**Files:**
- `src/main/chatgpt-web/browser-worker.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/browser-worker.ts`.
- [ ] Sửa signature `createChatGptWebPage`:
  ```ts
  export async function createChatGptWebPage(
    userDataDir: string,
    storageStatePath: string,
    chromeExecutablePath?: string
  ): Promise<ChatGptWebPage>
  ```
- [ ] Sửa body:
  ```ts
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: true,
    storageState: storageStatePath
  })
  const page = context.pages()[0] ?? (await context.newPage())
  return wrapPlaywrightPage(page)
  ```
- [ ] Bỏ check `if (!existsSync(storageStatePath))` — persistent context sẽ tự load từ profile nếu file JSON không tồn tại. Nếu muốn giữ check, đổi thành cảnh báo log thay vì throw.
  - **Quyết định**: bỏ check, vì profile là source of truth. Nếu cả profile lẫn JSON đều rỗng thì Cloudflare sẽ thất bại ở `waitForSelector` và fallback sẽ trigger.
- [ ] Thêm `mkdirSync(userDataDir, { recursive: true })` ở đầu body.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): createChatGptWebPage uses persistent context`

---

## Task 7: browser-worker - runChatGptWebTurn fallback logic

**Files:**
- `src/main/chatgpt-web/browser-worker.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/browser-worker.ts`.
- [ ] Thêm type:
  ```ts
  export type PageMode = 'headless' | 'visible'
  ```
- [ ] Sửa `RunTurnOptions`:
  ```ts
  export interface RunTurnOptions {
    pollIntervalMs?: number
    timeoutMs?: number
    onFallback?: (reason: ChallengeReason) => void
  }
  ```
- [ ] Import `ChallengeReason` từ `../../shared/ipc`.
- [ ] Sửa signature `runChatGptWebTurn`:
  ```ts
  export async function runChatGptWebTurn(
    page: ChatGptWebPage,
    recreate: (mode: PageMode) => Promise<ChatGptWebPage>,
    prompt: string,
    effort: ChatGptWebEffortLevel,
    signal?: AbortSignal,
    options: RunTurnOptions = {}
  ): Promise<string>
  ```
- [ ] Trong body, sau `await page.waitForSelector(SELECTORS.composer)`:
  ```ts
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.includes('Timeout')
    if (isTimeout && (await page.title()).toLowerCase().includes('just a moment')) {
      options.onFallback?.('cloudflare')
      await page.close()
      page = await recreate('visible')
      await page.waitForSelector(SELECTORS.composer, { timeout: 5 * 60 * 1000 })
      // retry từ đầu (không dùng recursion để tránh loop)
      return runTurnBody(page, recreate, prompt, effort, signal, options)
    }
    if (isTimeout && page.url().includes('/auth/login')) {
      throw new Error('[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.')
    }
    throw err
  }
  ```
- [ ] Refactor `runChatGptWebTurn` thành wrapper gọi `runTurnBody` để có thể retry:
  ```ts
  export async function runChatGptWebTurn(page, recreate, prompt, effort, signal, options = {}) {
    return runTurnBody(page, recreate, prompt, effort, signal, options)
  }

  async function runTurnBody(
    page: ChatGptWebPage,
    recreate: (mode: PageMode) => Promise<ChatGptWebPage>,
    prompt: string,
    effort: ChatGptWebEffortLevel,
    signal?: AbortSignal,
    options: RunTurnOptions
  ): Promise<string> {
    // ... toàn bộ logic hiện tại ...
  }
  ```
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): runChatGptWebTurn fallback to visible on Cloudflare challenge`

---

## Task 8: client.ts factory closure cho recreate

**Files:**
- `src/main/chatgpt-web/client.ts`

**Steps:**
- [ ] Mở `src/main/chatgpt-web/client.ts`.
- [ ] Trong `stream()`, sau khi tạo `page` ban đầu, tạo factory closure:
  ```ts
  const recreate = async (mode: 'headless' | 'visible'): Promise<ChatGptWebPage> => {
    await page.close().catch(() => undefined)
    return createChatGptWebPage(
      store.userDataDir(),
      store.storageStatePath(),
      cfg.chromeExecutablePath,
      mode
    )
  }
  ```
- [ ] Cập nhật call `createChatGptWebPage` signature:
  ```ts
  const page = await createChatGptWebPage(
    store.userDataDir(),
    store.storageStatePath(),
    cfg.chromeExecutablePath,
    'headless'
  )
  ```
- [ ] Sửa call `runChatGptWebTurn`:
  ```ts
  const markdown = await runChatGptWebTurn(page, recreate, prompt, effort, opts.signal, {
    onFallback: (reason) => {
      // yield info part tới renderer
      // (cần chuyển stream thành generator đã yield được, xem note dưới)
    }
  })
  ```
- [ ] **Note về `onFallback` trong generator**: Vì `stream()` là async generator, không thể yield từ callback. Có 2 lựa chọn:
  - **Lựa chọn A (đơn giản)**: Bỏ yield info part; chỉ gọi `notifyChallenge` qua closure từ `ChatGptWebManager`. `notifyChallenge` được inject qua `deps` của `client.ts` (cần thêm deps).
  - **Lựa chọn B**: Yield từ trước khi vào `runChatGptWebTurn` (informational), sau đó gọi.
  - **Chốt**: dùng A — inject `notifyChallenge` qua `createChatGptWebLlmClient(store, { notifyChallenge })`.
- [ ] Sửa `createChatGptWebLlmClient`:
  ```ts
  export function createChatGptWebLlmClient(
    store: ChatGptWebSessionStore,
    deps: { notifyChallenge?: (event: ChallengeEvent) => void } = {}
  ): LlmClient
  ```
- [ ] Truyền `notifyChallenge` vào `onFallback`:
  ```ts
  const markdown = await runChatGptWebTurn(page, recreate, prompt, effort, opts.signal, {
    onFallback: (reason) => deps.notifyChallenge?.({ reason, timestamp: new Date().toISOString() })
  })
  ```
- [ ] Import `ChallengeEvent` từ `../../shared/ipc`.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): client wires recreate factory and challenge notifier`

---

## Task 9: Unit tests cho fallback logic

**Files:**
- `tests/unit/chatgpt-web/browser-worker.test.ts`

**Steps:**
- [ ] Tạo file mới `tests/unit/chatgpt-web/browser-worker.test.ts`.
- [ ] Setup:
  ```ts
  import { describe, it, expect, vi } from 'vitest'
  import { runChatGptWebTurn, type ChatGptWebPage } from '../../../src/main/chatgpt-web/browser-worker'
  import type { ChatGptWebEffortLevel } from '../../../src/main/chatgpt-web/model-catalog'

  function makeMockPage(overrides: Partial<ChatGptWebPage> = {}): ChatGptWebPage {
    return {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      insertText: vi.fn(async () => undefined),
      readDialogText: vi.fn(async () => null),
      readSnapshot: vi.fn(async () => ({ hasStopButton: false, hasCopyButton: false, text: '' })),
      title: vi.fn(async () => ''),
      close: vi.fn(async () => undefined),
      ...overrides
    }
  }
  ```
- [ ] Test case 1 — composer xuất hiện bình thường:
  ```ts
  it('completes turn when composer is visible', async () => {
    const page = makeMockPage()
    const recreate = vi.fn(async () => page)
    const onFallback = vi.fn()

    await runChatGptWebTurn(page, recreate, 'hi', 'low' as ChatGptWebEffortLevel, undefined, { onFallback })

    expect(recreate).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
  })
  ```
- [ ] Test case 2 — timeout + title "Just a moment..." → recreate + onFallback:
  ```ts
  it('falls back to visible when Cloudflare challenge detected', async () => {
    const failingPage = makeMockPage({
      waitForSelector: vi.fn(async () => { throw new Error('Timeout 30000ms exceeded') }),
      title: vi.fn(async () => 'Just a moment...')
    })
    const visiblePage = makeMockPage()
    const recreate = vi.fn(async (mode) => {
      expect(mode).toBe('visible')
      return visiblePage
    })
    const onFallback = vi.fn()

    await runChatGptWebTurn(failingPage, recreate, 'hi', 'low' as ChatGptWebEffortLevel, undefined, { onFallback })

    expect(recreate).toHaveBeenCalledWith('visible')
    expect(onFallback).toHaveBeenCalledWith('cloudflare')
    expect(failingPage.close).toHaveBeenCalled()
  })
  ```
- [ ] Test case 3 — timeout + title khác → throw:
  ```ts
  it('throws when timeout is not due to Cloudflare', async () => {
    const failingPage = makeMockPage({
      waitForSelector: vi.fn(async () => { throw new Error('Timeout 30000ms exceeded') }),
      title: vi.fn(async () => 'ChatGPT')
    })
    const recreate = vi.fn()

    await expect(
      runChatGptWebTurn(failingPage, recreate as any, 'hi', 'low' as ChatGptWebEffortLevel)
    ).rejects.toThrow('Timeout')
    expect(recreate).not.toHaveBeenCalled()
  })
  ```
- [ ] Chạy `npm test -- browser-worker` — phải pass.

**Verify:** `npm test -- browser-worker` exit 0, 3 tests pass.

**Commit:** `test(chatgpt-web): unit tests for Cloudflare fallback`

---

## Task 10: Unit tests cho manager

**Files:**
- `tests/unit/chatgpt-web/manager.test.ts`

**Steps:**
- [ ] Tạo file mới `tests/unit/chatgpt-web/manager.test.ts`.
- [ ] Setup:
  ```ts
  import { describe, it, expect, vi } from 'vitest'
  import { mkdtempSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import { ChatGptWebManager } from '../../../src/main/chatgpt-web/manager'
  ```
- [ ] Test case 1 — `login()` gọi `loginToChatGptWeb` với `userDataDir`:
  ```ts
  it('login() passes userDataDir to loginToChatGptWeb', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-'))
    const loginFn = vi.fn(async () => ({ authenticated: true, verifiedAt: new Date().toISOString() }))
    const mgr = new ChatGptWebManager(dir, { login: loginFn })

    await mgr.login()

    expect(loginFn).toHaveBeenCalledTimes(1)
    const [store, userDataDir] = loginFn.mock.calls[0]
    expect(userDataDir).toBe(dir)
    expect(mgr.getStatus().loggedIn).toBe(true)
  })
  ```
- [ ] Test case 2 — `logout()` xóa cả JSON lẫn profile:
  ```ts
  it('logout() removes storage-state.json and browser-profile/', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-'))
    const profileDir = path.join(dir, 'browser-profile')
    require('node:fs').mkdirSync(profileDir, { recursive: true })
    require('node:fs').writeFileSync(path.join(dir, 'storage-state.json'), '{}')

    const mgr = new ChatGptWebManager(dir)
    mgr.logout()

    expect(require('node:fs').existsSync(path.join(dir, 'storage-state.json'))).toBe(false)
    expect(require('node:fs').existsSync(profileDir)).toBe(false)
  })
  ```
- [ ] Chạy `npm test -- manager` — phải pass.

**Verify:** `npm test -- manager` exit 0, 2 tests pass.

**Commit:** `test(chatgpt-web): unit tests for manager login/logout`

---

## Task 11: Wire notifyChallenge trong main/index.ts

**Files:**
- `src/main/index.ts`

**Steps:**
- [ ] Mở `src/main/index.ts`.
- [ ] Tìm chỗ khởi tạo `chatGptWeb` (khoảng dòng 62):
  ```ts
  chatGptWeb = new ChatGptWebManager(path.join(app.getPath('userData'), 'chatgpt-web'))
  ```
- [ ] Sửa thành:
  ```ts
  chatGptWeb = new ChatGptWebManager(path.join(app.getPath('userData'), 'chatgpt-web'), {
    notifyChallenge: (event) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      win?.webContents.send(Channels.EventChatGptWebChallenge, event)
    }
  })
  ```
- [ ] Đảm bảo `BrowserWindow` và `Channels` đã được import.
- [ ] Tìm nơi `chatGptWeb` được truyền cho `meowAgent` (khoảng dòng 66). Truyền thêm `notifyChallenge` xuống `createChatGptWebLlmClient` nếu cần — kiểm tra `meowAgent` có dùng `chatGptWeb.getSessionStore()` hay không. Nếu có, xem cách wire sao cho `notifyChallenge` đến được `client.ts`.
- [ ] **Note**: `client.ts` không tự wire `notifyChallenge` — nó nhận qua constructor deps. Cần xem cách `meow-agent-manager.ts` (hoặc nơi tạo `LlmClient`) truyền deps. Có thể cần thêm wiring ở `meow-agent-manager.ts` — không nằm trong scope của plan này, **defer**: thêm `notifyChallenge` qua một module-level setter hoặc `ChatGptWebManager.getSessionStore()` accessor trả về store + notifier bundle.
- [ ] **Quyết định cuối**: Thêm method `ChatGptWebManager.createLlmClient()` thay vì để `meow-agent-manager` tự gọi `createChatGptWebLlmClient`. Method này đóng gói cả `store` lẫn `notifyChallenge`. Sửa `meow-agent-manager.ts` để gọi `chatGptWeb.createLlmClient()` thay vì `createChatGptWebLlmClient(store)` (nếu hiện tại nó gọi như vậy — kiểm tra).
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): wire notifyChallenge from manager to renderer`

---

## Task 12: Preload expose onChatGptWebChallenge

**Files:**
- `src/preload/index.ts`

**Steps:**
- [ ] Mở `src/preload/index.ts`.
- [ ] Trong object API (gần các `onXxx` khác), thêm:
  ```ts
  onChatGptWebChallenge: (cb: (e: ChallengeEvent) => void) => {
    const listener = (_e: unknown, payload: ChallengeEvent) => cb(payload)
    ipcRenderer.on(Channels.EventChatGptWebChallenge, listener)
    return () => ipcRenderer.off(Channels.EventChatGptWebChallenge, listener)
  }
  ```
- [ ] Đảm bảo `ChallengeEvent` được import (xem các import sẵn có ở đầu file).
- [ ] Đảm bảo `Channels` đã được import.
- [ ] Chạy `npm run typecheck` — phải pass.

**Verify:** `npm run typecheck` exit 0.

**Commit:** `feat(chatgpt-web): expose onChatGptWebChallenge via preload`

---

## Task 13: Renderer subscribe + render toast

**Files:**
- Tìm file renderer có alert/notification UI. Có thể là:
  - `src/renderer/src/components/...` (cần grep `alert`, `notification`, `toast`).
- Hoặc tạo hook mới trong `src/renderer/src/hooks/`.

**Steps:**
- [ ] Grep `alert` hoặc `notification` trong `src/renderer/src/` để tìm component phù hợp.
- [ ] Trong component chính (vd: `App.tsx` hoặc layout component), thêm subscription:
  ```ts
  useEffect(() => {
    return window.api.onChatGptWebChallenge((e) => {
      // Render toast tiếng Việt prefix [meow]
      showToast({
        kind: 'warning',
        message: e.reason === 'cloudflare'
          ? '[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở.'
          : '[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.'
      })
    })
  }, [])
  ```
- [ ] Nếu chưa có `showToast` helper, dùng `alert()` tạm thời (TODO ghi rõ).
- [ ] Chạy `npm run typecheck` — phải pass.
- [ ] Chạy `npm run build` — phải pass.

**Verify:** `npm run typecheck` exit 0, `npm run build` exit 0.

**Commit:** `feat(chatgpt-web): renderer shows [meow] toast on challenge event`

---

## Task 14: Update plan doc gốc Task 14

**Files:**
- `docs/superpowers/plans/2026-08-07-chatgpt-web-provider.md`

**Steps:**
- [ ] Mở plan doc gốc.
- [ ] Tìm Task 14 (manual smoke test). Có thể ở gần cuối file (line ~1800+).
- [ ] Thay thế Task 14 bằng 6 steps từ spec §10.2:
  1. App mới cài → Settings → Login → Chrome visible → login thủ công → đóng → verify `storage-state.json` + `browser-profile/Cookies` tồn tại.
  2. Gửi message qua chatgpt-web → chat mở headless → response về.
  3. Xóa `storage-state.json`, giữ `browser-profile/` → gửi message → vẫn work (profile là source of truth).
  4. Corrupt `browser-profile/Cookies` → gửi message → Chrome visible pop up + toast `[meow] Cloudflare cần xác minh` → giải → chat tiếp tục.
  5. Logout → verify cả JSON lẫn profile bị xóa.
  6. Login lại → verify `browser-profile/` mới được tạo.
- [ ] Commit riêng cho plan doc update.

**Verify:** Diff file hiển thị 6 steps mới thay cho Task 14 cũ.

**Commit:** `docs(chatgpt-web): update Task 14 manual smoke with persistent profile steps`

---

## Task 15: Final verification

**Steps:**
- [ ] Chạy `npm run typecheck` — phải pass.
- [ ] Chạy `npm test` — tất cả tests pass (existing + mới ở Task 9, 10).
- [ ] Chạy `npm run build` — phải pass (nếu plan này có ảnh hưởng tới e2e).
- [ ] Chạy `npm run e2e` — chỉ chạy smoke tests không liên quan chatgpt-web (vd: `app launches and shows the main window`); nếu fail vì chatgpt-web chưa được enable thì OK, không phải regression.
- [ ] Review tất cả commits trong branch này (`git log --oneline`).
- [ ] Update CHANGELOG hoặc README nếu có (xem cấu trúc repo).

**Verify:** Tất cả checks pass, không có regression.

**Commit:** (không cần commit riêng, hoặc `chore(chatgpt-web): final verification cleanup`)

---

## Notes cho agent thực thi

- Một số task có **Note** đánh dấu quyết định quan trọng (Task 8 về `notifyChallenge` injection, Task 11 về `createLlmClient` wrapper). Đọc kỹ trước khi code.
- Khi gặp ambiguity, **dừng lại hỏi user** thay vì đoán — đặc biệt là Task 11 (wiring phức tạp nhất).
- Sau mỗi task, **commit ngay** để dễ rollback.
- Task 13 (renderer toast) là UI thay đổi — chạy `npm run build` để verify trước khi commit.
- Task 14 (plan doc update) có thể commit cuối cùng cùng với Task 15.