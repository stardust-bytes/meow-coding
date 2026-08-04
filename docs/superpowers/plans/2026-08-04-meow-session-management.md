# Meow Coding — Session Management (theo model opencode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm khả năng quản lý sessions cho agent native "meow" giống opencode: mỗi agent có **nhiều session**, mỗi session có id riêng + title + thời gian; cho phép **list / tạo mới / chuyển (tiếp tục) / xóa** từ UI chat. Giữ nguyên hành vi hiện có (send/stop/mode/permission) và không phá e2e.

**Nguồn tham khảo:** source opencode `D:\GitHub\opencode-1.18.11` — `packages/opencode/src/session/session.ts`, `prompt.ts`:
- Session có `id` riêng (không gắn cứng vào agent), `title`, `time_created`, `time_updated`, `directory`.
- Title mặc định "New session"; opencode tự đặt title từ first user message (bản đầy đủ dùng LLM agent "title"; **meow dùng heuristic deterministic**: first line của first user message, truncate ~60 ký tự).
- List sort theo `time_updated DESC`; `touch` khi dùng → session active luôn ở đầu danh sách.
- `remove` cascade con; tiếp tục session = gắn active vào session đó.

**Phạm vi:** `src/main/agent/session.ts`, `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/shared/{types,ipc}.ts`, `src/preload/index.ts`, `src/renderer` (ChatPanel + component mới SessionBar + styles), test `ipc-contract` + unit test mới cho SessionStore. Không đổi SessionRunner (loop.ts).

---

## 1. Thiết kế dữ liệu (`src/main/agent/session.ts`)

`StoredSession` mới (migration entry cũ `{id, projectPath, items, updatedAt}`):

```ts
export interface StoredSession {
  id: string            // UUID, id riêng của session (không = agentId)
  agentId: string       // agent sở hữu
  projectPath: string   // directory
  title: string
  items: ChatTranscriptItem[]
  createdAt: number
  updatedAt: number
}

export interface SessionSummary {
  id: string
  agentId: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}
```

API `SessionStore`:
- `list(agentId): SessionSummary[]` — sort `updatedAt DESC` (không kéo `items`).
- `get(id)`, `latest(agentId)`, `create(agentId, projectPath)`, `transcript(id)`.
- `appendMessage(id, msg)` / `appendTool(id, tool)` — thao tác theo session id; tự `touch`; **auto-title**: nếu title = "New session" và msg là user → title = first line trim, truncate 60 (thêm `…`).
- `setTitle(id, title)`, `touch(id)`, `delete(id)`.
- Migration trong `load()`: entry thiếu `agentId` → gán `agentId = id`; thiếu `title` → suy từ first user message hoặc "New session"; thiếu `createdAt` → dùng `updatedAt`.

## 2. MeowAgentManager

- Thêm `activeSessions = Map<agentId, sessionId>`.
- `activeSessionId(agentId)`: resolve = `store.latest(agentId)` hoặc `store.create(...)` (cần `agent.cwd` làm `projectPath`).
- `listSessions(agentId)`, `createSession(agentId)` (stop + create + set active), `switchSession(agentId, sessionId)` (stop + set active + touch), `deleteSession(agentId, sessionId)` (delete; nếu là active → active = latest hoặc create mới).
- Runner callbacks trong `register()`: `getItems/appendMessage/appendTool` trỏ tới **session active** của agent.
- `newSession(agentId)` (đang dùng bởi nút restart native) → chuyển thành `createSession` + switch. `listMessages`/`listTranscript` đọc session active.
- `snapshots`: giữ theo agentId như cũ (ngoài phạm vi).

## 3. IPC contract (`src/shared/ipc.ts` + preload + main handlers + test)

Channel mới: `SessionList: 'session:list'`, `SessionCreate: 'session:create'`, `SessionSwitch: 'session:switch'`, `SessionDelete: 'session:delete'`.

```ts
listSessions(agentId): Promise<SessionSummary[]>
createSession(agentId): Promise<SessionSummary>       // dừng runner, tạo mới, active
switchSession(agentId, sessionId): Promise<SessionSummary>  // touch để lên đầu list
deleteSession(agentId, sessionId): Promise<SessionSummary>  // trả active hiện tại sau xóa
```

Cập nhật đồng bộ: main handlers, preload, `tests/unit/ipc-contract.test.ts` (required keys + channel asserts).

## 4. Renderer

- `src/renderer/src/components/chat/SessionBar.tsx` (mới): thanh trên cùng chat panel gồm:
  - Nút trigger: title session active + chevron `▾`.
  - Nút `+` tạo session mới.
  - Dropdown danh sách session (sort theo updatedAt): mỗi row = title + meta `relative time · n msg`; row active highlight; hover hiện nút `×` xóa (stopPropagation); click row → switch. Đầu dropdown có "New session".
- `ChatPanel.tsx`: state `sessions`, load qua `listSessions` khi mount/đổi agent; refactor `loadTranscript` (dùng cho mount + sau create/switch); sau create/switch: reset items/running/pendingPrompt/lastTokens rồi reload transcript + list.
- Helper `relativeTime(ts)` inline (now/5m/3h/2d/ngày).
- `styles.css`: `.chat-sessions` bar + dropdown flat, đúng style VS Code (không border, vuông, hover `--bg-hover`).
- Giữ nguyên class/e2e hooks: `.chat-panel`, `.chat-input-field`, `.chat-input-send`, `.chat-msg.user`, `.chat-mode-hint`, button `plan`/`build`.

## 5. Kiểm thử

- Unit mới `tests/unit/session-store.test.ts`: create/list sort/auto-title/touch/delete/latest/migration.
- Cập nhật `tests/unit/ipc-contract.test.ts`.
- Chạy: `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: Refactor SessionStore + StoredSession + migration

**Files:** `src/main/agent/session.ts`, mới `tests/unit/session-store.test.ts`

- [ ] **Step 1:** Viết failing unit test (create/list/auto-title/touch/delete/latest/migration).
- [ ] **Step 2:** Refactor `session.ts` theo thiết kế §1.
- [ ] **Step 3:** `npm test` pass.

## Task 2: MeowAgentManager multi-session

**Files:** `src/main/meow-agent-manager.ts`

- [ ] **Step 1:** Thêm `activeSessions` + `activeSessionId` + các method list/create/switch/delete.
- [ ] **Step 2:** Sửa `register` runner callbacks → session active; sửa `newSession`, `listMessages`, `listTranscript`, `send`.
- [ ] **Step 3:** `npm run typecheck` + `npm test`.

## Task 3: IPC contract + preload + main handlers

**Files:** `src/shared/ipc.ts`, `src/shared/types.ts` (thêm `SessionSummary`), `src/preload/index.ts`, `src/main/index.ts`, `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1:** Thêm `SessionSummary` vào `types.ts`.
- [ ] **Step 2:** Thêm channels + `AgentApi` methods vào `ipc.ts`.
- [ ] **Step 3:** Handler trong `index.ts` (chat section).
- [ ] **Step 4:** Preload methods.
- [ ] **Step 5:** Cập nhật ipc-contract test.
- [ ] **Step 6:** `npm run typecheck` + `npm test`.

## Task 4: Renderer — SessionBar + ChatPanel wiring

**Files:** `src/renderer/src/components/chat/SessionBar.tsx` (mới), `ChatPanel.tsx`, `styles.css`

- [ ] **Step 1:** Tạo `SessionBar.tsx`.
- [ ] **Step 2:** Wire vào `ChatPanel` (state + loadTranscript + reset sau create/switch/delete).
- [ ] **Step 3:** CSS `.chat-sessions` + dropdown.
- [ ] **Step 4:** `npm run typecheck` + `npm run build`.

## Task 5: Verify

- [ ] **Step 1:** `npm test` (unit mới + ipc contract).
- [ ] **Step 2:** `npm run build && npm run e2e`.
- [ ] **Step 3:** Chạy thủ công `npm run dev`: tạo session mới, gửi tin → title tự đặt; tạo session 2, chuyển qua lại, xóa session active → fallback session còn lại; restart native = session mới.

---

## Không được phá

- Runner (loop.ts) không đổi; chỉ đổi callback nguồn dữ liệu.
- `ChatNewSession` (nút restart native) vẫn hoạt động = tạo session mới.
- Class/aria-label dùng trong `tests/e2e/*` giữ nguyên.
- Thêm IPC phải cập nhật đủ 4 chỗ (types/ipc + main + preload + test).
