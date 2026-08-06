# Meow Coding — Dynamic Model Variant (per-model reasoning effort): Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Variant / reasoning-effort hiện được hardcode `medium | high | max` ở 7 chỗ (type, IPC, preload, main,
renderer) — picker `<select>` trong chat panel luôn show cùng 3 option bất kể user chọn provider/model
nào. Khi đổi sang Gemini (values `[none, low, medium, high, max]`) hay GPT-5 (`[low, medium, high, xhigh]`)
thì picker vẫn chỉ hiện 3 giá trị cũ, sai về phạm vi.

Mục tiêu: làm cho danh sách variant hiển thị trong picker **theo model**, lấy từ metadata của
`https://models.dev/api.json` (đã fetch sẵn nhưng đang bị drop hết field ngoài `name/api/limit`). Mỗi model
sẽ tự mang theo `variants: string[]` (effort values), picker render động theo model hiện tại. Wire-format
mapping mở rộng thêm Google (`thinkingLevel`) ngoài Anthropic (budgetTokens) và OpenAI-compatible
(`reasoningEffort`).

Tham chiếu: opencode `packages/opencode/src/provider/transform.ts:1648-1777`
(`reasoningVariants` / `reasoningEffort` / `anthropicEffort` / provider switch theo `model.api.npm`).

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Approach | **Hybrid** (Approach C): đổi `ModelVariant` thành `string`, lưu `variants: string[]` per model; picker render động |
| Scope variant types | **Chỉ `effort` strings** — không support Anthropic `budget_tokens` numeric / `toggle` trong PR này |
| Data source | **Live fetch + snapshot fallback**: extract `reasoning_options` từ `https://models.dev/api.json`, regenerate `src/main/models-snapshot.json` |
| Khi `variants` rỗng | **Hide picker hoàn toàn** (giống opencode `dialog-variant.tsx`) |
| Khi đổi model, variant không hợp lệ | **Reset về `undefined`** (= "Default", không gửi reasoning field lên wire) |
| Wire-format providers | Giữ 2 nhánh hiện tại (Anthropic + OpenAI-compatible) + **thêm Google** (`thinkingLevel`) |
| Anthropic ngoài budget map | Không gửi `thinking` field (giống cách "Default" hoạt động) |
| Migration data cũ | Không cần: `variant: 'medium' \| 'high' \| 'max'` cũ vẫn là string hợp lệ |
| UI picker shape | Giữ native HTML `<select>`; prepend option **"Default"** (value rỗng) |
| Catalog model shape | Đổi `models: string[]` thành `models: Record<string, CatalogModel>` để mang metadata |
| Regen automation | Thêm `npm run regen:models` (tsx script); không bắt buộc trong CI |

## 3. Phạm vi

**Có:**
- Parse `reasoning_options` từ models.dev, filter `type === 'effort'`, lưu `variants: string[]` per model.
- Regenerate `src/main/models-snapshot.json` với field mới (~700-900KB).
- Dynamic `<select>` trong `ChatPanel.tsx` render theo `availableVariants`; ẩn khi rỗng.
- `AgentConfig.variant: string` (thay vì union cứng); `setAgentVariant(agentId, variant: string | null)`.
- `getAgentVariants(agentId): Promise<string[]>` — IPC mới.
- Wire-format `providerOptionsFor(provider, model, variant)` thêm branch Google.
- Validation khi đổi model: nếu `currentVariant` không nằm trong list mới → reset `undefined`.
- Tests: `models-catalog.test.ts` (mới), mở rộng `llm-variant.test.ts` (Google + Anthropic out-of-map),
  `meow-agent-manager.test.ts` (clamp on register), `ipc-contract.test.ts` (channel mới).

**Không làm:**
- Anthropic `budget_tokens` numeric / `thinking: { type: 'adaptive' }` (để PR sau).
- Bedrock, Vertex, Groq, xAI specific mapping (dùng nhánh openai-compatible fallback).
- Plugin layer cho model variants (opencode có `VariantPlugin` — không cần ở đây).
- `toggle` reasoning (on/off binary) — chưa thấy model nào dùng.

## 4. Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│  Main process                                                │
│  ┌──────────────────────┐    ┌────────────────────────────┐ │
│  │ ModelsCatalog         │    │ MeowAgentManager           │ │
│  │  ├─ fetch(api.json)   │    │  ├─ register(agent)        │ │
│  │  ├─ mapProviders()    │    │  │  validate variant       │ │
│  │  │   filter reasoning │    │  │  against getVariants()  │ │
│  │  │   .effort.values   │    │  └─ setVariant(id, v|null) │ │
│  │  └─ getVariants(p, m) │◄───┤                            │ │
│  └──────────┬───────────┘    └────────────┬───────────────┘ │
│             │                              │                  │
│             │  IPC: AgentGetVariants       │ variant pass     │
│             │  IPC: AgentSetVariant(null|  │                  │
│             │           string)            │                  │
│  ┌──────────▼──────────────────────────────▼───────────────┐ │
│  │ src/main/agent/llm.ts                                    │ │
│  │  providerOptionsFor(provider, model, variant)            │ │
│  │   ├─ anthropic + variant in budget map → thinking.budget │ │
│  │   ├─ anthropic + variant ngoài map → undefined           │ │
│  │   ├─ google       → thinkingConfig.thinkingLevel         │ │
│  │   └─ else          → openaiCompatible.reasoningEffort    │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Renderer (ChatPanel.tsx)                                    │
│  useEffect: window.api.getAgentVariants(agentId)             │
│   ├─ [] → ẩn picker                                         │
│   └─ [...] → <select> với "Default" + variants              │
│  onChange:                                                  │
│   ├─ ''  → window.api.setAgentVariant(id, null)              │
│   └─ v   → window.api.setAgentVariant(id, v)                 │
│  on model change: refetch + reset invalid currentVariant    │
└─────────────────────────────────────────────────────────────┘
```

## 5. Data model (shared)

### `src/shared/types.ts`

```ts
export type ModelVariant = string   // branded; runtime validate

export interface AgentConfig {
  ...
  variant?: string                  // không còn union cứng
  ...
}
```

### `src/main/models-catalog.ts`

`models: string[]` GIỮ NGUYÊN (đang được dùng ở `connectProvider`, `fetchProviderModels`,
`refreshModelLimits`, `ProvidersTab`, tests, ...). Thêm field song song `variants`:

```ts
export interface CatalogProvider {
  name: string
  api?: string
  models: string[]                              // không đổi
  limits?: Record<string, ModelLimit>           // không đổi
  variants?: Record<string, string[]>           // mới: modelId → effort values
}
```

### `src/shared/ipc.ts`

```ts
Channels.AgentGetVariants = 'agent:get-variants'
Channels.AgentSetVariant  = 'agent:set-variant'  // signature đổi

interface AgentApi {
  ...
  getAgentVariants(agentId: string): Promise<string[]>
  setAgentVariant(agentId: string, variant: string | null): Promise<void>
}
```

## 6. Catalog parser

```ts
function reasoningEffortValues(model: any): string[] | undefined {
  const opts = model.reasoning_options
  if (!Array.isArray(opts)) return undefined
  const effort = opts.find((o: any) => o?.type === 'effort')
  if (!effort || !Array.isArray(effort.values)) return undefined
  return effort.values.map(String)
}

function modelVariants(p: any): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  let found = false
  for (const [modelId, model] of Object.entries(p.models ?? {})) {
    const values = reasoningEffortValues(model)
    if (values) { out[modelId] = values; found = true }
  }
  return found ? out : undefined
}

function mapProviders(json: any): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {}
  for (const [id, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    providers[id] = {
      name: p.name ?? id,
      api: p.api,
      models: Object.keys(p.models ?? {}),
      limits: modelLimits(p.models),
      variants: modelVariants(p)
    }
  }
  return providers
}
```

`models.dev/api.json` reference cho Gemini 2.5 Pro:
```json
"google/gemini-2.5-pro": {
  "reasoning": true,
  "reasoning_options": [
    { "type": "effort", "values": ["none", "low", "medium", "high", "max"] }
  ],
  ...
}
```

## 7. Wire-format mapping

```ts
type AnthropicVariant = 'medium' | 'high' | 'max'

const ANTHROPIC_THINKING_BUDGET: Record<AnthropicVariant, number> = {
  medium: 8192, high: 16384, max: 32000,
}

function providerOptionsFor(
  provider: string,
  modelId: string,
  variant: string | undefined,
): StreamProviderOptions | undefined {
  if (!variant) return undefined
  if (provider === 'anthropic') {
    const budget = (ANTHROPIC_THINKING_BUDGET as Record<string, number>)[variant]
    if (!budget) return undefined    // variant ngoài map → không gửi thinking
    return { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
  }
  if (provider === 'google') {
    return { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: variant } } }
  }
  return { openaiCompatible: { reasoningEffort: variant } }
}
```

## 8. Renderer (ChatPanel.tsx)

```tsx
const [availableVariants, setAvailableVariants] = useState<string[]>([])
const [currentVariant, setCurrentVariant] = useState<string>(variant ?? '')

const refreshVariants = useCallback(() => {
  void window.api.getAgentVariants(agentId).then(list => {
    setAvailableVariants(list)
    if (currentVariant && !list.includes(currentVariant)) {
      setCurrentVariant('')
      onVariantChange?.(undefined)
    }
  })
}, [agentId, currentVariant, onVariantChange])

useEffect(() => { refreshVariants() }, [refreshVariants])
// ModelPicker post-IPC → fire event 'meow:model-changed' → refreshVariants() ở đây

{availableVariants.length > 0 && (
  <select
    className="input chat-variant-select"
    value={currentVariant}
    aria-label="model effort"
    onChange={e => {
      const v = e.target.value
      setCurrentVariant(v)
      onVariantChange?.(v === '' ? undefined : v)
    }}
  >
    <option value="">Default</option>
    {availableVariants.map(v => <option key={v} value={v}>{v}</option>)}
  </select>
)}
```

`ModelPicker.tsx` — sau khi `setAgentModel` thành công:
```tsx
window.dispatchEvent(new CustomEvent('meow:model-changed', { detail: { agentId } }))
```

## 9. Validation khi đổi model

Hai lớp clamp đảm bảo `workspaces.json` không bao giờ giữ variant ngoài `allowed` của model hiện tại.

**Lớp 1 — `MeowAgentManager.setVariant()` (`src/main/meow-agent-manager.ts:313-324`)**: clamp trước khi set
in-memory, trước khi runner rebuild:

```ts
setVariant(agentId: string, variant: string | undefined): void {
  const agent = this.agents.get(agentId)
  if (!agent) return
  const allowed = this.allowedVariantsFor(agent)
  const valid = variant && allowed.includes(variant) ? variant : undefined
  agent.variant = valid
  this.agents.set(agentId, agent)
  if (!this.running.has(agentId)) {
    this.runners.delete(agentId)
    this.resolved.delete(agentId)
    this.register(agent)
  }
}

private allowedVariantsFor(agent: AgentConfig): string[] {
  if (!this.deps.catalog) return []
  const cfg = loadMeowConfig(this.deps.configPath)
  const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
  if (!resolved.provider || !resolved.model) return []
  return this.deps.catalog.getVariants(resolved.provider, resolved.model)
}
```

**Lớp 2 — `MainApp.setAgentVariant()` (`src/main/index.ts:240-246`)**: persist theo giá trị đã được
clamp trong lớp 1. Vì `meowAgent.setVariant` đã mutate `agent.variant` thành `valid` rồi, MainApp đọc lại:

```ts
setAgentVariant(agentId: string, variant: string | null): void {
  this.meowAgent.setVariant(agentId, variant ?? undefined)
  const ws = this.findWorkspaceByAgent(agentId)
  const stored = this.meowAgent.getVariant(agentId)  // getter mới: trả về agent.variant sau clamp
  if (ws) {
    this.workspaces.updateAgent(ws.projectPath, agentId, { variant: stored })
  }
}
```

Getter `MeowAgentManager.getVariant(agentId)` trả về `agent.variant` hiện tại (đã qua clamp).

**Lớp 3 — `MeowAgentManager.register()` (`src/main/meow-manager.ts:509-581`)**: defense-in-depth, cover
case variant trên disk không hợp lệ vì model đã đổi từ nơi khác:

```ts
const allowed = this.allowedVariantsFor(agent)
const validVariant = agent.variant && allowed.includes(agent.variant) ? agent.variant : undefined
if (validVariant !== agent.variant) {
  agent.variant = validVariant
  this.agents.set(agent.id, agent)
}
const runner = new SessionRunner({ ..., variant: validVariant })
```

Ba lớp này đảm bảo: (1) clamp ngay tại input, (2) persist đúng giá trị đã clamp, (3) runner luôn nhận variant
hợp lệ ngay cả khi data trên disk stale.

## 10. Snapshot regen script

`scripts/regen-models-snapshot.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const URL = 'https://models.dev/api.json'
const OUT = resolve(__dirname, '../src/main/models-snapshot.json')

async function main() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()

  const out: Record<string, unknown> = {}
  for (const [pid, p] of Object.entries(json as Record<string, any>)) {
    const prov = p as any
    const models = Object.keys(prov.models ?? {})
    const variants: Record<string, string[]> = {}
    for (const [mid, m] of Object.entries(prov.models ?? {})) {
      const values = (m as any).reasoning_options
        ?.filter((o: any) => o?.type === 'effort' && Array.isArray(o.values))
        ?.flatMap((o: any) => o.values.map(String))
      if (values?.length) variants[mid] = values
    }
    out[pid] = {
      name: prov.name ?? pid,
      ...(prov.api ? { api: prov.api } : {}),
      models,
      ...(Object.keys(variants).length ? { variants } : {})
    }
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`Wrote ${OUT} (${Object.keys(out).length} providers)`)
}

main().catch(err => { console.error(err); process.exit(1) })
```

`package.json`:
```json
"regen:models": "tsx scripts/regen-models-snapshot.ts"
```

## 11. Tests

| File | Test mới |
|---|---|
| `tests/unit/models-catalog.test.ts` (mới) | `mapProviders` extract `effort.values` đúng; bỏ `toggle`/`budget_tokens`; bỏ qua model không có `reasoning_options` |
| `tests/unit/llm-variant.test.ts` (mở rộng) | Google → `thinkingLevel`; Anthropic variant ngoài map → không gửi `thinking`; OpenAI-compatible giữ nguyên case cũ |
| `tests/unit/meow-agent-manager.test.ts` (mở rộng) | `setVariant(id, 'newvalue')` clamp trong `register()` khi model không support |
| `tests/unit/ipc-contract.test.ts` (mở rộng) | Thêm `getAgentVariants` + `'agent:get-variants'` vào required methods + stub |

## 12. Files thay đổi

| File | Loại |
|---|---|
| `src/shared/types.ts` | sửa |
| `src/shared/ipc.ts` | sửa |
| `src/preload/index.ts` | sửa |
| `src/main/index.ts` | sửa |
| `src/main/meow-agent-manager.ts` | sửa |
| `src/main/agent/llm.ts` | sửa |
| `src/main/agent/loop.ts` | sửa |
| `src/main/agent/config.ts` | không đổi (`ResolvedAgentConfig.model` đã có) |
| `src/main/models-catalog.ts` | sửa (parser + public API `getVariants`) |
| `src/main/models-snapshot.json` | regen |
| `src/renderer/src/components/chat/ChatPanel.tsx` | sửa |
| `src/renderer/src/components/chat/ModelPicker.tsx` | sửa |
| `src/renderer/src/components/Pane.tsx` | sửa (signature) |
| `scripts/regen-models-snapshot.ts` | thêm mới |
| `package.json` | sửa (script `regen:models`) |
| `tests/unit/models-catalog.test.ts` | thêm mới |
| `tests/unit/llm-variant.test.ts` | sửa |
| `tests/unit/meow-agent-manager.test.ts` | sửa |
| `tests/unit/ipc-contract.test.ts` | sửa |

## 13. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Live fetch `models.dev` lỗi / timeout | Dùng snapshot bundle (đã có field `variants`) |
| Snapshot bundle cũ (chưa regen) | `variants` undefined → picker ẩn cho mọi model — graceful |
| User config provider trong `meow.json` không có trong catalog | `getVariants` trả `[]` → picker ẩn |
| User chọn variant rồi đổi sang model không support | `register()` clamp; persist lại `undefined` vào `workspaces.json` |
| User đổi variant sang value ngoài `availableVariants` (qua dev tools) | `setVariant` accept mọi string; `register()` clamp khi next turn |
| Google model không có `thinkingLevel` field hợp lệ | Provider gửi raw value; LLM provider sẽ reject nếu invalid (error surface qua `chat:event error`) |

## 14. Tiêu chí thành công

- [ ] `npm run typecheck` pass.
- [ ] `npm test` pass (bao gồm tests mới).
- [ ] Picker ẩn khi mở agent Gemini chưa có snapshot regen (offline).
- [ ] Picker hiện `[none, low, medium, high, max]` cho Gemini 2.5 Pro sau khi regen.
- [ ] Picker hiện `[low, medium, high, xhigh]` cho GPT-5 sau khi regen.
- [ ] Đổi Gemini → GPT-5: variant cũ (vd `max`) tự reset về Default.
- [ ] Wire-format test xác nhận Google → `thinkingLevel`; Anthropic ngoài map → không gửi `thinking`.
- [ ] `npm run regen:models` chạy thành công, snapshot bundle tăng ~100-300KB.
