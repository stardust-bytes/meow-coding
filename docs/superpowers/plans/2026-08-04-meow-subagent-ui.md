# Meow Coding — Hiển thị sub-agent đang chạy trong UI (theo opencode)

**Goal:** Người dùng **thấy sub-agent chạy live** trong chat. opencode làm vậy bằng child-session + subtask part, UI stream message sub-agent lồng vào chat cha. Meow: stream hoạt động sub-agent thành event `subagent-event` → renderer hiện card lồng cập nhật live (streaming text + tool calls + state).

**Phạm vi:** `src/shared/types.ts`, `src/main/agent/tools/types.ts`, `src/main/agent/loop.ts`, `src/main/agent/tools/task.ts`, renderer `ChatPanel.tsx`, `styles.css`, tests.

---

## Thiết kế

### ChatEvent mới
```ts
| { type: 'subagent-event'; agentId: string; taskId: string
    sub: 'start' | 'delta' | 'tool' | 'done'
    subagentType?: string; text?: string; tool?: string
    state?: 'running' | 'completed' | 'cancelled' | 'error' }
```

### ToolContext
`emitSubagent?: (taskId: string, e: {...}) => void` — task tool dùng để đẩy hoạt động sub-agent lên.

### loop.ts
`executeCall`: toolCtx `emitSubagent: (taskId, partial) => deps.onEvent({ type:'subagent-event', agentId, taskId, ...partial })`.

### task.ts
Subagent runner `onEvent` forward:
- start → `{ sub:'start', subagentType }`
- text-delta → `{ sub:'delta', text }`
- tool-start/tool-result → `{ sub:'tool', tool }`
- done → `{ sub:'done', state }` (stopped=cancelled, complete=completed)
- error → `{ sub:'done', state:'error' }`

### Renderer (ChatPanel)
- FeedItem thêm `{ kind:'subagent'; taskId; subagentType?; text; tools[]; state }`.
- `applyEvent` xử lý `subagent-event`: tìm/tạo item theo taskId, append text, thêm tool, set state.
- Render card lồng: head (sub-agent + type + state), tools (code chips), text streaming, dấu "…" khi running.
- CSS `.subagent` indented, mono, viền trái accent.

## Kiểm thử
- typecheck, npm test, build, e2e.
- Script: inject `subagent-event` → card hiện + cập nhật text/state.
