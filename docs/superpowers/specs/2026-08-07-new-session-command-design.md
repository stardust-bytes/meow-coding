# Meow Coding — `/new` command (new session) — Design

Ngày: 2026-08-07 · Trạng thái: chờ duyệt · Bước: sau brainstorm

## 1. Mục tiêu

Thêm lệnh slash `/new` trong chat native agent để **tạo session làm việc mới** (tương đương nút
"New session" trong SessionBar) mà không cần rời bàn phím. Khi chạy: dừng turn đang chạy, tạo session
mới, renderer reset view + reload session list.

## 2. Hiện trạng

- Slash commands (built-in + user + project) được dispatch qua `MeowAgentManager.runCommand`
  (`src/main/meow-agent-manager.ts:572`): resolve template → `send(agentId, text)` → gửi prompt cho LLM.
- Command là model prompt-dispatch; **chưa có khái niệm "system command"** (hành động không gửi prompt).
- Tạo session hiện chỉ qua UI: nút New session trong `SessionBar` → `ChatPanel.handleCreateSession`
  (`createSession` + `resetView` + `reloadSessions`).
- Session tạo mới từ main: `MeowAgentManager.createSession` (`stop(agentId)` + `store.create` + set
  active). Có wrapper public `newSession(agentId)`.

## 3. Thiết kế mới

### 3a. Khái niệm system command (main-side)

Thêm trường `type?: 'prompt' | 'system'` cho `Command` (shared) — mặc định `prompt`, optional để không
vỡ dữ liệu user command cũ. System command **không** đi qua `resolveCommand`/`send`; `runCommand`
dispatch theo tên.

### 3b. Builtin `/new`

`src/main/agent/commands.ts` thêm:

```ts
export const NEW_COMMAND: Command = {
  name: 'new',
  description: 'Start a new session',
  template: '',
  type: 'system'
}
```

- Thêm vào builtin list (`CommandStore` builtin) → hiện trong menu `/` và `listCommands`.
- Không remove được (giống builtin khác).

### 3c. `runCommand` dispatch

`src/main/meow-agent-manager.ts` `runCommand`: sau khi tìm thấy command, nếu `command.type === 'system'`
thì dispatch handler (hiện chỉ có `new`):

```ts
if (command.type === 'system') {
  if (command.name === 'new') {
    this.newSession(agentId)
    this.emit({ type: 'session-created', agentId })
  }
  return
}
```

Không gọi `send`/LLM.

### 3d. ChatEvent `session-created`

Thêm union member: `{ type: 'session-created'; agentId: string }`. Đi qua kênh `Channels.EventChat` sẵn
có — **không** thêm channel/IPC method mới.

### 3e. Renderer phản ứng

`ChatPanel.applyEvent`: xử lý `session-created` → `resetView()` + `reloadSessions()` (giống
`handleCreateSession`).

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/shared/types.ts` | `Command.type?`; `ChatEvent` thêm `session-created` |
| `src/main/agent/commands.ts` | `NEW_COMMAND` builtin |
| `src/main/meow-agent-manager.ts` | `runCommand` dispatch system command |
| `src/renderer/src/components/chat/ChatPanel.tsx` | `applyEvent` xử lý `session-created` |
| `tests/unit/meow-agent-manager.test.ts` | Test `/new` tạo session + emit event |

## 5. Không đổi

- IPC channels/`AgentApi` methods (dùng `SessionCreate`/`ChatRunCommand`/`EventChat` sẵn có).
- `resolveCommand`, `SessionBar`, `handleCreateSession` (vẫn dùng cho nút UI).
- Session store / createSession logic.

## 6. Kiểm thử

- `npm run typecheck` — PASS.
- `npm test` — PASS (thêm unit test `/new`: tạo session mới + emit `session-created`, không gọi LLM).
- E2E không ảnh hưởng (không đổi contract channel/method).

## 7. Out of scope

- `/new <prompt>` để seed prompt vào session mới.
- Tự đặt tên session.
