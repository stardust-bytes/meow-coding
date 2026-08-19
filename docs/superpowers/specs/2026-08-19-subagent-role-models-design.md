# Meow Coding — Sub-agent model theo vai trò (Role-based sub-agent models): Design Spec

Ngày: 2026-08-19 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Sub-agent hiện spawn với **cùng model với main agent** (`model: opts.model` trong
`src/main/agent/tools/task.ts`). User muốn mỗi loại sub-agent chạy một model khác nhau theo vai trò —
giống mô hình orchestrator mà các hãng lớn (Claude Code, Cursor, opencode, Gemini CLI) đang dùng:
main agent = model xịn (brainstorm + orchestration), sub-agent = model phù hợp vai trò.

Mapping được chốt với user:

| Vai trò | Model |
|---|---|
| Main agent | Xịn, cố định (mặc định) |
| Sub `research` | Xịn (cùng main) |
| Sub `general` | Medium |
| Sub `reviewer` | Rẻ nhất |

Không có cơ chế auto stage-detection theo workflow, không bắt buộc delegate — đi theo xu hướng big
tech: sub-agent là một *tool* main chủ động gọi, việc delegate thuộc skill system đã có
(`dispatching-parallel-agents`, `executing-plans`, `requesting-code-review`).

## 2. Phạm vi

- Chỉ áp dụng cho **Meow agent built-in** (không đụng external CLI agents: opencode, Claude Code, aider).
- Chỉ 3 loại sub-agent hiện có: `research` | `general` | `reviewer` (định nghĩa trong
  `SUBAGENT_CONFIGS`, `src/main/agent/tools/task.ts`).
- **Ngoài phạm vi** (follow-up riêng nếu cần): `Command.model` (model theo slash-command, field đã có
  trong `src/shared/types.ts` nhưng chưa dùng), auto stage-detection, per-agent override.

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Nơi lưu cấu hình | **Global trong settings** (`MeowSettings.subagentModels`) — dùng chung cho mọi agent pane, đúng yêu cầu user: "new agent pane nhận chung 1 settings, không settings riêng" |
| Wire format | `Record<SubagentType, ModelRef>` — `ModelRef { provider, model }` (đã tồn tại trong shared types) |
| Fallback khi chưa cấu hình | Kế thừa model/LLM client của main agent (giữ nguyên hành vi hiện tại — zero break) |
| Runtime | `createTaskTool` nhận thêm `resolveSubagent(type)`; có cấu hình → resolve provider/model + **tạo LLM client riêng**; không → undefined, kế thừa |
| UI | Section "Sub-agent models" trong Settings (tab Agents), 3 dòng provider+model picker, mỗi dòng có nút "Use main agent model" để xóa cấu hình |
| Persistence | `meow.json` — field `subagentModels` top-level; nối qua `configToSettings`/`settingsToConfig` như các field khác |

## 4. Data model

### 4.1 `src/shared/types.ts` — mở rộng `MeowSettings`

```ts
export interface MeowSettings {
  // ...existing
  subagentModels?: Partial<Record<'research' | 'general' | 'reviewer', ModelRef>>
}
```

> `SubagentType` hiện khai báo trong `src/main/agent/tools/task.ts` (không thuộc shared). Để tránh
> import main → shared ngược chiều, dùng union literal trong shared hoặc chuyển `SubagentType` sang
> `src/shared/types.ts`. (Quyết định: chuyển `SubagentType` sang shared — renderer cũng cần nó cho UI
> dropdown, và `Command`/types thuần đã nằm shared.)

### 4.2 `src/main/agent/config.ts` — mở rộng `MeowConfig`

```ts
export interface MeowConfig {
  // ...existing
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
}
```

- `mergeDefaults` thêm `normalizeSubagentModels(raw.subagentModels)` — lọc bỏ role không có
  `provider`/`model` hợp lệ, và model phải nằm trong `provider[id].models` (nếu không → bỏ, fallback).
- `configToSettings` / `settingsToConfig` map field này 2 chiều.

### 4.3 Validate

- Provider phải tồn tại trong `cfg.provider`; model phải thuộc `provider.models`. Không hợp lệ →
  coi như chưa cấu hình (fallback main) — **không hard-fail**, vì user có thể đổi provider sau.

## 5. Runtime — `src/main/agent/tools/task.ts` + `meow-agent-manager.ts`

Hiện tại `createTaskTool({ llm, model, tools, onBackgroundResult })` — sub agent dùng chung `opts.llm`
và `opts.model`. Thay đổi:

### 5.1 `createTaskTool` nhận thêm

```ts
export interface ResolvedSubagentModel {
  provider: string
  model: string
  llm: LlmClient
}

createTaskTool(opts: {
  llm: LlmClient
  model: string
  tools: Map<string, ToolDefinition>
  resolveSubagent?: (type: SubagentType) => ResolvedSubagentModel | undefined
  onBackgroundResult?: ...
})
```

Trong `runSubagent`:

```ts
const sub = opts.resolveSubagent?.(input.subagent_type)
const runner = new SessionRunner({
  ...
  model: sub?.model ?? opts.model,
  llm: sub?.llm ?? opts.llm,
  ...
})
```

### 5.2 `meow-agent-manager.ts` — cấp `resolveSubagent`

Trong `register()` (nơi tạo `taskTool`), xây dựng resolver:

- Đọc `cfg.subagentModels[type]`.
- `resolveAgentConfig(cfg, agent.name, env, `${ref.provider}/${ref.model}`)` để lấy apiKey/baseUrl.
- Provider là `CHATGPT_WEB_PROVIDER_ID` → dùng `createChatGptWebLlmClient`; ngược lại `createLlm`.
- Kết quả lưu cache (`Map<SubagentType, ResolvedSubagentModel>`) bên cạnh `this.resolved` — rebuild khi
  config thay đổi (register có cơ chế rebuild sẵn).

## 6. UI — Settings

Trong Settings screen, tab **Agents** (`src/renderer/src/components/settings/AgentsTab.tsx` — hiện chỉ
có list agent system prompts):

- Thêm section "Sub-agent models" với hint: *"Models used when the main agent dispatches sub-agents
  (research / general / reviewer). Leave empty to inherit the main agent model."*
- Mỗi row: tên role + dropdown provider + dropdown model (đổ từ `settings.providers`, render động
  theo provider — pattern giống `ModelPicker.tsx`).
- Nút "Use main agent model" → xóa cấu hình role đó (về fallback).
- Dữ liệu nằm thẳng trong `MeowSettings.subagentModels` — global, mọi agent pane dùng chung.

## 7. Kiểm thử

- `tests/unit/agent-config.test.ts`: normalize `subagentModels` (hợp lệ / sai provider / sai model /
  rỗng), round-trip `configToSettings`/`settingsToConfig`.
- `tests/unit/agent-task-tool.test.ts` (đã có): `resolveSubagent` trả model — sub dùng đúng
  model/llm riêng; `resolveSubagent` undefined — sub kế thừa main (hành vi cũ, test hiện tại vẫn pass).
- Model stub (`createLlm` fake) — không gọi API thật (quy ước AGENTS.md, xem `tests/unit/agent-loop.test.ts`).
- Renderer: nếu có test settings UI thì bổ sung; nếu không, smoke bằng tay.

## 8. Rủi ro / lưu ý

- **Mất cache khi khác provider**: sub-agent dùng provider/model khác main → context sub không tận
  dụng cache của main. Chấp nhận — sub-agent context nhỏ, ngắn.
- **API key thiếu**: nếu sub dùng provider chưa connect → `resolveAgentConfig` trả `apiKey: null` →
  fallback về main (không crash). Ghi log `[meow]` nếu cần.
- **Không bắt buộc delegate**: feature chỉ đảm bảo *khi sub chạy thì đúng model*; việc có chạy hay
  không thuộc skill system (đã nêu ở mục 1).
