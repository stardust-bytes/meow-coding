# Meow Coding — Vibe P0: Image input, Background+Notify, @-mention UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 3 top vibe-coding blockers from `docs/superpowers/specs/2026-08-06-vibe-coding-gaps-design.md` §4:
1. **Image input + preview** — paste/drop screenshots into chat, thumbnails in feed, image parts sent to vision models.
2. **Background + OS notifications** — OS notify when agent needs input / finishes; per-agent "run in background" badge mode.
3. **@-file mention UI** — `@` autocomplete dropdown with file chips; robust `@path` expansion incl. spaces.

**Architecture:** Extend the existing IPC contract (`Channels`/`AgentApi`) symmetrically across main/preload/renderer. Image payloads travel as dataURL strings in `ChatMessage.images?` (optional → no migration of existing sessions). Notifications live in a new `NotificationService` in main; renderer only subscribes to existing `EventChat` + new background-state events. File suggestions are resolved in main via the existing `glob` dependency (v13).

**Tech Stack:** Electron 41, React 19, ai SDK v6 (`UserContent` supports `ImagePart`), `glob` ^13, TypeScript strict, Vitest.

---

## File Map

- Modify: `src/shared/types.ts` — `ImageAttachment`, `ChatMessage.images?`, `BackgroundState`, `FileSuggestion`.
- Modify: `src/shared/ipc.ts` — `Channels.FilesSuggest`, `Channels.AgentSetBackground`, `Channels.SessionExport`(dùng chung P2), `AgentApi` methods; `sendChat` signature + images.
- Modify: `src/main/agent/message.ts` — `toLlmMessages` emits image parts for user messages.
- Modify: `src/main/meow-agent-manager.ts` — `send(agentId, text, images?)`, background state, notify hooks.
- Create: `src/main/notification-service.ts` — wraps Electron `Notification`; focus-window click handling; dedupe/spam guard.
- Create: `src/main/file-suggest.ts` — glob-based `@` suggestions (limit 20, ignore node_modules/.git/out).
- Modify: `src/main/agent/references.ts` — support `./` prefix and `@"path with space"` syntax.
- Modify: `src/main/index.ts` — register new IPC handlers; wire NotificationService + background events; `getWindowChromeOptions` reuse for `win.show()`.
- Modify: `src/preload/index.ts` — expose new AgentApi methods + `onAgentBackground`.
- Modify: `src/renderer/src/components/chat/ChatInput.tsx` — paste/drop handlers, image chips, `@` suggestion dropdown.
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` — `FeedMessage` renders thumbnails + `@path` mentions; send() passes images; background badge in pane header area.
- Modify: `src/renderer/src/components/PaneHeader.tsx` — "run in background" toggle button.
- Modify: `src/renderer/src/App.tsx` — background state map; badge strip when backgrounded.
- Modify: `src/renderer/src/components/Sidebar.tsx` — collapsed badge indicators (optional, same state source).
- Test: `tests/unit/ipc-contract.test.ts`, `tests/unit/agent-message.test.ts`, `tests/unit/agent-references.test.ts`, new `tests/unit/file-suggest.test.ts`, `tests/unit/notification-service.test.ts`, `tests/unit/meow-agent-manager.test.ts`.

---

## Task 1: Types — ImageAttachment + ChatMessage.images + background/file-suggest types

**Files:** `src/shared/types.ts`, `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Write failing tests** — trong `tests/unit/ipc-contract.test.ts`, thêm vào `required` list:
```ts
      'suggestFiles', 'setAgentBackground', 'onAgentBackground'
```
và thêm vào stub object:
```ts
      suggestFiles: async () => [],
      setAgentBackground: async () => {},
      onAgentBackground: () => () => {},
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/ipc-contract.test.ts` → FAIL (`suggestFiles` không tồn tại trên AgentApi).

- [ ] **Step 3: Add types** — cuối `src/shared/types.ts`:
```ts
export interface ImageAttachment {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  size: number
  width?: number
  height?: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  reasoning?: string
  createdAt: number
  images?: ImageAttachment[]
}

export type BackgroundState = 'foreground' | 'background'

export interface FileSuggestion {
  path: string      // relative path từ project root
  name: string      // basename
  isDirectory: boolean
}
```
(Note: `ChatMessage` đã tồn tại — chỉ thêm `images?`.)

- [ ] **Step 4: Run test** — `npx vitest run tests/unit/ipc-contract.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/shared/types.ts tests/unit/ipc-contract.test.ts && git commit -m "types: add image attachment, background state, file suggestion"`

---

## Task 2: IPC contract — FilesSuggest + AgentSetBackground + sendChat images

**Files:** `src/shared/ipc.ts`, `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Write failing test** — trong test `'maps event channel names...'` thêm:
```ts
    expect(Channels.FilesSuggest).toBe('files:suggest')
    expect(Channels.AgentSetBackground).toBe('agent:set-background')
    expect(Channels.EventAgentBackground).toBe('agent:background')
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Add channels + AgentApi methods** — trong `src/shared/ipc.ts`:
```ts
  FilesSuggest: 'files:suggest',
  AgentSetBackground: 'agent:set-background',
  EventAgentBackground: 'agent:background',
```
`AgentApi`:
```ts
  suggestFiles(agentId: string, prefix: string): Promise<FileSuggestion[]>
  setAgentBackground(agentId: string, background: boolean): Promise<void>
  sendChat(agentId: string, text: string, images?: ImageAttachment[]): Promise<void>
  onAgentBackground(cb: (e: { agentId: string; background: boolean }) => void): () => void
```
(đổi signature `sendChat` — update import types.)

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "ipc: files:suggest, agent:set-background, sendChat images"`

---

## Task 3: Main — send() accepts images; toLlmMessages emits image parts

**Files:** `src/main/agent/message.ts`, `src/main/meow-agent-manager.ts`, `tests/unit/agent-message.test.ts`, `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/agent-message.test.ts`:
```ts
  it('emits image parts for user message with images', () => {
    const items: TranscriptItem[] = [{
      kind: 'message',
      message: { id: '1', role: 'user', text: 'fix this', createdAt: 0,
        images: [{ id: 'i1', name: 'a.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 }] }
    }]
    const msgs = toLlmMessages(items)
    const content = msgs[0].content
    expect(Array.isArray(content)).toBe(true)
    expect((content as Array<{type:string; image?:string}>)[0]).toMatchObject({ type: 'text', text: 'fix this' })
    expect((content as Array<{type:string; image?:string}>)[1]).toMatchObject({ type: 'image', image: 'data:image/png;base64,AAA' })
  })
```

`tests/unit/meow-agent-manager.test.ts`:
```ts
  it('send() passes images into stored user message', async () => {
    // fake store.appendMessage capture; gọi manager.send('a1', 'hi', [img]); assert appendMessage nhận images
  })
```

- [ ] **Step 2: Run tests** → FAIL.

- [ ] **Step 3: Implement message.ts** — trong `toLlmMessages`, user branch:
```ts
if (item.message.role === 'user') {
  const images = item.message.images ?? []
  if (images.length === 0) {
    result.push({ role: 'user', content: item.message.text })
  } else {
    result.push({
      role: 'user',
      content: [
        { type: 'text', text: item.message.text },
        ...images.map(img => ({ type: 'image', image: img.dataUrl }))
      ]
    })
  }
}
```

- [ ] **Step 4: Implement manager.send** — đổi signature `send(agentId: string, text: string, images?: ImageAttachment[])`; `appendMessage` thêm `images`. Khi model không vision (không biết trước — bỏ qua tầng này; model sẽ báo lỗi tool/400 → hiện error event hiện có. Ghi chú: filter vision ở Task 6 nếu cần).

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit** — `git commit -m "agent: send chat with image attachments, image parts to LLM"`

---

## Task 4: Renderer ChatInput — paste/drop + image chips

**Files:** `src/renderer/src/components/chat/ChatInput.tsx`, `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: (UI manual verify, no unit test — component)** Implement:
  - State `images: ImageAttachment[]`; ref `fileInput`.
  - `onPaste`: `e.clipboardData.items` → `item.getAsFile()` → nếu `file.type.startsWith('image/')` và `file.size <= 5MB` và `images.length < 4` → `FileReader.readAsDataURL` → push `ImageAttachment {id: crypto.randomUUID(), ...}`.
  - `onDrop`: `e.dataTransfer.files` tương tự.
  - Render chips dưới textarea: thumbnail `<img src={dataUrl}>` + tên + nút × (xóa).
  - `onSubmit` callback đổi thành `(text: string, images: ImageAttachment[]) => void`.
- [ ] **Step 2: ChatPanel.send** — `window.api.sendChat(agentId, trimmed, images)`; reset images sau gửi.

- [ ] **Step 3: Manual check** — `npm run dev`, paste screenshot vào chat native agent → chip hiện, gửi được.

- [ ] **Step 4: Commit** — `git commit -m "renderer: paste/drop image chips in chat input"`

---

## Task 5: Renderer ChatPanel — thumbnails in feed + lightbox

**Files:** `src/renderer/src/components/chat/ChatPanel.tsx`, `src/renderer/src/components/chat/MarkdownText.tsx`(không đổi), `src/renderer/src/styles.css`(nếu có file styles — check `src/renderer/src/assets`)

- [ ] **Step 1: FeedMessage** — nhận thêm `images?: ImageAttachment[]`; user message render:
```tsx
{images && images.length > 0 && (
  <div className="chat-msg-images">
    {images.map(img => <img key={img.id} src={img.dataUrl} alt={img.name} className="chat-thumb"
      onClick={() => setLightbox(img.dataUrl)} />)}
  </div>
)}
```
Lightbox: state `lightboxUrl` + overlay div (click → đóng).
- [ ] **Step 2: loadTranscript** — map `images` từ `it.message.images` vào FeedItem.
- [ ] **Step 3: Manual check** — sau khi gửi ảnh, message user hiện thumbnail; click phóng to.
- [ ] **Step 4: Commit** — `git commit -m "renderer: image thumbnails and lightbox in chat feed"`

---

## Task 6: Main — NotificationService + notify on needs-input / done

**Files:** create `src/main/notification-service.ts`, `src/main/meow-agent-manager.ts`, `src/main/index.ts`, test `tests/unit/notification-service.test.ts`

- [ ] **Step 1: Write failing test** — `tests/unit/notification-service.test.ts`:
```ts
  it('shows notification when window not focused', () => {
    // mock electron Notification via vi.mock; service.show({title, body}) → Notification.show được gọi
    // windowFocused() = false
  })
  it('skips notification when window focused', () => {
    // windowFocused() = true → Notification không được gọi
  })
```
- [ ] **Step 2: Run** → FAIL (service chưa tồn tại).

- [ ] **Step 3: Implement NotificationService** — `src/main/notification-service.ts`:
```ts
import { Notification } from 'electron'

export interface NotifyOptions {
  title: string
  body: string
  agentId?: string
  onActivate?: () => void
}

export class NotificationService {
  private lastShown = new Map<string, number>()
  constructor(private isWindowFocused: () => boolean) {}

  notify(opts: NotifyOptions): void {
    if (this.isWindowFocused()) return
    const now = Date.now()
    const last = this.lastShown.get(opts.agentId ?? 'global') ?? 0
    if (now - last < 30_000) return  // dedupe 30s
    this.lastShown.set(opts.agentId ?? 'global', now)
    const n = new Notification({ title: opts.title, body: opts.body, silent: false })
    n.on('click', () => opts.onActivate?.())
    n.show()
  }
}
```
- [ ] **Step 4: Wire manager** — trong `MeowAgentManager`:
  - Constructor nhận thêm `notify?: NotificationService` (optional dep, default undefined → no-op).
  - `awaitPrompt` set pendingPrompt xong → `this.deps.notify?.notify({title: '[meow] Cần bạn nhập', body: `${agent.name} đang chờ...`, agentId, onActivate: () => this.deps.onActivateAgent?.(agentId)})`.
  - `setOnEvent` khi `e.type === 'done'` → notify `[meow] Hoàn thành` kèm reason/cost (nếu có); khi `e.type === 'error'` → `[meow] Lỗi`.
- [ ] **Step 5: Wire index.ts** — tạo `new NotificationService(() => !win || !win.isFocused())`; truyền vào `MeowAgentManager` deps + `onActivateAgent` (focus window: `win.show(); win.focus()` — renderer sẽ tự mở pane qua `EventAgentBackground`/focus event).
- [ ] **Step 6: Notifications config (spec §7)** — `src/shared/types.ts`: `NotificationsSettings { needsInput: boolean; onDone: boolean }`; `MeowSettings.notifications?`; `src/main/agent/config.ts`: `DEFAULT_NOTIFICATIONS = { needsInput: true, onDone: true }` + normalize + wire; `ContextTab.tsx` thêm row "Notifications" (2 toggle). Test: `agent-config.test.ts` normalize.
- [ ] **Step 7: Run tests** → PASS. Manual: minimize app, agent hỏi question → OS notification hiện; click → window focus. Tắt toggle `onDone` → không notify khi xong.
- [ ] **Step 8: Commit** — `git commit -m "main: OS notifications when agent needs input or finishes (configurable)"`

---

## Task 7: Background mode — per-agent badge strip

**Files:** `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/PaneHeader.tsx`, `src/renderer/src/components/PaneGrid.tsx`, `src/shared/ipc.ts` (đã có channel ở Task 2)

- [ ] **Step 1: Main** — `MeowAgentManager.setBackground(agentId, background: boolean)`: lưu `Map<string, boolean>`; emit event mới qua `Channels.EventAgentBackground` (dùng `onEvent`? không — thêm method `setBackground` gọi `emitBackground` callback riêng hoặc dùng `EventChat` với type mới `background-changed`). Chọn: thêm vào `ChatEvent`:
```ts
  | { type: 'background-changed'; agentId: string; background: boolean }
```
(index.ts `win.webContents.send(Channels.EventChat, e)` đã forward mọi ChatEvent → renderer nhận được qua `onChatEvent` — không cần channel mới. Nhưng spec §7 đã hứa `EventAgentBackground` — giữ channel mới cho rõ: index.ts gọi `mainApp.meowAgent.setBackground(...)` → callback `onBackgroundChange` set ở index.ts → `win.webContents.send(Channels.EventAgentBackground, ...)`. Chọn cách này.)
- [ ] **Step 2: IPC handler** — `ipcMain.handle(Channels.AgentSetBackground, (_e, agentId, bg) => mainApp.meowAgent.setBackground(agentId, bg))`.
- [ ] **Step 3: Renderer App.tsx** — state `backgrounds: Record<string, boolean>`; subscribe `onAgentBackground`; PaneGrid render: nếu `backgrounds[agentId]` → thay pane content bằng **badge strip** (tên agent + status + cost chip + "click to open"); click → `setAgentBackground(agentId, false)`.
- [ ] **Step 4: PaneHeader** — nút toggle "background" (icon), gọi `window.api.setAgentBackground`.
- [ ] **Step 5: Manual check** — bật background → pane thu gọn thành badge, agent vẫn chạy (chat event vẫn đến), click badge → mở lại đầy đủ.
- [ ] **Step 6: Commit** — `git commit -m "renderer: per-agent background badge mode"`

---

## Task 8: @-mention — main file suggestions

**Files:** create `src/main/file-suggest.ts`, `src/main/index.ts`, `src/main/meow-agent-manager.ts`, test `tests/unit/file-suggest.test.ts`, `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Write failing test** — `tests/unit/file-suggest.test.ts`:
```ts
  it('returns relative paths matching prefix, ignoring node_modules/.git', async () => {
    // tạo temp dir với src/a.ts, src/b.ts, node_modules/x.ts
    const res = await suggestFiles(tmpDir, 'src/')
    expect(res.map(r => r.path)).toContain('src/a.ts')
    expect(res.some(r => r.path.includes('node_modules'))).toBe(false)
    expect(res.length).toBeLessThanOrEqual(20)
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `src/main/file-suggest.ts`:
```ts
import { glob } from 'glob'
import { statSync } from 'node:fs'
import path from 'node:path'

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**']
const MAX_RESULTS = 20

export async function suggestFiles(cwd: string, prefix: string): Promise<FileSuggestion[]> {
  const clean = prefix.replace(/^@/, '').replace(/^\.\//, '')
  if (!clean) return []
  const matches = await glob(`${clean}*`, { cwd, posix: true, dot: false, ignore: IGNORE })
  // nếu prefix trỏ thư mục, lấy cả children một cấp
  const list = matches.sort().slice(0, MAX_RESULTS)
  return list.map(p => {
    let isDirectory = false
    try { isDirectory = statSync(path.join(cwd, p)).isDirectory() } catch { /* ignore */ }
    return { path: p, name: path.basename(p), isDirectory }
  })
}
```
- [ ] **Step 4: IPC handler** — `src/main/index.ts`: `ipcMain.handle(Channels.FilesSuggest, (_e, agentId, prefix) => mainApp.meowAgent.suggestFiles(agentId, prefix))`; manager method `suggestFiles` lấy `agent.cwd` rồi gọi `suggestFiles(cwd, prefix)`.
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "main: file suggestion for @ mentions"`

---

## Task 9: @-mention — ChatInput dropdown + chips

**Files:** `src/renderer/src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Implement (manual verify — component)**:
  - Trong `onInput`, nếu ký tự cuối chuỗi đang gõ có `@` đứng sau khoảng trắng/bắt đầu → tách prefix sau `@` cuối → `window.api.suggestFiles(agentId, prefix)` (debounce 150ms).
  - Dropdown tái dùng style `.command-menu` (className `.file-menu`): item = icon + name + relative path.
  - Chọn item → chèn `@path ` vào textarea tại vị trí con trỏ; thêm chip "attached" (state `mentions: string[]`) dưới textarea (cạnh image chips), xóa được.
- [ ] **Step 2: Manual check** — gõ `@sr` → dropdown hiện `src/...`; Enter chọn → text có `@src/...` + chip.
- [ ] **Step 3: Commit** — `git commit -m "renderer: @ file mention dropdown and chips"`

---

## Task 10: @-mention — robust expandReferences + mention rendering

**Files:** `src/main/agent/references.ts`, `src/renderer/src/components/chat/ChatPanel.tsx`, tests `tests/unit/agent-references.test.ts`

- [ ] **Step 1: Write failing tests** — `tests/unit/agent-references.test.ts`:
```ts
  it('expands @./relative/path with dot prefix', () => {
    // cwd có file a.txt; expandReferences(cwd, 'read @./a.txt') → chứa nội dung a.txt
  })
  it('expands @"path with space.txt"', () => {
    // file 'my file.txt'; expandReferences(cwd, 'x @"my file.txt"') → chứa nội dung
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — regex mở rộng:
```ts
const MENTION_RE = /@("([^"]+)"|([\w./\\-]+))/g
// nhóm 1 = token (có hoặc không có quote); strip quote; xử lý ./ prefix
```
Giữ backward-compatible với `@path` không space; `./` prefix được `path.join(cwd, token)` xử lý sẵn (chỉ cần không reject dot).
- [ ] **Step 4: ChatPanel mention rendering** — user message text chứa `@path` → render dạng `<span class="chat-mention">@path</span>` (split bằng regex, chỉ highlight khi token bắt đầu `@`).
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "agent+renderer: robust @path expansion and mention highlight"`

---

## Task 11: Final — full verification

- [ ] **Step 1:** `npm run typecheck` — PASS.
- [ ] **Step 2:** `npm test` — PASS (đặc biệt `agent-message`, `agent-references`, `file-suggest`, `notification-service`, `ipc-contract`, `meow-agent-manager`).
- [ ] **Step 3:** `npm run build && npm run e2e` — PASS (đụng IPC + UI chính).
- [ ] **Step 4:** Manual smoke: paste ảnh → agent vision nhận; background badge + notification khi minimize; gõ `@` → dropdown + expand.
- [ ] **Step 5:** Cập nhật `docs/superpowers/notes/` nếu cần ghi chú feature mới.

---

## Out of scope (theo spec §4)

- Compress/resize ảnh, screenshot vùng chọn, agent gửi ảnh về (P2).
- Job-list thuần không-pane kiểu opencode `background/job.ts`.
- Fuzzy search toàn workspace, đệ quy thư mục đầy đủ cho @-mention.
