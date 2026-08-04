# Meow Agent — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Xây agent coding native "Meow Agent" trong meow-coding — agent loop, tools core, config,
permission, session persist, chat panel UI — tái hiện kiến trúc core opencode theo stack dự án.

**Architecture:** Mọi logic agent chạy trong **main process** (`src/main/agent/`), giao tiếp với
renderer qua IPC contract tập trung trong `src/shared`. Renderer hiển thị **chat panel** cho agent
native trong pane grid hiện có. LLM dùng Vercel AI SDK (`ai` + `@ai-sdk/anthropic` +
`@ai-sdk/openai-compatible`). Loop được test bằng **model stub** (không gọi API thật).

**Tech Stack (bổ sung):** `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, `zod` (schema tool).

**Spec:** `docs/superpowers/specs/2026-08-04-meow-agent-builtin-design.md`

**Quy ước test:** viết failing test trước → chạy xác nhận FAIL → implement → chạy PASS → typecheck →
commit từng task.

---

## File Structure (mới)

| File | Trách nhiệm |
|---|---|
| `src/shared/types.ts` (modify) | Thêm `AgentKind`, `ChatMessage`, `ToolCallData`, `ChatEvent`, `PromptResponse` |
| `src/shared/ipc.ts` (modify) | Thêm `Channels` chat + method `AgentApi` |
| `src/main/agent/config.ts` | Load `meow.json` + env: provider/model/agents/permissions |
| `src/main/agent/message.ts` | Chuyển `ChatMessage`+`ToolCallData` ↔ AI SDK message/tool |
| `src/main/agent/llm.ts` | `LlmClient` interface + `createAnthropicLlm` / `createOpenAICompatibleLlm` |
| `src/main/agent/permission.ts` | Rules allow/ask/deny + matcher |
| `src/main/agent/session.ts` | `SessionStore`: persist sessions + messages (JsonStore) |
| `src/main/agent/loop.ts` | `SessionRunner`: agent loop, maxSteps, interruption, emit `ChatEvent` |
| `src/main/agent/apply-patch.ts` | Parser + áp unified diff (cho tool apply-patch) |
| `src/main/agent/tools/registry.ts` | `ToolDefinition` + registry |
| `src/main/agent/tools/{bash,read,write,edit,glob,grep,apply-patch,todowrite,question}.ts` | Tools |
| `src/main/meow-agent-manager.ts` | Điều phối session/loop per agent, IPC wiring, default agent |
| `src/main/index.ts` (modify) | Khởi tạo `MeowAgentManager`, register handlers chat |
| `src/preload/index.ts` (modify) | Expose method chat |
| `src/renderer/src/components/chat/{ChatPanel,MessageItem,ToolCallCard,ChatInput}.tsx` | Chat UI |
| `src/renderer/src/App.tsx`, `Pane.tsx`, `PaneGrid.tsx` (modify) | Render ChatPanel cho agent native |
| `src/renderer/src/styles.css` (modify) | Style chat panel |
| `tests/unit/agent-*.test.ts` | Tests cho từng module agent |

---

## Task 1: Dependencies + shared chat types + IPC contract

**Files:** `package.json` (modify), `src/shared/types.ts` (modify), `src/shared/ipc.ts` (modify),
`tests/unit/ipc-contract.test.ts` (modify)

- [ ] **Step 1: Cài dependencies**

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai-compatible zod
```

- [ ] **Step 2: Viết failing test bổ sung vào `tests/unit/ipc-contract.test.ts`**

Thêm test: `AgentApi` có các method `sendChat`, `stopChat`, `newChatSession`, `listChatMessages`,
`respondPrompt`, `onChatEvent`; `Channels.EventChat === 'chat:event'`; `ChatEvent` kiểu được không
runtime error.

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL (thiếu method).

- [ ] **Step 3: Thêm type vào `src/shared/types.ts`**

```ts
export type AgentKind = 'pty' | 'native'
export type ChatRole = 'user' | 'assistant'
export interface ChatMessage { id: string; role: ChatRole; text: string; createdAt: number }
export interface ToolCallData {
  id: string; tool: string; input: Record<string, unknown>
  output?: string; error?: string; permission: 'pending' | 'allowed' | 'denied'
}
export type ChatEvent =
  | { type: 'text-delta'; agentId: string; delta: string }
  | { type: 'tool-start'; agentId: string; call: ToolCallData }
  | { type: 'tool-result'; agentId: string; call: ToolCallData }
  | { type: 'prompt-request'; agentId: string; promptId: string
      kind: 'permission' | 'question'; call?: ToolCallData; question?: string }
  | { type: 'done'; agentId: string; reason: string }
  | { type: 'error'; agentId: string; message: string }
export interface PromptResponse { allow: boolean; text?: string }
```
Thêm `kind?: AgentKind` vào `AgentConfig`.

- [ ] **Step 4: Thêm vào `src/shared/ipc.ts`**

`Channels`: `ChatSend: 'chat:send'`, `ChatStop: 'chat:stop'`, `ChatNewSession: 'chat:new-session'`,
`ChatListMessages: 'chat:list-messages'`, `ChatRespondPrompt: 'chat:respond-prompt'`,
`EventChat: 'chat:event'`.

`AgentApi` thêm:
```ts
sendChat(agentId: string, text: string): Promise<void>
stopChat(agentId: string): Promise<void>
newChatSession(agentId: string): Promise<void>
listChatMessages(agentId: string): Promise<ChatMessage[]>
respondPrompt(agentId: string, promptId: string, resp: PromptResponse): Promise<void>
onChatEvent(cb: (e: ChatEvent) => void): () => void
```

- [ ] **Step 5: Chạy test pass + typecheck + commit**

Run: `npx vitest run tests/unit/ipc-contract.test.ts` → PASS; `npm run typecheck` → PASS.
Commit: `feat: shared chat types and ipc contract`

---

## Task 2: Config loader (`src/main/agent/config.ts`)

**Files:** `src/main/agent/config.ts`, `tests/unit/agent-config.test.ts`

- [ ] **Step 1: Viết failing test**

Cases:
- parse `meow.json` hợp lệ → provider/model/agents/permissions đúng.
- file không tồn tại → dùng defaults (model `anthropic`, agent `meow` system prompt mặc định).
- file hỏng JSON → fallback defaults (không throw).
- `resolveApiKey`: ưu tiên config string > env var (`apiKeyEnv`) > `process.env[apiKeyEnv]`.
- permission default: tool không có rule → `ask`.

- [ ] **Step 2: Implement**

```ts
export interface MeowConfig {
  provider: Record<string, { apiKeyEnv?: string; baseUrl?: string; model: string }>
  model: string
  agents: Record<string, { model?: string; systemPrompt: string }>
  permission: Record<string, 'allow' | 'ask' | 'deny'>
}
export interface ResolvedAgentConfig {
  provider: string; model: string; apiKey: string | null; systemPrompt: string
}
export function loadMeowConfig(filePath: string, env: NodeJS.ProcessEnv = process.env): MeowConfig
export function resolveAgentConfig(cfg: MeowConfig, agentName: string, env?): ResolvedAgentConfig
export function resolveApiKey(providerCfg, env?): string | null
export const DEFAULT_MEOW_CONFIG: MeowConfig
```
Defaults: `provider.anthropic = { apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5' }`,
`provider.openai = { apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4o' }`, `model: 'anthropic'`,
`agents.meow.systemPrompt = "You are Meow, a coding agent working inside an Electron app..."`,
`permission: {}` (default ask).

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent config loader`)

---

## Task 3: Message conversion (`src/main/agent/message.ts`)

**Files:** `src/main/agent/message.ts`, `tests/unit/agent-message.test.ts`

- [ ] **Step 1: Viết failing test**

Cases:
- `toLlmMessages`: user/assistant ChatMessage → AI SDK `SystemMessage`/`UserMessage`/`AssistantMessage`
  (hợp `text` deltas của assistant thành một message), `ToolCallData` → `toolCall`/`ToolResultPart`.
- `toToolDefinition`: `ToolDefinition` → AI SDK `tool()` với `parameters` zod schema.

- [ ] **Step 2: Implement** (import `tool` từ `ai`, `CoreMessage`, `ToolResultPart` từ `ai`)

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent message conversion`)

---

## Task 4: LLM provider layer (`src/main/agent/llm.ts`)

**Files:** `src/main/agent/llm.ts`, `tests/unit/agent-llm.test.ts`

- [ ] **Step 1: Viết failing test**

Định nghĩa interface:
```ts
export interface LlmStreamPart {
  kind: 'text' | 'tool-call' | 'finish'
  text?: string
  toolName?: string
  toolInput?: Record<string, unknown>
}
export interface LlmClient {
  stream(opts: {
    model: string
    system: string
    messages: CoreMessage[]
    tools: Record<string, unknown>
    signal?: AbortSignal
  }): AsyncGenerator<LlmStreamPart>
}
export function createAnthropicLlm(apiKey: string): LlmClient
export function createOpenAICompatibleLlm(opts: { apiKey: string; baseUrl?: string }): LlmClient
```
Test: `createAnthropicLlm('k').stream({...})` → dùng **mock** của `streamText` từ `ai` (vi.mock) trả về
`{ textStream: asyncGen('hi'), toolCalls: [...] }`; assert loop yield đúng part. Kiểm tra không gọi
network.

- [ ] **Step 2: Implement** dùng `streamText` từ `ai`:
- anthropic: `anthropic()` từ `@ai-sdk/anthropic`.
- openai-compatible: `createOpenAICompatible({ baseURL, apiKey })`.
Map `fullStream` (`text-delta`, `tool-call`, `finish`) → `LlmStreamPart`.

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent llm provider layer`)

---

## Task 5: Permission system (`src/main/agent/permission.ts`)

**Files:** `src/main/agent/permission.ts`, `tests/unit/agent-permission.test.ts`

- [ ] **Step 1: Viết failing test**

```ts
export type PermissionDecision = 'allow' | 'ask' | 'deny'
export function decidePermission(
  rules: Record<string, 'allow' | 'ask' | 'deny'>,
  toolName: string
): PermissionDecision
```
Cases: tool có rule → dùng rule; không có → `ask`; pattern `*` → fallback; `web*` match `webfetch`.

- [ ] **Step 2: Implement** (match chính xác trước, rồi pattern `*`/`prefix*`, fallback `ask`).

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent permission rules`)

---

## Task 6: Session store (`src/main/agent/session.ts`)

**Files:** `src/main/agent/session.ts`, `tests/unit/agent-session.test.ts`

- [ ] **Step 1: Viết failing test**

```ts
export interface StoredSession {
  id: string          // = agentId
  projectPath: string
  messages: ChatMessage[]
  toolCalls: Record<string, ToolCallData[]>
  updatedAt: number
}
export class SessionStore {
  constructor(private store: JsonStore<StoredSession>) {}
  get(agentId: string): StoredSession | null
  appendMessage(agentId: string, msg: ChatMessage): void
  setToolCalls(agentId: string, toolCalls: ToolCallData[]): void
  clear(agentId: string): void
}
```
Cases: get null khi chưa có; append tạo session; persist qua JsonStore mock; clear.

- [ ] **Step 2: Implement** (dùng JsonStore interface sẵn có).

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent session store`)

---

## Task 7: Apply-patch parser (`src/main/agent/apply-patch.ts`)

**Files:** `src/main/agent/apply-patch.ts`, `tests/unit/agent-apply-patch.test.ts`

- [ ] **Step 1: Viết failing test**

`applyUnifiedPatch(patch: string, readFile, writeFile, listFiles)` — parse format:
```
--- a/path
+++ b/path
@@ -l,c +l,c @@
 context
-old
+new
```
- tạo file mới (`--- /dev/null`), sửa file có sẵn, giữ phần không đổi.
- `@@` count sai → throw lỗi rõ.

- [ ] **Step 2: Implement** parser dòng + áp hunk theo line numbers.

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent apply-patch parser`)

---

## Task 8: Core tools

**Files:** `src/main/agent/tools/*.ts`, `tests/unit/agent-tools-*.test.ts`

- [ ] **Step 1: Registry** — `registry.ts`:
```ts
export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodObject<any>
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}
export interface ToolContext {
  cwd: string
  ask(question: string): Promise<string | null>   // cho tool question
  signal?: AbortSignal
}
export interface ToolRunResult { output?: string; error?: string }
export function createRegistry(defs: ToolDefinition[]): Map<string, ToolDefinition>
```

- [ ] **Step 2: Từng tool (TDD mỗi tool một test file, chạy trên temp dir):**
- `bash` (`command: string`, `timeoutMs?`): spawn shell thật (win32: `cmd.exe /d /s /c`, posix: `sh -c`),
  kill process tree khi timeout/abort (dùng `tree-kill`). Permission mặc định `ask`.
- `read` (`file_path`): đọc file, giới hạn ~2000 dòng, báo missing.
- `write` (`file_path`, `content`): ghi đè + mkdir parent.
- `edit` (`file_path`, `old_string`, `new_string`): replace unique match, lỗi nếu không tìm thấy / trùng.
- `glob` (`pattern`): dùng `glob` npm package (đã có trong deps của opencode nhưng cần cài trong dự án).
- `grep` (`pattern`, `path?`, `include?`): đệ quy tìm regex, trả file:line:match (giới hạn kết quả).
- `apply-patch` (`patch`): dùng `apply-patch.ts`, ghi file, trả diff ngắn.
- `todowrite` (`todos: string[]`): lưu todo list trong session, trả về current todos.
- `question` (`question`): gọi `ctx.ask`, trả câu trả lời hoặc "user did not answer".

- [ ] **Step 3: Test pass (tất cả tools) + typecheck + commit**
(`feat: agent core tools`)

---

## Task 9: Agent loop (`src/main/agent/loop.ts`)

**Files:** `src/main/agent/loop.ts`, `tests/unit/agent-loop.test.ts`

- [ ] **Step 1: Viết failing test với model stub**

```ts
export interface LoopDeps {
  llm: LlmClient
  tools: Map<string, ToolDefinition>
  permission: (toolName: string) => PermissionDecision
  askPermission: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  askQuestion: (q: string) => Promise<string | null>
  maxSteps?: number
  onEvent: (e: ChatEvent) => void
}
export class SessionRunner {
  constructor(private deps: LoopDeps) {}
  async run(session: StoredSession, agentId: string, userText: string, signal?: AbortSignal): Promise<void>
}
```
Stub LLM (fake async generator):
- **Turn text-only**: trả `text-delta` rồi `finish` → assert `onEvent` nhận delta, session append assistant message, kết thúc.
- **Turn tool-call**: text "reading..." → tool-call `read` → stub tool trả output → turn sau model trả text "done" → assert tool-start/tool-result events, output được feed lại model (stub ghi nhận messages nhận được).
- **Permission deny**: permission `deny` → tool không chạy, model nhận "permission denied", không crash.
- **maxSteps**: model luôn trả tool-call → loop dừng sau `maxSteps`, event `done reason:'max-steps'`.
- **Stop**: abort signal → `done reason:'stopped'`.

- [ ] **Step 2: Implement loop**

```
run():
  append user message → emit? (không cần)
  for step in 0..maxSteps:
    if signal.aborted → done stopped
    build llm messages từ session.messages + toolCalls (message.ts)
    stream = llm.stream(...) ; cho từng part:
      text → append assistant text buffer + onEvent text-delta
      tool-call → onEvent tool-start; decision = permission(tool)
        deny → ghi ToolRunResult error "permission denied"
        ask → onEvent prompt-request; chờ askPermission
        run tool (tools.get) với ctx.ask = askQuestion
      onEvent tool-result; feed result vào session.toolCalls
    nếu không có tool-call trong turn → break (done 'complete')
  done
```
- Khi `askPermission` bị reject/return false → tool result "permission denied".
- Bọc mọi lỗi tool → `ToolRunResult.error`, không throw lên loop; lỗi model → onEvent error + break.

- [ ] **Step 3: Test pass + typecheck + commit** (`feat: agent session runner loop`)

---

## Task 10: MeowAgentManager + main wiring + default agent

**Files:** `src/main/meow-agent-manager.ts`, `src/main/index.ts` (modify),
`tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Viết failing test cho manager**

```ts
export class MeowAgentManager {
  constructor(deps: { configPath: string; store: SessionStore; tools: Map<string, ToolDefinition> })
  isNative(agentId: string): boolean
  send(agentId: string, text: string): Promise<void>
  stop(agentId: string): Promise<void>
  newSession(agentId: string): Promise<void>
  listMessages(agentId: string): ChatMessage[]
  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): Promise<void>
  async init(defaultAgentFor: (projectPath: string) => AgentConfig): void
}
```
Test với stub llm factory (inject qua deps `createLlm`): send → messages tăng; stop → done stopped;
respondPrompt allow/deny → tool chạy/không chạy; init → tạo runner cho agent.

- [ ] **Step 2: Implement**

- `init(defaultAgentFor)`: với mỗi agent native trong các workspace → tạo SessionRunner (inject
  `askPermission`/`askQuestion` trả lời qua map pending prompt chờ `respondPrompt`).
- `send`: runner.run(session, agentId, text) — fire and track.
- Forward `onEvent` → `win.webContents.send(Channels.EventChat, event)`.
- Stop: abort signal của runner.

- [ ] **Step 3: Modify `src/main/index.ts`**

- Khởi tạo `meowAgent = new MeowAgentManager({ configPath: userData/meow.json, store: SessionStore(createJsonStore(sessions.json)), tools: createDefaultTools() })`.
- Register handlers: `ChatSend/Stop/NewSession/ListMessages/RespondPrompt`; forward `chat:event`.
- `WorkspaceAdd`: nếu workspace mới → tự add 1 agent `{ kind:'native', templateId:'meow', name:'meow' }`.
- `addDefaultTemplates`: thêm template mặc định `{ id:'meow', name:'meow', kind:'native' }` (mở rộng `DEFAULT_TEMPLATES` + `Template` type thêm `kind?: AgentKind`).
- `before-quit`: dừng mọi runner (abort) trước khi thoát.
- `workspaces.addAgent`: nhận `kind` trong `NewAgentInput`.

- [ ] **Step 4: Test pass + typecheck + app mở không lỗi (`npm run dev`) + commit**
(`feat: meow agent manager and main wiring`)

---

## Task 11: Preload + renderer ChatPanel UI

**Files:** `src/preload/index.ts` (modify), `src/renderer/src/components/chat/*.tsx` (create),
`src/renderer/src/App.tsx`, `Pane.tsx`, `PaneGrid.tsx` (modify), `styles.css` (modify)

- [ ] **Step 1: Preload**

Thêm 6 method chat vào `api` (subscribe `EventChat` qua helper `subscribe`).

- [ ] **Step 2: ChatPanel**

`ChatPanel({ agentId })`:
- `useEffect` subscribe `onChatEvent` → cập nhật state: messages feed (gom text-delta vào assistant
  message cuối), tool calls (ToolCallCard), prompt-request (hiện buttons Allow/Deny hoặc input cho
  question), done/error → stop spinner.
- Nhận `listChatMessages` khi mount → hiện lịch sử.
- `ChatInput`: textarea + Enter gửi → `sendChat`; nút Stop → `stopChat`.
- Render markdown text đơn giản (split code block + monospace; P1 không cần thư viện markdown).

- [ ] **Step 3: Wire vào Pane**

- `Pane.tsx`: nếu `agent.kind === 'native'` → render `<ChatPanel agentId={id} />` thay `XtermHost`.
- `App.tsx`: `PaneModel` giữ nguyên; khi runtime nhận agent native → không đăng ký terminal.
- `PaneHeader`: với native agent hiện trạng thái từ agent state (running khi đang run, idle khi xong).
- `styles.css`: layout chat feed, message bubble, tool card, buttons Allow/Deny.

- [ ] **Step 4: Manual test `npm run dev`**

Mở workspace (có meow agent native) → chat panel hiện → gõ prompt → message user hiện; chưa có key
model → event error hint config (dựa vào `listChatMessages`/event). Xác nhận không crash.

- [ ] **Step 5: typecheck + commit** (`feat: renderer chat panel for native agent`)

---

## Task 12: E2E + verification cuối

**Files:** `tests/e2e/smoke.spec.ts` (modify)

- [ ] **Step 1: Cập nhật e2e**

Thêm test: mở app → tạo workspace (mock dialog) → thấy `.chat-panel` hiện; gõ prompt vào `.chat-input`
→ message user xuất hiện trong feed (không cần model thật, event error OK).

- [ ] **Step 2: Verification bắt buộc**

Run:
```bash
npm run typecheck
npm test
npm run build && npm run e2e
```
Tất cả PASS.

- [ ] **Step 3: Commit cuối** (`feat: meow agent phase 1`)

---

## Ghi chú thực thi

- Không import `ai`/ai-sdk ở `src/shared` (giữ JSON-serializable).
- `bash` tool và `apply-patch` phải test trên Windows (cmd.exe shim) — giữ pattern từ
  `buildSpawnCommand` trong `pty-manager.ts`.
- Mọi tool giữ `ToolContext.cwd` = projectPath của agent; cấm tool ghi ngoài cwd trừ khi được yêu cầu.
- Prompt-request pending phải bị hủy khi session stop/workspace đóng (tránh hứa không bao giờ trả lời).
