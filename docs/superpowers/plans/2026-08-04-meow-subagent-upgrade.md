# Meow Coding — Nâng cấp sub-agent theo superpowers (mirror opencode)

**Goal:** Làm lại sub-agent theo đúng cách opencode (đã học từ `D:\GitHub\opencode-1.18.11\packages\opencode\src\tool\task.ts` + `session/processor.ts` + `tool/task.txt`):
- `task` tool params giống opencode: `description`, `prompt`, `subagent_type`, `task_id` (resume).
- Subagent = **agent type** (system prompt + tool set riêng) — implementer ghi file được, reviewer read-only + git.
- Kết quả bọc XML `<task id=... state=...><summary>…<task_result>…` để agent cha parse.
- Tool calls trong 1 turn chạy **song song** khi không cần `ask` (opencode processor xử lý concurrent) → dispatch nhiều subagent song song.
- **Resume** qua `task_id` (fix loop SDD rounds 1-3).

## Thiết kế

### task.ts (theo opencode)
`SUBAGENT_CONFIGS: Record<'research'|'general'|'reviewer', { system, tools }>`:
- `research`: read/glob/grep/webfetch (mặc định, giữ hành vi cũ).
- `general`: + write/edit/apply-patch/bash/git/todowrite/skill — prompt yêu cầu trả report `DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED`.
- `reviewer`: read/glob/grep/git/webfetch — trả `APPROVED/CHANGES_REQUESTED` + findings.

Closure `sessions: Map<taskId, TranscriptItem[]>` → resume tiếp tục đúng context. Output qua `renderOutput` (thẻ `<task>`).

### loop.ts
```ts
const needsPermission = calls.some(c => decidePermission(c.tool) === 'ask')
needsPermission ? sequential : Promise.all(calls.map(executeCall))
```

### Tests
- SUBAGENT_CONFIGS; research không ghi file, general ghi file được; resume qua task_id; 2 tool-call allow chạy song song.

## Kiểm thử
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
