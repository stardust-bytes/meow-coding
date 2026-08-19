# Plan: Sub-agent model theo vai trò (Role-based sub-agent models)

Spec: `docs/superpowers/specs/2026-08-19-subagent-role-models-design.md` (đã duyệt).

## Tổng quan

Cho phép cấu hình **global** (trong settings, mọi agent pane dùng chung) model riêng cho 3 loại
sub-agent `research` | `general` | `reviewer`. Khi cấu hình, sub-agent chạy bằng model + LLM client
riêng (có thể khác provider với main). Chưa cấu hình → kế thừa model/LLM của main (hành vi hiện tại).

Không đụng: external CLI agents, `Command.model`, auto stage-detection.

## File structure

| File | Vai trò trong plan |
|---|---|
| `src/shared/types.ts` | Thêm `SubagentType` + `MeowSettings.subagentModels` (optional) |
| `src/main/agent/config.ts` | `MeowConfig.subagentModels`, normalize + round-trip config↔settings |
| `src/main/agent/tools/task.ts` | `createTaskTool` nhận `resolveSubagent`, sub dùng model/llm riêng |
| `src/main/meow-agent-manager.ts` | Dựng `resolveSubagent` trong `register()`, cache LLM client riêng |
| `src/renderer/src/components/settings/AgentsTab.tsx` | Section "Sub-agent models" UI |
| `src/renderer/src/components/settings/SettingsDialog.tsx` | Truyền `subagentModels` + `providers` xuống AgentsTab |
| `tests/unit/agent-config.test.ts` | Test normalize + round-trip |
| `tests/unit/agent-task-tool.test.ts` | Test `resolveSubagent` (có/không cấu hình) |
| `tests/unit/meow-agent-manager.test.ts` | Test resolver wiring qua manager |

## Quy ước chung

- TDD: viết test trước (đỏ) → code (xanh) → commit.
- Mọi test dùng model stub (`StubLlm`/`createLlm` fake) — **không** gọi API thật (AGENTS.md).
- Commit sau mỗi task; message ngắn gọn theo style repo (`feat:`, `test:`).
- Cuối plan: `npm run typecheck` + `npm test` bắt buộc pass.

---

## Task 1 — Shared types

**File:** `src/shared/types.ts`

Thêm gần `ModelRef` (dòng ~264):

```ts
export type SubagentType = 'research' | 'general' | 'reviewer'

export interface MeowSettings {
  // ...existing fields
  /** Model override per sub-agent role. Missing role -> inherit main agent model. */
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
}
```

**File:** `src/main/agent/tools/task.ts` — thay định nghĩa local bằng import shared (giữ re-export
cho ai đang import từ task.ts):

```ts
import type { ChatMessage, SubagentType, ToolCallData } from '../../../shared/types'
export type { SubagentType } from '../../../shared/types'
```

Xoá dòng `export type SubagentType = 'research' | 'general' | 'reviewer'` (dòng 9).

**Check:** `SubagentType` chỉ được dùng trong task.ts (đã verify bằng grep — không nơi nào khác).

**Verify:** `npm run typecheck`.

**Commit:** `feat(agent): move SubagentType to shared types`

---

## Task 2 — Config layer (TDD)

**Test trước — `tests/unit/agent-config.test.ts`**, thêm describe mới:

```ts
describe('subagentModels', () => {
  const write = (sub: unknown) => {
    writeFileSync(file, JSON.stringify({
      provider: { p1: { apiKey: 'k', models: ['m1', 'm2'] } },
      model: 'p1',
      subagentModels: sub
    }))
    return loadMeowConfig(file)
  }

  it('keeps valid role models', () => {
    const c = write({ research: { provider: 'p1', model: 'm2' } })
    expect(c.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
  })

  it('drops roles whose model is not in provider.models (fallback to main)', () => {
    const c = write({ general: { provider: 'p1', model: 'nope' } })
    expect(c.subagentModels).toBeUndefined()
  })

  it('drops roles whose provider is missing', () => {
    const c = write({ reviewer: { provider: 'ghost', model: 'm1' } })
    expect(c.subagentModels).toBeUndefined()
  })

  it('round-trips through configToSettings/settingsToConfig', () => {
    const loaded = write({ research: { provider: 'p1', model: 'm2' } })
    const s = configToSettings(loaded)
    expect(s.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
    const back = settingsToConfig(s, loaded)
    expect(back.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
  })
})
```

Mẫu trên theo pattern có sẵn trong file: `writeFileSync(file, JSON.stringify(...))` +
`loadMeowConfig(file)` (normalization chạy trong `loadMeowConfig` qua `mergeDefaults`).

**Code — `src/main/agent/config.ts`:**

1. Import thêm từ `'../../shared/types'`: `ModelRef`, `SubagentType`.
2. `MeowConfig` thêm:
```ts
subagentModels?: Partial<Record<SubagentType, ModelRef>>
```
3. Helper (đặt cạnh `normalizeMcp`):
```ts
const SUBAGENT_ROLES: readonly SubagentType[] = ['research', 'general', 'reviewer']

function normalizeSubagentModels(
  raw: Partial<Record<SubagentType, ModelRef>> | undefined,
  providers: Record<string, MeowProviderConfig>
): Partial<Record<SubagentType, ModelRef>> | undefined {
  if (!raw) return undefined
  const out: Partial<Record<SubagentType, ModelRef>> = {}
  for (const type of SUBAGENT_ROLES) {
    const ref = raw[type]
    if (!ref || !ref.provider || !ref.model) continue
    const provider = providers[ref.provider]
    if (!provider || !provider.models.includes(ref.model)) continue
    out[type] = { provider: ref.provider, model: ref.model }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```
4. `mergeDefaults`: `subagentModels: normalizeSubagentModels(raw.subagentModels, providers)`.
5. `configToSettings`: thêm
```ts
...(cfg.subagentModels ? { subagentModels: cfg.subagentModels } : {})
```
6. `settingsToConfig`: sau khi build `providers`, thêm
```ts
...(settings.subagentModels
  ? { subagentModels: normalizeSubagentModels(settings.subagentModels, providers) }
  : {})
```

**Verify:** `npx vitest run tests/unit/agent-config.test.ts`.

**Commit:** `feat(config): subagentModels in meow.json with validation`

---

## Task 3 — Task tool `resolveSubagent` (TDD)

**Test trước — `tests/unit/agent-task-tool.test.ts`**, thêm:

```ts
it('uses a dedicated model/llm when resolveSubagent returns one', async () => {
  const mainLlm = new StubLlm()
  const subLlm = new StubLlm()
  const task = createTaskTool({
    llm: mainLlm,
    model: 'main-model',
    tools: new Map([['read', stubTool('read')]]),
    resolveSubagent: (type) => type === 'research'
      ? { provider: 'p2', model: 'x-model', llm: subLlm }
      : undefined
  })
  const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
  await task.run({ prompt: 'x' }, ctx)
  expect(mainLlm.calls).toHaveLength(0)
  expect(subLlm.calls).toHaveLength(1)
  expect(subLlm.calls[0].model).toBe('x-model')
})

it('falls back to the main model/llm when resolveSubagent is undefined', async () => {
  const llm = new StubLlm()
  const task = createTaskTool({
    llm,
    model: 'main-model',
    tools: new Map([['read', stubTool('read')]]),
    resolveSubagent: () => undefined
  })
  const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
  await task.run({ prompt: 'x' }, ctx)
  expect(llm.calls).toHaveLength(1)
  expect(llm.calls[0].model).toBe('main-model')
})
```

(Lưu ý: `StubLlm.calls[0].model` — `LlmStreamOptions.model` đã có sẵn; `resolveSubagent` type trong
test có thể cần cast `as never` cho option nếu chưa có — xem bước code.)

**Code — `src/main/agent/tools/task.ts`:**

1. Thêm type + option:
```ts
export interface ResolvedSubagentModel {
  provider: string
  model: string
  llm: LlmClient
}

export function createTaskTool(opts: {
  llm: LlmClient
  model: string
  tools: Map<string, ToolDefinition>
  resolveSubagent?: (type: SubagentType) => ResolvedSubagentModel | undefined
  onBackgroundResult?: ...
}): ToolDefinition {
```
2. Trong `runSubagent`, trước `new SessionRunner`:
```ts
const sub = opts.resolveSubagent?.(input.subagent_type)
```
và đổi `model: opts.model` → `model: sub?.model ?? opts.model`, `llm: opts.llm` → `llm: sub?.llm ?? opts.llm`.
3. `resolveSubagent` bọc trong closure có `sessions` (đã có) — không đổi gì khác. Trường hợp
`background=true` cũng đi qua `runSubagent` (đã verify), nên tự động áp dụng.

**Verify:** `npx vitest run tests/unit/agent-task-tool.test.ts` — cả test cũ lẫn mới pass.

**Commit:** `feat(agent): task tool supports per-role model/llm override`

---

## Task 4 — Manager wiring (TDD)

**Test trước — `tests/unit/meow-agent-manager.test.ts`.**

Xem helper `makeManager` hiện có (đã stub `createLlm`/`chatGptWeb`). Thêm test: config `meow.json`
có `subagentModels: { research: { provider: 'p1', model: 'm2' } }`; stub `createLlm` trả về
`StubLlm` ghi lại `(provider, model)`; sau khi `register`, gọi `sendUserMessage` yêu cầu agent dùng
`task` tool với `subagent_type: 'research'`; assert LLM client được tạo với model `m2` và được dùng.
(Nếu test qua full loop quá nặng: expose `resolveSubagent` qua dependency injection hoặc test gián
tiếp — xem lưu ý dưới. Tối thiểu: assert `register()` không crash khi có `subagentModels` và model
sai → fallback main.)

> Nếu loop test quá phức tạp với stub hiện có, chấp nhận **test gián tiếp**: tạo manager với
> config có `subagentModels`, `register()` agent, và assert qua `createLlm` spy rằng subagent
> resolver được gọi. Nếu vẫn khó, giữ test ở mức: config sai → fallback không crash + task tool
> đã được test ở Task 3. Ghi rõ điều này trong PR.

**Code — `src/main/meow-agent-manager.ts`:**

1. Import `ResolvedSubagentModel` từ task tool.
2. Thêm field `private subagentLlm = new Map<string, ResolvedSubagentModel>()` (key `agentId:role`) —
   hoặc cache theo agent trong `register()` closure (đơn giản hơn, không cần field mới).
3. Trong `register()` (dòng ~751, nơi đã có `cfg`, `resolved`, `llmClient`), dựng resolver:
```ts
const resolveSubagent = (type: SubagentType): ResolvedSubagentModel | undefined => {
  const ref = cfg.subagentModels?.[type]
  if (!ref) return undefined
  const subResolved = resolveAgentConfig(cfg, agent.name, this.deps.env, `${ref.provider}/${ref.model}`)
  if (!subResolved.provider || !subResolved.model || !subResolved.apiKey) return undefined // fallback main
  const subLlm = subResolved.provider === CHATGPT_WEB_PROVIDER_ID
    ? (this.deps.createChatGptWebLlmClient ?? defaultCreateChatGptWebLlmClient)(this.deps.chatGptWeb as ChatGptWebManager)
    : (this.deps.createLlm ?? createLlm)(subResolved.provider, subResolved.apiKey, subResolved.baseUrl)
  return { provider: subResolved.provider, model: subResolved.model, llm: subLlm }
}
```
Import `SubagentType` từ shared.
4. Truyền vào `createTaskTool({ ..., resolveSubagent })`.
5. `reload()` đã gọi lại `register()` cho từng agent → resolver rebuild theo config mới (không cần
   xử lý thêm).

**Verify:** `npx vitest run tests/unit/meow-agent-manager.test.ts` + toàn bộ `npm test`.

**Commit:** `feat(agent): wire per-role subagent models into task tool`

---

## Task 5 — Renderer UI

**File:** `src/renderer/src/components/settings/SettingsDialog.tsx`

- Đổi dòng `<AgentsTab agents={draft.agents} onChange={...} />` thành truyền thêm:
```tsx
<AgentsTab
  agents={draft.agents}
  providers={draft.providers}
  subagentModels={draft.subagentModels}
  onChangeAgents={agents => patch({ agents })}
  onChangeSubagentModels={subagentModels => patch({ subagentModels })}
/>
```
(Đổi prop `onChange` → `onChangeAgents` để tránh nhầm lẫn — cập nhật cả component con.)

**File:** `src/renderer/src/components/settings/AgentsTab.tsx`

- `Props` thêm: `providers: MeowSettings['providers']`, `subagentModels?: Partial<Record<SubagentType, ModelRef>>`,
  `onChangeSubagentModels`.
- Thêm section sau list agents (trước phần add):
```tsx
<div className="settings-section">
  <p className="settings-hint">
    Models used when the main agent dispatches sub-agents. Leave a role empty to
    inherit the main agent model.
  </p>
  {(SUBMODEL_ROLES as const).map(role => (
    <div className="settings-row agents-row" key={role}>
      <div className="agents-row-head">
        <span className="agent-name">{role}</span>
        <button className="btn small" onClick={() => setRole(role, undefined)}>
          Use main agent model
        </button>
      </div>
      <div className="submodel-fields">
        <select
          className="input"
          value={subagentModels?.[role]?.provider ?? ''}
          onChange={e => setRole(role, { provider: e.target.value, model: '' })}
        >
          <option value="">(inherit main agent model)</option>
          {providers.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        {subagentModels?.[role]?.provider && (
          <select
            className="input"
            value={subagentModels?.[role]?.model ?? ''}
            onChange={e => setRole(role, { provider: subagentModels![role]!.provider, model: e.target.value })}
          >
            {providers.find(p => p.id === subagentModels?.[role]?.provider)?.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  ))}
</div>
```
- Helper:
```ts
const SUBMODEL_ROLES = ['research', 'general', 'reviewer']
const setRole = (role: SubagentType, ref: ModelRef | undefined) => {
  const next = { ...(subagentModels ?? {}) }
  if (ref) next[role] = ref
  else delete next[role]
  onChangeSubagentModels(Object.keys(next).length > 0 ? next : undefined)
}
```

**CSS — `src/renderer/src/styles.css`:** thêm `.submodel-fields { display: flex; gap: 8px; }`
(cạnh `.agents-row` style hiện có).

**Verify:** `npm run typecheck`; chạy app (`npm run dev`) mở Settings → Agents, chọn model cho 1 role,
lưu, mở lại — giá trị còn nguyên; "Use main agent model" xoá được.

**Commit:** `feat(settings): sub-agent model pickers in Agents tab`

---

## Task 6 — Final verification

- `npm run typecheck` pass.
- `npm test` pass (đặc biệt: agent-config, agent-task-tool, meow-agent-manager).
- Kiểm tra `src/shared/AGENTS.md` không vi phạm: chỉ JSON-serializable trong shared (đúng —
  `SubagentType`/`ModelRef` đều plain type).
- IPC contract: `MeowSettings` optional field — không phá test `ipc-contract`.
- Không ảnh hưởng e2e (không đổi luồng spawn/PTY), nên không bắt buộc `npm run e2e`; nếu muốn chắc:
  `npm run build && npm run e2e`.

## Rủi ro đã biết

- **Model chưa sync trong `provider.models`** → bị drop khi normalize → fallback main. Hành vi có
  chủ đích (spec mục 4.3), document trong hint UI.
- **Sub dùng provider khác main** → context sub không tận dụng cache main. Chấp nhận (spec mục 8).
- **ChatGPT Web provider** cho sub: resolver dùng `loadConfigWithChatGptWebSeed` (register đã dùng
  config này) + `createChatGptWebLlmClient` — hoạt động, nhưng user hiếm khi cấu hình sub-model là
  chatgpt-web; nếu không cần thì để tự nhiên.
