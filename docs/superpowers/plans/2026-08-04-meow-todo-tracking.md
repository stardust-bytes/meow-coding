# Meow Coding — Todo list tracking (theo opencode)

**Goal:** Khi agent gọi `todowrite`, todo list được **lưu theo session** và hiển thị trong UI chat để theo dõi tiến độ (pending / in_progress / completed / cancelled + đếm X/Y). Tham khảo source opencode `D:\GitHub\opencode-1.18.11`:

- `packages/schema/src/session-todo.ts` — `Todo.Info = { content, status: pending|in_progress|completed|cancelled, priority: high|medium|low }`.
- `packages/opencode/src/session/todo.ts` — lưu theo `sessionID`, `update` thay toàn bộ list, phát event `todo.updated { sessionID, todos }`.
- `packages/opencode/src/tool/todo.ts` — `todowrite` nhận `todos: Todo.Info[]`, ghi đè, output = JSON.
- `packages/opencode/src/tool/todowrite.txt` — hướng dẫn model: chỉ dùng khi ≥3 bước, đúng 1 `in_progress`, `completed` chỉ khi thực sự xong, cập nhật realtime.

**Phạm vi:** `src/shared/types.ts`, `src/main/agent/session.ts`, `src/main/agent/tools/{types,todowrite}.ts`, `src/main/agent/loop.ts`, `src/main/meow-agent-manager.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `ChatPanel.tsx`, `styles.css`, tests.

---

## Thiết kế

### shared/types.ts
```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'
export interface TodoItem { content: string; status: TodoStatus; priority?: TodoPriority }
```
ChatEvent thêm: `| { type: 'todo-updated'; agentId: string; todos: TodoItem[] }`

### session.ts
`StoredSession` thêm `todos: TodoItem[]` (migration: thiếu → `[]`). API: `todos(id)`, `setTodos(id, todos)`.

### tools/types.ts
`ToolContext.setTodos?(todos: TodoItem[]): void` (optional).

### tools/todowrite.ts
Schema `todos: [{ content, status enum, priority enum optional }]`; description theo hướng dẫn opencode (condensed: When to use / States / Rules). `run`: `ctx.setTodos?.(todos)`; output = `JSON.stringify(todos, null, 2)`.

### loop.ts
`LoopDeps.setTodos?`; trong `executeCall` toolCtx: `setTodos: (todos) => this.deps.setTodos?.(todos)`.

### meow-agent-manager.ts
- `register()`: `setTodos: (todos) => { this.deps.store.setTodos(this.activeSessionId(agent.id), todos); this.emit({ type: 'todo-updated', agentId: agent.id, todos }) }`.
- `getTodos(agentId)`: `store.todos(activeSessionId)`.

### IPC
`ChatGetTodos: 'chat:get-todos'` + `AgentApi.getChatTodos(agentId): Promise<TodoItem[]>`; preload + main handler + ipc-contract test.

### Renderer (ChatPanel)
- State `todos`; mount: `getChatTodos`; `applyEvent` xử lý `todo-updated`; `resetView` reset todos.
- Panel hiển thị khi `todos.length > 0`, đặt giữa SessionBar và chat-feed:
  - Header: "Tasks" + `done/total`.
  - Row: mark theo status (`pending □`, `in_progress ◐` accent, `completed ✓` green + strikethrough, `cancelled ✕` dim + strikethrough) + content.
- CSS flat/vuông theo theme.

## Kiểm thử
- session-store: todos set/get + migration.
- agent-tools: todowrite mới (schema object, setTodos stub, output JSON).
- ipc-contract: `getChatTodos`.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: Main process (types + session + tool + loop + manager + IPC)
- [ ] shared/types.ts: TodoStatus/TodoPriority/TodoItem + event `todo-updated`.
- [ ] session.ts: `todos` field + migration + get/set.
- [ ] tools/types.ts: `setTodos?`.
- [ ] todowrite.ts: schema + run.
- [ ] loop.ts: LoopDeps.setTodos + toolCtx.setTodos.
- [ ] meow-agent-manager.ts: register setTodos + getTodos.
- [ ] ipc/preload/index handlers + test.
- [ ] typecheck + npm test.

## Task 2: Renderer
- [ ] ChatPanel: todos state + load + event + reset + panel render.
- [ ] styles.css: `.chat-todos`.
- [ ] typecheck + build.

## Task 3: Verify
- [ ] npm test + build + e2e.
- [ ] Script Playwright: gửi `todo-updated` → panel hiển thị đúng status/progress.
