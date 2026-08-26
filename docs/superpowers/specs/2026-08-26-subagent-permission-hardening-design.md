# Subagent Permission Hardening — Design Spec

Ngày: 2026-08-26 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Subagent của Meow (`task` tool) hiện chạy với `decidePermission: () => 'allow'`: mọi rule permission
của user bị bỏ qua bên trong subagent, kể cả `deny`. Ở build mode, model chỉ cần delegate một việc
sang `general` là lách sạch permission model — `bash` mặc định `ask` nhưng subagent chạy không hỏi.

Spec này thay hằng số đó bằng một **permission context dẫn xuất từ agent cha**, theo mô hình của
Claude Code, đồng thời sửa năm lỗ hổng khác cùng nằm trong đường đi của subagent, và mở subagent ra
cho user tự định nghĩa role bằng file.

Ngoài phạm vi: auto-mode classifier của Claude Code (một lượt gọi model cho mỗi tool call), khái
niệm môi trường cô lập để gate bypass, và subagent lồng subagent.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Mô hình permission | Context object dẫn xuất (copy-and-narrow), không phải callback hằng số |
| Vị trí policy | Hàm thuần trong `permission.ts`; `SessionRunner` giữ nguyên interface |
| Tool call `ask` trong subagent | Bubble lên UI agent cha; subagent chạy nền thì deny |
| `ask` khi không có UI | `decide()` hạ `'ask'` → `'deny'` khi `canPrompt === false`, áp cho mọi caller |
| Prompt fatigue | Kế thừa `savedPermissions` của cha; không thêm scope mới |
| Custom role | `.meow/agents/*.md` → `userData/agents/*.md` → 3 role built-in, first-wins theo tên |
| Quyền của role file | Chỉ được siết, không được nới — format không có key `allow` |
| Model của custom role | `model:` trong file → `subagentModels[role]` → model agent cha |
| AgentsTab | Giữ 3 role built-in; không đổi thành danh sách động theo cwd |
| `research` ở plan mode | Cho phép (read-only); các role khác vẫn bị chặn |
| Snapshot | Subagent ghi snapshot dưới `agentId` của cha qua `snapshotAgentId` |
| `todowrite` trong subagent | Lọc bỏ hoàn toàn — runner con không có sink `setTodos` |
| `subagentMaxSteps` | Config mới, mặc định 30 (thay 20 hardcode) |

## 3. Kiến trúc

```
meow-agent-manager (sở hữu cfg.permission, modes, savedPermissions, awaitPrompt)
        │ dựng ToolPermissionContext của cha (dựng lại mỗi lần gọi → live)
        ▼
createTaskTool
        │ deriveSubagentContext(parent, role, { background })   ← chỉ thu hẹp
        ▼
SessionRunner (con)  ── decidePermission: (tool, input) => decide(childCtx, tool, input)
                     └─ ask: bubble về awaitPrompt(agentId cha)
```

### 3.1 ToolPermissionContext

```ts
// src/main/agent/permission.ts
export interface ToolPermissionContext {
  mode: AgentMode
  rules: Record<string, PermissionRule>
  isSavedAllow: (tool: string) => boolean
  canPrompt: boolean
}

export function decide(
  ctx: ToolPermissionContext,
  tool: string,
  input?: Record<string, unknown>
): PermissionDecision
```

`decide()` giữ nguyên từng bước của `decidePermission()` hiện tại (chặn bash ghi file ở plan mode →
gộp `configRules` với `rulesForMode(mode)` → `deny` thắng → saved-allow ngoài plan mode → `allow` →
mặc định `ask`), chỉ đọc từ `ctx` thay vì bốn tham số rời, cộng một luật cuối:

> `if (result === 'ask' && !ctx.canPrompt) return 'deny'`

Luật này áp cho mọi caller, không riêng subagent: không có kênh hỏi thì không được coi là được phép.
Context của agent cha luôn có `canPrompt: true` — cha luôn có UI; trường hợp user bấm Stop giữa lúc
chờ đã được `awaitPrompt` xử lý sẵn bằng cách resolve `null` (tính là từ chối).

`decidePermission()` cũ giữ lại làm wrapper mỏng gọi `decide()` để không phải sửa call site của
runner cha trong cùng một lần thay đổi.

### 3.2 SubagentRole và deriveSubagentContext

```ts
export interface SubagentRole {
  name: string
  description: string
  system: string
  tools: string[]
  rules: Record<string, PermissionRule>   // chỉ chứa 'deny' | 'ask', không bao giờ 'allow'
  model?: { provider: string; model: string }
}

export function deriveSubagentContext(
  parent: ToolPermissionContext,
  role: SubagentRole,
  opts: { background: boolean }
): ToolPermissionContext
```

`SubagentRole` là dạng chuẩn hoá chung cho cả ba role built-in lẫn role đọc từ file, nên
`deriveSubagentContext` không cần biết role đến từ đâu. `rules` của role built-in là object rỗng.

| Trường | Cách dẫn xuất |
|---|---|
| `mode` | kế thừa nguyên vẹn — subagent không đổi được mode |
| `rules` | mỗi tool lấy giá trị **chặt hơn** giữa cha và role, thứ tự `deny > ask > allow` |
| `isSavedAllow` | kế thừa nguyên vẹn |
| `canPrompt` | `parent.canPrompt && !opts.background` |

Dòng `rules` là hiện thân của luật "chỉ siết không nới": role khai `allow` chỗ cha `ask` vẫn ra
`ask`; role khai `deny` chỗ cha `allow` ra `deny`. Hàm thuần, test bằng assertion trên object trả về.

Tool allowlist của role vẫn là tầng chặn thứ hai (`safeTools` chỉ nạp tool có tên trong `role.tools`).
`createTaskTool` nhận `this.tools` — bản đồ chưa có `task` — nên role dù khai `tools: task` cũng
không lồng được subagent.

### 3.3 Bubble prompt

`createTaskTool` nhận thêm `ask` do manager cấp (`awaitPrompt(agent.id, …)`). Khi `decide()` trả
`'ask'`, runner con emit `prompt-request` mang thêm `taskId` và `subagentType`; UI hiển thị nguồn gốc
subagent thay vì để prompt trông như của agent cha. `respondPrompt` resolve như luồng hiện tại —
`pendingPrompts` vốn khoá theo `promptId` và `agentId` nên không phải đổi cấu trúc.

Task nền có `canPrompt === false` nên không bao giờ tới bước này; call cần hỏi bị deny với lý do rõ
ràng trong `call.error`.

### 3.4 Custom role

Discovery theo đúng pattern của `collectSkills`:

```
<cwd>/.meow/agents/*.md   →   userData/agents/*.md   →   SUBAGENT_CONFIGS (built-in)
```

First-wins theo `name`: project override user override builtin. Dùng lại `parseFrontmatter` sẵn có
trong `skill.ts` (chỉ đọc `key: value` phẳng) — không thêm thư viện YAML.

```
---
name: db-migrator
description: Chạy migration và kiểm tra schema
tools: read, glob, grep, bash
model: anthropic/claude-sonnet-5
deny: git, office
ask: bash
---
Bạn là subagent chuyên migration. Luôn dump schema trước khi đổi...
```

Body là system prompt. Frontmatter **không có key `allow`** — chỉ tồn tại `deny:` và `ask:`, hai chỉ
thị siết. Luật "chỉ được siết" nằm ngay ở tầng format, không phụ thuộc vào một nhánh `if` nào nhớ
kiểm tra.

Quy tắc parse:

- `tools:`, `deny:`, `ask:` là danh sách phân tách bằng dấu phẩy; tên tool không có trong registry
  bị bỏ qua ở cả ba key.
- `model:` có dạng `provider/model`, không mang `accountId` — account vẫn do
  `resolveAgentConfig` của agent cha quyết định. Provider không tồn tại thì bỏ qua `model:` và rơi
  về thứ tự ưu tiên phía dưới.
- Role thiếu `name` bị bỏ qua, như skill. `name` trùng với role đã thấy trước đó cũng bị bỏ qua
  (first-wins).

Kiểu: `SubagentType` đổi từ union ba giá trị thành `string`, kèm
`BUILTIN_SUBAGENT_TYPES = ['research','general','reviewer'] as const`. `SUBAGENT_CONFIGS` giữ nguyên
làm định nghĩa built-in. `normalizeSubagentModels` bỏ lọc theo enum, chỉ còn validate `ModelRef`.

Schema tool: `subagent_type` từ `z.enum([...])` thành `z.string().default('research')`. Description
liệt kê role biết được lúc registration; `run()` resolve **live** theo `ctx.cwd` nên file agent mới
có hiệu lực ngay, tên lạ trả lỗi kèm danh sách hợp lệ.

`TraceEvent.subagentType` vốn đã là `string` — trace UI không phải sửa.

### 3.5 Plan mode

`PLAN_RULES.task` đổi từ `'deny'` thành `'allow'`, kèm chặn theo role: chỉ `research` chạy được ở
plan mode, role khác bị từ chối ngay trong `run()` với lý do rõ ràng. Subagent `research` vẫn kế thừa
`mode: 'plan'`, nên `PLAN_RULES` chặn write/git/bash-ghi-file ở tầng dưới nữa.

## 4. Năm nhóm sửa kèm

### 4.1 Snapshot / undo

`write`/`edit`/`apply-patch` gọi `snapshotFile(ctx, …)`, hàm này no-op khi `ctx.snapshots` undefined —
đúng trạng thái của subagent hiện nay. Hệ quả: `undoTurn` khôi phục file cha sửa nhưng bỏ nguyên file
subagent sửa, workspace về trạng thái lai.

Thêm `snapshotAgentId?: string` vào deps của `SessionRunner` và vào `ToolContext`; `snapshotFile` dùng
`ctx.snapshotAgentId ?? ctx.agentId`. Runner con nhận `snapshots` của cha và `snapshotAgentId` = id
agent cha, nhưng giữ `agentId` riêng cho event để trace không lẫn.

### 4.2 Cost theo model thật

`reportUsage` đang tính `priceFor(resolved.provider, resolved.model)` của agent cha, kể cả khi
`subagentModels` trỏ subagent sang model khác. `onUsage` của `createTaskTool` mang thêm model đã dùng:
`onUsage?(tokens, used?: { provider: string; model: string })`; manager tính
`priceFor(used?.provider ?? resolved.provider, used?.model ?? resolved.model)`.

### 4.3 Background orphan + lạc session

Controller của lượt bị `controllers.delete(agentId)` ở `finally`, nên task nền sinh ra ở lượt N không
còn tay cầm nào sau khi lượt đó đóng: `stop()` ở lượt N+1 abort controller khác, `stopAll()` duyệt map
đã xoá. Song song đó `onBackgroundResult` gọi `activeSessionId()` lúc *hoàn thành*, nên đổi session
giữa chừng thì báo cáo rơi vào transcript khác.

Một callback giải quyết cả hai: `createTaskTool` gọi `onBackgroundStart(id, cancel)` ngay lúc spawn;
manager lưu `{ sessionId, cancel }` vào map theo agent và xoá khi xong.

- `stop()` / `stopAll()` gọi `cancel` của mọi task nền đang chạy của agent.
- `onBackgroundResult` append vào `sessionId` đã chụp lúc spawn.

Task nền vẫn link với `ctx.signal` của lượt cha như hiện nay.

### 4.4 max-steps

`subagentMaxSteps` vào `MeowConfig`, mặc định 30 (thay 20 hardcode); cha giữ `maxSteps` 100.

`runSubagent` bắt `reason` từ event `done`. Khi `reason` là `max-steps` hoặc `length`, output đổi thành:

```
<task id="…" state="incomplete" reason="max-steps">
```

Hiện `runSubagent` bỏ qua `reason` và bọc mọi kết quả trong `state="completed"`, nên cha coi công việc
dở là đã xong.

### 4.5 Hai chỗ nhỏ

- Nhánh background emit `done` thiếu `parentTaskId`; bổ sung cho khớp nhánh runner.
- `todowrite` lọc khỏi mọi subagent: bỏ khỏi tool set của `general` và chặn trong `safeTools` kể cả
  khi role tự khai. Runner con không nhận `setTodos` nên tool này đang báo thành công rồi nuốt dữ
  liệu. Cấp cho subagent danh sách todo riêng thì cần UI mới — cắt.

## 5. Testing

Hàm thuần trước:

- `decide()` với `canPrompt: false` hạ `ask` → `deny`; các nhánh còn lại giữ nguyên hành vi cũ.
- `deriveSubagentContext` với cặp cha/role đối nghịch: role nới không nới được, role siết siết thật,
  `canPrompt` tắt khi background.
- Parse frontmatter role: `tools` lọc tên lạ, thiếu `name` thì bỏ, `deny`/`ask` vào đúng `rules`.
- Precedence discovery: project override user override builtin.

Tầng wiring:

- Subagent gặp `ask` ở foreground → emit `prompt-request` mang `taskId`; trả lời xong tool chạy.
- Subagent nền gặp `ask` → deny, không treo.
- Snapshot của subagent ghi dưới `agentId` cha; `undoTurn` khôi phục file subagent sửa.
- Cost dùng model của subagent khi `subagentModels` có override.
- `stop()` giết task nền sinh ra ở lượt trước.
- Kết quả nền về đúng session sau khi `switchSession`.
- Hết step → `state="incomplete" reason="max-steps"`.
- `research` chạy được ở plan mode, `general` bị từ chối.

17 test hiện có trong `agent-task.test.ts` và `agent-task-tool.test.ts` phải xanh lại;
`agent-task.test.ts` cần sửa vì assert cứng ba role và tool set (`todowrite` rời khỏi `general`).

Cổng hoàn thành theo AGENTS.md: `npm run typecheck` và `npm test` xanh.

## 6. Docs phải cập nhật

- `src/main/agent/tools/AGENTS.md` — dòng mô tả `task.ts`.
- `src/main/agent/AGENTS.md` — permission context và discovery role.
- `AGENTS.md` gốc — mục `.meow/agents/`.
