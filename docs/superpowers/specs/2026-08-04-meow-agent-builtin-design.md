# Meow Agent — Built-in Coding Agent Engine: Design Spec

Ngày: 2026-08-04 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Xây **agent coding riêng** chạy **native bên trong meow-coding** (không phải CLI ngoài), tái hiện
kiến trúc core của opencode (session runner, tool registry, config, permission, LLM layer) theo đúng
stack của meow-coding: **Node + TypeScript strict + electron-vite + Vitest + Vercel AI SDK**.

- Sau khi mở một project, workspace **tự có sẵn 1 Meow Agent** (agent chính) để dùng ngay, không cần
  cài gì thêm.
- Không bundle binary opencode, không merge repo opencode, không kéo Effect/Bun/drizzle vào dự án.
- Tham chiếu thiết kế từ `packages/core` của opencode 1.18.11: `session/runner`, `tool/*`, `config`,
  `permission`, tầng LLM (ai-sdk).

## 2. Quyết định từ brainstorm

| Chủ đề | Quyết định |
|---|---|
| Nguồn tham chiếu | Core opencode (session runner, tools, config, permission, LLM) — tái hiện theo stack dự án |
| Runtime | Node trong main process (không Bun, không Effect) |
| LLM layer | Vercel AI SDK: `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai-compatible` |
| Provider v1 | Anthropic + OpenAI-compatible (config: models, apiKey từ config/env) |
| UI | **Chat panel riêng** mỗi agent (message feed + tool calls + diff + permission prompt); giữ pane grid/zoom |
| Tools | Toàn bộ tools opencode, chia pha: **P1 core**, P2 webfetch/websearch, P3 MCP, P4 skill/plugin |
| Session | Message + tool output lưu trong `userData/sessions.json` (dùng JsonStore sẵn có) |
| Config | `meow.json` trong `userData`: providers, models, agents (system prompt), permissions |
| Permission | Rules `allow` / `ask` / `deny`; khi `ask` → prompt trong UI chat panel |
| Agent mặc định | Thêm workspace → tự sinh 1 agent native tên **meow** |
| Loại agent | `AgentConfig` thêm trường `kind: 'pty' \| 'native'`; native không spawn PTY |

## 3. Phạm vi P1

**Có:**
- `meow.json` config (providers/models/agents/permissions) + env fallback key.
- Agent loop hoàn chỉnh: prompt → model → tool calls → observe → lặp, có `maxSteps`.
- Tools core: `bash`, `read`, `write`, `edit`, `glob`, `grep`, `apply-patch`, `todowrite`, `question`.
- Streaming events ra UI: text delta, tool start/result, permission request, done, error.
- Permission system: allow/ask/deny theo tool; `ask` hiện prompt trong chat panel, trả kết quả về loop.
- Session persist: messages + tool calls, list/resume session khi mở lại workspace.
- Chat panel UI: message feed (markdown text), tool call cards, diff view cho apply-patch/edit, input box,
  nút stop.
- Workspace mới tự thêm 1 Meow Agent; template mặc định `meow` (kind native) hiện trong danh sách.

**Đã hoàn thành (P2–P4):**
- P2: webfetch (HTML→markdown qua turndown), websearch (Tavily, cần `TAVILY_API_KEY`), diff view cho edit/apply-patch.
- P3: MCP client (`@modelcontextprotocol/sdk`): stdio + streamable-HTTP, tool `mcp__<server>__<tool>`, cấu hình qua `meow.json` → `mcp`.
- P4: skills (`<project>/.meow/skills` + `userData/skills`, markdown + frontmatter, tool `skill` + danh sách trong system prompt) và user plugins/tools (`userData/tools/*.js`, default-export `{ name, description, schema, run }`).

**Chưa làm (để sau):**
- `web` tool (browser automation).
- Multi-model routing, tokens/per-cost tracking, snapshot/revert, OAuth login.

## 4. Kiến trúc

```
src/main/agent/
  config.ts        # load meow.json + env: providers, models, agents, permissions
  llm.ts           # AI SDK provider factory (anthropic, openai-compatible) + stream wrapper
  message.ts       # chuyển ChatMessage + ToolCall ↔ AI SDK message/tool
  session.ts       # SessionStore: persist sessions + messages (JsonStore)
  loop.ts          # SessionRunner: agent loop, maxSteps, interruption, phát ChatEvent
  permission.ts    # quyết định allow/ask/deny; ask qua callback → IPC
  tools/
    registry.ts    # ToolDefinition { name, schema, needsPermission, run } + register
    bash.ts read.ts write.ts edit.ts glob.ts grep.ts
    apply-patch.ts todowrite.ts question.ts
src/shared/        # mở rộng: ChatMessage, ToolCallData, ChatEvent, AgentKind, Channels, AgentApi
src/renderer/src/components/chat/
  ChatPanel.tsx    # 1 agent native: message feed + input + stop
  MessageItem.tsx  # 1 message (markdown, role)
  ToolCallCard.tsx # card tool call: input json + output/diff + permission buttons
  ChatInput.tsx    # textarea gửi prompt
src/main/index.ts  # MeowAgentManager: quản lý session/loop per agent, IPC handlers, forward event
src/preload/index.ts  # thêm method chat
```

Luồng:
1. Renderer gửi prompt → `chat:send`.
2. Main: SessionRunner append user message → resolve model → `llm.stream()`.
3. Stream text → `chat:event {text-delta}` → ChatPanel cập nhật.
4. Model trả tool calls → với mỗi tool: `permission.ts` check → nếu `ask`, gửi
   `prompt-request` + chờ renderer trả lời `chat:respond-prompt`.
5. Chạy tool → `tool-result` → feed kết quả lại model → lặp (tới `maxSteps`).
6. `done` / `error` kết thúc vòng lặp; messages + tool calls persist vào session store.

## 5. Data model (shared)

```ts
export type AgentKind = 'pty' | 'native'
export interface AgentConfig { id; name; templateId; cwd; kind?: AgentKind }

export type ChatRole = 'user' | 'assistant'
export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  createdAt: number
}
export interface ToolCallData {
  id: string
  tool: string
  input: Record<string, unknown>
  output?: string
  error?: string
  permission: 'pending' | 'allowed' | 'denied'
}
export type ChatEvent =
  | { type: 'text-delta'; agentId: string; delta: string }
  | { type: 'tool-start'; agentId: string; call: ToolCallData }
  | { type: 'tool-result'; agentId: string; call: ToolCallData }
  | { type: 'prompt-request'; agentId: string; promptId: string;
      kind: 'permission' | 'question'; call?: ToolCallData; question?: string }
  | { type: 'done'; agentId: string; reason: string }
  | { type: 'error'; agentId: string; message: string }
```

IPC mới: `ChatSend`, `ChatStop`, `ChatNewSession`, `ChatListMessages`, `ChatRespondPrompt`,
`EventChat` (`chat:event`). Preload expose: `sendChat`, `stopChat`, `newChatSession`,
`listChatMessages`, `respondPrompt`, `onChatEvent`. `prompt-request` dùng chung cho cả permission
`ask` và tool `question`; renderer trả lời qua `respondPrompt(promptId, { allow: boolean, text? })`.

## 6. Config `meow.json` (userData)

```jsonc
{
  "provider": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY", "model": "claude-sonnet-4-5" },
    "openai": { "apiKeyEnv": "OPENAI_API_KEY", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o" }
  },
  "model": "anthropic",
  "agents": {
    "meow": { "model": "anthropic", "systemPrompt": "You are Meow, a coding agent..." }
  },
  "permission": {
    "bash": "ask",
    "write": "allow",
    "edit": "allow",
    "web*": "deny"
  }
}
```

Quy tắc: key lấy từ env nếu `apiKeyEnv` set hoặc trực tiếp trong config. Mặc định đọc
`MEOW_MODEL`, `MEOW_PROVIDER`; nếu chưa config → error rõ ràng, hint tiếng Việt `[meow]`.

## 7. Xử lý lỗi

- Thiếu provider/key → `error` event + hint cấu hình `meow.json`.
- Tool exec fail → trả error string về model, không crash loop.
- Model stream lỗi → `error` event, session giữ nguyên để retry.
- Stop: hủy AbortController của stream đang chạy; `done {reason:'stopped'}`.
- Permission deny → tool trả "permission denied" về model.
- Đóng app: hủy mọi stream đang chạy (không spawn process mồ côi; bash tool dùng tree-kill).

## 8. Kiểm thử

- Unit (Vitest): config load/parse, permission rules, message conversion, session store,
  từng tool (bash, read, write, edit, glob, grep, apply-patch, todowrite), **loop với model stub**
  (không gọi API thật): text-only turn, tool-call turn, max-steps, stop.
- Integration: loop + tools thật trên temp dir (git init + apply-patch), bash tool spawn thật.
- E2E: mở app → mở workspace → chat panel hiện → gõ prompt → thấy message user (không cần model thật).
- Luôn chạy `npm run typecheck`, `npm test` trước khi hoàn thành.

## 9. Tiêu chí thành công

1. Mở project → workspace tự có Meow Agent, chat panel hiện, gõ được prompt.
2. Với config có key thật: agent trả lời, gọi tool (read/write/edit/bash), hiện tool call + diff.
3. Permission `ask` hiện nút Allow/Deny trong panel, đúng hành vi allow/deny.
4. Messages persist; mở lại workspace → session cũ resume được.
5. Stop dừng được stream; đóng app không để lại process con.
6. Unit + integration + E2E xanh; typecheck pass.
