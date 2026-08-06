# Meow Coding — Port OpenCode Variant Special-Cases (variants()): Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Variant picker hiện chỉ sinh variants từ `reasoning_options` (`type === 'effort'`) trong catalog
(`reasoningEffortValues`). Opencode có **2 nguồn** sinh variants:

1. `reasoningVariants(model)` — từ `reasoning_options` (effort/toggle/budget). Meow đã có.
2. `variants(model)` — hardcoded special-case theo `model.id` + `provider.npm`
   (`packages/opencode/src/provider/transform.ts:721-1149`). **Meow thiếu.**

Kết quả: minimax (MiniMax-M3, `reasoning_options: [{type:"toggle"}]`, npm=`@ai-sdk/anthropic`) không
hiện variant nào trong meow, trong khi opencode hiện `none`/`thinking`. deepseek-v4-flash (npm=
`@ai-sdk/openai-compatible`) hiện `[low,medium,high,max]` trong opencode nhưng meow chỉ ra
`[low,high,max]` (thiếu `medium`).

Mục tiêu: port hàm `variants()` của opencode thành module TS thuần `src/main/model-variants.ts`, thay
thế cơ chế `providerOptionsFor(provider, variant)` string-switch bằng **variant descriptor lookup**:
mỗi variant là một `StreamProviderOptions` pre-built (đã namespace theo npm), `llm.stream` merge thẳng
vào `streamText({ providerOptions })`.

Tham chiếu: opencode `packages/opencode/src/provider/transform.ts:721-1149` (`variants`),
`:568-592` (effort constants), `:622-648` (openaiReasoningEfforts), `:703-719` (googleThinkingVariants),
`:660-695` (anthropic helpers), `provider.ts:1212-1263` (fromModelsDevModel merge).

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cách port | **Approach A — Variant descriptor**: lưu `variants: Record<modelId, Record<variantId, StreamProviderOptions>>` pre-built; `llm.stream` lookup thay vì string-switch |
| Nguồn dữ liệu | Live `models.dev/api.json` + snapshot; merge `reasoningVariants ?? variants` tại parse time |
| Wire-format | Bỏ `providerOptionsFor` + `ANTHROPIC_THINKING_BUDGET`; thay bằng descriptor lookup |
| npm routing | Descriptor namespace theo `provider.npm` (`@ai-sdk/anthropic` → `{anthropic:...}`, `@ai-sdk/google` → `{google:...}`, else `{openaiCompatible:...}`) |
| npm routing trong `createLlm` | Route theo provider **string** hiện tại (anthropic/google/else) — giữ nguyên; descriptor body khớp cùng namespace |
| Snapshot | Đổi sang lưu **raw fields** (reasoning, release_date, limit.output, reasoning_options) + provider `npm` để `mapProviders` tính variants từ 1 nguồn TS duy nhất |
| AgentConfig.variant | Giữ `string` (variant id); runtime lookup body từ catalog |
| Default (undefined) | Không gửi `providerOptions` (giống hiện tại) |
| Fallback khi không có variants | Picker ẩn (giữ nguyên quyết định trước) |

## 3. Phạm vi

**Có:**
- Module `src/main/model-variants.ts`: port `variants()` + helpers của opencode, output `Record<variantId, StreamProviderOptions>`.
- Catalog: lưu `variants` descriptor per model (pre-built từ `reasoningVariants ?? variants`).
- Snapshot: lưu raw fields; `mapProviders` tính descriptor tại parse time.
- `llm.ts`: bỏ `providerOptionsFor`; `LlmStreamOptions` nhận `variantOptions?: StreamProviderOptions`; merge thẳng.
- `loop.ts` / `meow-agent-manager.ts`: pass descriptor qua `variantOptions`.
- Picker / `getAvailableVariants`: `Object.keys(descriptors)`.
- Tests: unit cho `model-variants.ts` (minimax-m3, deepseek-v4, gpt-5.x, anthropic, google), mở rộng `llm-variant.test.ts`, `models-catalog.test.ts`, `meow-agent-manager.test.ts`.

**Không làm:**
- Bedrock / Vertex / SAP / Copilot-specific providers (không có trong catalog meow dùng; fallback openai-compatible).
- Port `options()` / request-body merging của opencode (meow dùng AI SDK providerOptions, không raw body).
- Plugin layer cho variants.
- Đổi provider routing trong `createLlm` sang npm-based (giữ provider string).

## 4. Kiến trúc

```
models.dev/api.json ─┐
models-snapshot.json ┴─► ModelsCatalog.fetch() ──► mapProviders()
                                                       │
                                   computeVariants(modelInfo)   ← module mới (port variants())
                                                       ▼
        CatalogProvider.variants = { modelId: { variantId: StreamProviderOptions } }
                                                       │
   getAvailableVariants → string[] (picker)     getVariantOptions → StreamProviderOptions (wire)
                                                       │
                              llm.stream({ variantOptions }) ──► streamText({ providerOptions })
```

**Snapshot shape (đổi):** snapshot lưu **raw-shaped** (giống live JSON, chỉ giữ field cần thiết):
per-provider `{ name, api, npm, models: { modelId: { reasoning, release_date, limit, reasoning_options } } }`.
`fetch()` merge raw (`{ ...SNAPSHOT_RAW, ...live }`) rồi gọi `mapProviders` — 1 nguồn chuyển đổi duy nhất
cho cả live lẫn snapshot. Không còn pre-built variants trong snapshot (tránh duplicate logic giữa script
và TS).

### Mô hình dữ liệu

`src/main/model-variants.ts`:

```ts
export interface ModelVariantInfo {
  id: string          // model id
  providerId: string  // provider key (e.g. 'deepseek', 'minimax')
  npm: string         // provider.npm (e.g. '@ai-sdk/anthropic')
  reasoning: boolean
  releaseDate: string
  limitOutput?: number
  reasoningOptions: Array<{ type: string; values?: unknown[]; min?: number; max?: number }>
}

export type VariantDescriptor = Record<string, StreamProviderOptions>
export function computeVariants(info: ModelVariantInfo): VariantDescriptor | undefined
```

Logic: `computeVariants = reasoningVariants(info) ?? variants(info)` (giống opencode provider.ts:1257).

### Catalog shape

`models-catalog.ts`:

```ts
export interface CatalogProvider {
  name: string
  api?: string
  npm?: string          // mới: provider.npm
  models: string[]
  limits?: Record<string, ModelLimit>
  variants?: Record<string, Record<string, StreamProviderOptions>>  // đổi từ string[]
}
```

### `llm.ts` — descriptor lookup

```ts
export interface LlmStreamOptions {
  ...
  variantOptions?: StreamProviderOptions   // mới: pre-built, merge thẳng
}
```

Bỏ `providerOptionsFor` + `ANTHROPIC_THINKING_BUDGET`. `stream`:

```ts
...(opts.variantOptions ? { providerOptions: opts.variantOptions } : {})
```

### Manager flow

- `register()`: `variantOptions = validVariant ? catalog.getVariantOptions(provider, model, validVariant) : undefined`.
- `LoopDeps.variantOptions` → `llm.stream({ variantOptions })`.
- `allowedVariantsFor` trả `Object.keys(catalog.variants[modelId] ?? {})`.

## 5. Port các nhánh của `variants()` (transform.ts:721-1149)

Chỉ port các nhánh khớp npm có trong catalog meow (`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider`, `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/xai`, `@ai-sdk/cerebras`, `@ai-sdk/togetherai`, `@ai-sdk/deepinfra`, `@ai-sdk/cohere`, `@ai-sdk/azure`, `@ai-sdk/openai`). Các npm không support → `{}`.

### 5a. Special-cases theo model id (line 728-799)

| Điều kiện | Output |
|---|---|
| `minimax-m3` + npm ∈ {anthropic, openai-compatible} | `none: {thinking:{type:'disabled'}}`, `thinking: {thinking:{type:'adaptive'}}` |
| `glm-5.2` + npm openrouter | `high/xhigh: {reasoning:{effort}}` |
| `glm-5.2` + npm openai-compatible | `high/max: {reasoningEffort}` |
| `glm-5.2` + npm anthropic | `high/max: {effort}` |
| kimi family + npm anthropic | `[low,medium,high,xhigh,max]` → `{thinking:{type:'adaptive',display:'summarized'},effort}` |
| `deepseek-chat/reasoner/r1/v3`, `minimax` (non-m3), `glm` (non-5.2), `kimi`, `k2p`, `qwen`, `big-pickle` | `{}` |
| `grok-3-mini` | `[low,high]` (openrouter → `{reasoning:{effort}}`, else `{reasoningEffort}`) |

### 5b. Switch theo npm (line 801-1147)

| npm | Output |
|---|---|
| `@openrouter/ai-sdk-provider` | openai-family → `openaiCompatibleReasoningEfforts(id)`, else `WIDELY_SUPPORTED_EFFORTS` → `{reasoning:{effort}}` |
| `@ai-sdk/openai` / `@ai-sdk/azure` | `openaiReasoningEfforts(id, releaseDate)` → `{reasoningEffort, reasoningSummary:'auto', include:['reasoning.encrypted_content']}` |
| `@ai-sdk/anthropic` / `@ai-sdk/google-vertex/anthropic` | adaptive → `[low..max]`/`[low..high..max]` với `{thinking:{type:'adaptive'},effort}`; opus-4.5 → `WIDELY_SUPPORTED_EFFORTS` + `anthropicOpus45Effort`; fallback → `high/max` budgetTokens |
| `@ai-sdk/google` / `@ai-sdk/google-vertex` | `googleThinkingVariants` |
| `@ai-sdk/mistral` | reasoning ids → `{high: {reasoningEffort:'high'}}` |
| `@ai-sdk/cohere` / `@ai-sdk/perplexity` | `{}` |
| `@ai-sdk/groq` | `[none,low,medium,high]` → `{reasoningEffort}` |
| `@ai-sdk/cerebras` / `@ai-sdk/togetherai` / `@ai-sdk/xai` / `@ai-sdk/deepinfra` / `@ai-sdk/openai-compatible` | `[low,medium,high]` (+`max` nếu id chứa `deepseek-v4`) → `{reasoningEffort}` |
| `@ai-sdk/amazon-bedrock` / `@ai-sdk/gateway` / copilot / sap | **không port** (ngoài phạm vi) → `{}` |

### 5c. Hằng số + helper (line 568-648, 660-719)

```ts
const WIDELY_SUPPORTED_EFFORTS = ['low', 'medium', 'high']
const OPENAI_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const OPENAI_GPT5_1_EFFORTS = ['none', 'low', 'medium', 'high']
const OPENAI_GPT5_2_PLUS_EFFORTS = [...OPENAI_GPT5_1_EFFORTS, 'xhigh']
const OPENAI_GPT5_PRO_EFFORTS = ['high']
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS = ['medium', 'high', 'xhigh']
const OPENAI_GPT5_CHAT_EFFORTS = ['medium']
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, 'xhigh']
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS = ['none', ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS]
const OPENAI_NONE_EFFORT_RELEASE_DATE = '2025-11-13'
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = '2025-12-04'
const INCLUDE_ENCRYPTED_REASONING = ['reasoning.encrypted_content']

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/
```

Helpers: `gpt5Version`, `versionedGpt5ReasoningEfforts`, `gpt5ProReasoningEfforts`,
`gpt5CodexReasoningEfforts`, `gpt5ChatReasoningEfforts`, `openaiReasoningEfforts`,
`openaiCompatibleReasoningEfforts`, `anthropicUsesModernAdaptiveThinking`,
`anthropicAdaptiveEfforts`, `anthropicOmitsThinking`, `anthropicOpus45`,
`anthropicOpus45Effort`, `googleThinkingLevelEfforts`, `googleThinkingBudgetMax`,
`googleThinkingVariants`, `isKimiFamily`.

### 5d. `reasoningVariants` port (transform.ts:1648-1697)

```ts
function reasoningVariants(info): VariantDescriptor | undefined {
  const opts = info.reasoningOptions
  if (opts === undefined) return undefined
  if (opts.length === 0) return {}
  const effort = opts.find(o => o.type === 'effort')
  if (effort) return effortVariants(info, effort.values ?? [])
  const toggle = opts.some(o => o.type === 'toggle')
  const budget = opts.find(o => o.type === 'budget_tokens')
  if (!budget) return toggle ? nonEmpty(reasoningToggle(info)) : undefined
  return nonEmpty({ ...(toggle ? reasoningToggle(info) : {}), ...budgetVariants(info, budget.min, budget.max) })
}
```

`reasoningEffort` / `reasoningToggle` / `reasoningBudget` output đổi thành **namespaced providerOptions**
(`{anthropic:...}`, `{openaiCompatible:...}`, `{google:...}`).

## 6. Wire-format / descriptor body

Mỗi variant descriptor là `StreamProviderOptions` đã namespace theo npm:

```ts
// anthropic npm
{ anthropic: { thinking: { type: 'enabled', budgetTokens: 16000 }, effort: 'high' } }
{ anthropic: { thinking: { type: 'disabled' } } }          // minimax-m3 none
{ anthropic: { thinking: { type: 'adaptive' } } }           // minimax-m3 thinking
// google npm
{ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } } }
{ google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } } }
// openai-compatible npm
{ openaiCompatible: { reasoningEffort: 'high' } }
// openrouter npm
{ openaiCompatible: { reasoning: { effort: 'high' } } }     // body mang raw reasoning
```

Lưu ý: meow dùng AI SDK providerOptions, không phải raw request body như opencode. Các variant `body`
của opencode (`{thinking:...}`, `{reasoningEffort:...}`, `{reasoning:{effort}}`) được bọc namespace
providerOptions phù hợp: `@ai-sdk/anthropic` → `{anthropic: body}`, `@ai-sdk/google` → `{google: body}`,
`@ai-sdk/openai-compatible`/`@ai-sdk/groq`/`@ai-sdk/mistral`/`@ai-sdk/xai`/etc → `{openaiCompatible: body}`,
`@openrouter/ai-sdk-provider` → `{openaiCompatible: body}`.

## 7. Snapshot regen

`scripts/regen-models-snapshot.mjs` đổi output thành **raw-shaped**: mỗi provider lưu `name`, `api`, `npm`,
và `models: { modelId: { reasoning, release_date, limit, reasoning_options } }` (chỉ field cần cho
`computeVariants`). Snapshot KHÔNG chứa variants pre-built.

`mapProviders` đọc raw (từ live hoặc snapshot sau merge `{ ...SNAPSHOT_RAW, ...live }`) → gọi
`computeVariants` cho từng model. Output `CatalogProvider` giữ `models: string[]` (id list) + `variants`
descriptor per model.

Cache `models.json` cũ (định dạng CatalogProvider cũ) bị bỏ: TTL 5 phút tự hết; `fetch()` thấy cache cũ
shape → bỏ qua và refetch. Xử lý trong `loadCache` (kiểm tra field `rawModels`/`npm` để phân biệt).

## 8. Files thay đổi

| File | Loại |
|---|---|
| `src/main/model-variants.ts` | thêm mới (port variants() + reasoningVariants) |
| `src/main/models-catalog.ts` | sửa: `npm` field, `variants` → descriptor, mapProviders gọi computeVariants |
| `src/main/models-snapshot.json` | regen (raw fields) |
| `src/main/agent/llm.ts` | sửa: bỏ providerOptionsFor, nhận `variantOptions` |
| `src/main/agent/loop.ts` | sửa: `LoopDeps.variantOptions` |
| `src/main/meow-agent-manager.ts` | sửa: resolve descriptor tại register, allowedVariants = Object.keys |
| `scripts/regen-models-snapshot.mjs` | sửa: lưu raw fields + npm |
| `tests/unit/model-variants.test.ts` | thêm mới |
| `tests/unit/models-catalog.test.ts` | sửa |
| `tests/unit/llm-variant.test.ts` | sửa |
| `tests/unit/meow-agent-manager.test.ts` | sửa |

## 9. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Model không có variants (cả 2 nguồn rỗng) | `variants` undefined → picker ẩn |
| Cache/snapshot cũ (thiếu `rawModels`/`npm`) | `computeVariants` trả `{}`/undefined → graceful |
| Live fetch lỗi | Snapshot (có raw fields) |
| User chọn variant ngoài descriptor | `register()` clamp → undefined |
| npm không support trong `variants()` | `{}` → picker ẩn |

## 10. Tiêu chí thành công

- [ ] `minimax/MiniMax-M3` hiện `[Default, none, thinking]` trong picker.
- [ ] `deepseek/deepseek-v4-flash` hiện `[Default, low, medium, high, max]`.
- [ ] `deepseek/deepseek-chat` (reasoning:false) không hiện picker.
- [ ] `npm run typecheck` pass.
- [ ] `npm test` pass.
- [ ] `npm run build && npm run e2e` pass.
