# Port OpenCode Variant Special-Cases (variants()) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port opencode's second variant source (`variants()` special-case by model id + npm) so minimax-M3 shows `[Default, none, thinking]` and deepseek-v4-flash shows `[Default, low, medium, high, max]` in the meow picker.

**Architecture:** New pure-TS module `src/main/model-variants.ts` ports `variants()` + `reasoningVariants()` + helpers from opencode `transform.ts`, producing **variant descriptors** (`Record<variantId, StreamProviderOptions>`) pre-built and namespaced to the AI SDK providerOptions key meow's client uses. `models-catalog.ts` stores these descriptors; `llm.ts` drops `providerOptionsFor` string-switch and merges `variantOptions` directly.

**Tech Stack:** TypeScript strict, Vitest, AI SDK (`streamText` providerOptions), existing Electron app.

**Spec:** `docs/superpowers/specs/2026-08-06-meow-variant-special-cases-design.md`

**Opencode reference:** `D:\Git\GitHub\opencode\packages\opencode\src\provider\transform.ts` (lines cited inline).

---

## Key Design Decision (refines spec §6)

Meow's `createLlm` routes clients by **provider string**: `'anthropic'` → `createAnthropic`, `'google'` → `createGoogleGenerativeAI`, else → `createOpenAICompatible`. The AI SDK providerOptions key must match the client. So descriptors are namespaced by **provider string** (not npm):

| providerId (meow) | client | providerOptions key |
|---|---|---|
| `anthropic` | createAnthropic | `anthropic` |
| `google` | createGoogleGenerativeAI | `google` |
| anything else (deepseek, minimax, ...) | createOpenAICompatible | `openaiCompatible` |

Variant **semantics** (which ids exist, what body) still follow opencode's npm-based logic; only the outer namespace differs. For minimax (npm `@ai-sdk/anthropic`, providerId `minimax`), the body `{thinking:{type:'adaptive'}}` is wrapped as `{openaiCompatible: {thinking:{type:'adaptive'}}}` — matching the openai-compatible client meow builds. `sdkKey()` in opencode (transform.ts:42-94) confirms the `openaiCompatible` key is canonical for the openai-compatible SDK.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/model-variants.ts` (new) | Port of opencode `variants()`/`reasoningVariants()` + helpers → `computeVariants` |
| `src/main/models-catalog.ts` | `npm` field, descriptor `variants`, `getVariantOptions`, `mapProviders` calls `computeVariants` |
| `src/main/models-snapshot.json` | Regenerated raw-shaped |
| `src/main/agent/llm.ts` | Remove `providerOptionsFor` + budget map; add `variantOptions` |
| `src/main/agent/loop.ts` | `LoopDeps.variantOptions` |
| `src/main/meow-agent-manager.ts` | Resolve descriptor at register; `allowedVariants` = Object.keys |
| `scripts/regen-models-snapshot.mjs` | Raw-shaped output |
| `tests/unit/model-variants.test.ts` (new) | Port tests |
| `tests/unit/models-catalog.test.ts` | Update |
| `tests/unit/llm-variant.test.ts` | Update |
| `tests/unit/meow-agent-manager.test.ts` | Update |

---

## Task 1: Create `src/main/model-variants.ts` — port constants + helpers

**Files:**
- Create: `src/main/model-variants.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/model-variants.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeVariants } from '../../src/main/model-variants'
import type { ModelVariantInfo } from '../../src/main/model-variants'

function info(partial: Partial<ModelVariantInfo> & { id: string }): ModelVariantInfo {
  return {
    providerId: 'x',
    npm: '@ai-sdk/openai-compatible',
    reasoning: true,
    releaseDate: '2026-01-01',
    reasoningOptions: [],
    ...partial
  }
}

describe('computeVariants (port of opencode variants())', () => {
  it('minimax-m3 with anthropic npm → none/thinking', () => {
    const v = computeVariants(info({
      id: 'MiniMax-M3',
      providerId: 'minimax',
      npm: '@ai-sdk/anthropic',
      reasoningOptions: [{ type: 'toggle' }]
    }))
    expect(v).toEqual({
      none: { openaiCompatible: { thinking: { type: 'disabled' } } },
      thinking: { openaiCompatible: { thinking: { type: 'adaptive' } } }
    })
  })

  it('deepseek-v4-flash openai-compatible → low/medium/high/max', () => {
    const v = computeVariants(info({
      id: 'deepseek-v4-flash',
      providerId: 'deepseek',
      npm: '@ai-sdk/openai-compatible',
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }]
    }))
    // reasoningVariants returns effort values verbatim; deepseek-v4 adds 'medium' via variants() only when reasoning_options is empty.
    expect(Object.keys(v ?? {})).toEqual(['low', 'high', 'max'])
  })

  it('deepseek-v4-flash with EMPTY reasoning_options → variants() adds medium', () => {
    const v = computeVariants(info({
      id: 'deepseek-v4-flash',
      providerId: 'deepseek',
      npm: '@ai-sdk/openai-compatible',
      reasoningOptions: undefined
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'medium', 'high', 'max'])
    expect(v?.high).toEqual({ openaiCompatible: { reasoningEffort: 'high' } })
  })

  it('deepseek-chat reasoning:false → no variants', () => {
    const v = computeVariants(info({
      id: 'deepseek-chat',
      providerId: 'deepseek',
      reasoning: false
    }))
    expect(v).toBeUndefined()
  })

  it('openai gpt-5 with empty options → release-date based efforts', () => {
    const v = computeVariants(info({
      id: 'gpt-5.4',
      providerId: 'openai',
      npm: '@ai-sdk/openai',
      releaseDate: '2026-03-01'
    }))
    const keys = Object.keys(v ?? {})
    expect(keys).toContain('medium')
    expect(keys).toContain('high')
    expect(keys).toContain('xhigh')
    expect(v?.high).toEqual({
      openaiCompatible: { reasoningEffort: 'high', reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] }
    })
  })

  it('anthropic claude-opus-4.6 adaptive → low..max', () => {
    const v = computeVariants(info({
      id: 'claude-opus-4.6',
      providerId: 'anthropic',
      npm: '@ai-sdk/anthropic'
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'medium', 'high', 'max'])
    expect(v?.high).toEqual({
      openaiCompatible: { thinking: { type: 'adaptive' }, effort: 'high' }
    })
  })

  it('google gemini-2.5-pro → high/max with thinkingBudget', () => {
    const v = computeVariants(info({
      id: 'gemini-2.5-pro',
      providerId: 'google',
      npm: '@ai-sdk/google',
      limitOutput: 65536
    }))
    expect(Object.keys(v ?? {})).toEqual(['high', 'max'])
    expect(v?.high).toEqual({
      openaiCompatible: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } }
    })
  })

  it('grok-3-mini → low/high', () => {
    const v = computeVariants(info({
      id: 'grok-3-mini',
      providerId: 'xai',
      npm: '@ai-sdk/xai'
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'high'])
  })

  it('minimax non-M3 (toggle only) → {} (reasoningVariants empty, variants() excludes minimax)', () => {
    const v = computeVariants(info({
      id: 'MiniMax-M2',
      providerId: 'minimax',
      npm: '@ai-sdk/anthropic',
      reasoningOptions: [{ type: 'toggle' }]
    }))
    expect(v).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/model-variants.test.ts`
Expected: FAIL — `computeVariants` / `ModelVariantInfo` not exported.

- [ ] **Step 3: Create `src/main/model-variants.ts`**

```ts
export interface ReasoningOption {
  type: string
  values?: unknown[]
  min?: number
  max?: number
}

export interface ModelVariantInfo {
  id: string
  providerId: string
  npm: string
  reasoning: boolean
  releaseDate: string
  limitOutput?: number
  reasoningOptions?: ReasoningOption[]
}

export type VariantBody = Record<string, unknown>
export type VariantDescriptor = Record<string, VariantBody>

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

function gpt5Version(apiId: string): number | undefined {
  return Number(GPT5_VERSION_RE.exec(apiId)?.[1]) || undefined
}

function versionedGpt5ReasoningEfforts(apiId: string): string[] | undefined {
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS
  const version = gpt5Version(apiId)
  if (version === undefined) return undefined
  if (version === 1) return OPENAI_GPT5_1_EFFORTS
  return OPENAI_GPT5_2_PLUS_EFFORTS
}

function gpt5CodexReasoningEfforts(apiId: string): string[] | undefined {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes('codex')) return undefined
  const version = gpt5Version(apiId)
  if (version !== undefined && version >= 3) return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS
  if (apiId.includes('codex-max') || (version !== undefined && version >= 2)) return OPENAI_GPT5_CODEX_XHIGH_EFFORTS
  return WIDELY_SUPPORTED_EFFORTS
}

function gpt5ChatReasoningEfforts(apiId: string): string[] | undefined {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes('-chat')) return undefined
  return gpt5Version(apiId) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS
}

function openaiReasoningEfforts(apiId: string, releaseDate: string): string[] {
  const id = apiId.toLowerCase()
  if (id.includes('deep-research')) return ['medium']
  const chatEfforts = gpt5ChatReasoningEfforts(id)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(id)) return OPENAI_GPT5_PRO_EFFORTS
  const codexEfforts = gpt5CodexReasoningEfforts(id)
  if (codexEfforts) return codexEfforts
  const versionedEfforts = versionedGpt5ReasoningEfforts(id)
  if (versionedEfforts) return versionedEfforts
  const efforts = [...WIDELY_SUPPORTED_EFFORTS]
  if (GPT5_FAMILY_RE.test(id)) efforts.unshift('minimal')
  if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift('none')
  if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push('xhigh')
  return efforts
}

function openaiCompatibleReasoningEfforts(id: string): string[] {
  const apiId = id.toLowerCase()
  const chatEfforts = gpt5ChatReasoningEfforts(apiId)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_EFFORTS
  return gpt5CodexReasoningEfforts(apiId) ?? versionedGpt5ReasoningEfforts(apiId) ?? OPENAI_EFFORTS
}

function anthropicUsesModernAdaptiveThinking(apiId: string): boolean {
  if (!apiId.toLowerCase().includes('claude-')) return false
  const version = /claude-(?:[a-z]+-)?(\d+)(?:[.-](\d{1,2}))?(?:[.@-]|$)/i.exec(apiId)
  if (!version) return true
  const major = Number(version[1])
  const minor = Number(version[2] ?? 0)
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicAdaptiveEfforts(apiId: string): string[] | null {
  if (anthropicUsesModernAdaptiveThinking(apiId)) {
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (
    ['opus-4-6', 'opus-4.6', '4-6-opus', '4.6-opus', 'sonnet-4-6', 'sonnet-4.6', '4-6-sonnet', '4.6-sonnet'].some(v =>
      apiId.includes(v)
    )
  ) {
    return ['low', 'medium', 'high', 'max']
  }
  return null
}

function anthropicOmitsThinking(apiId: string): boolean {
  return anthropicUsesModernAdaptiveThinking(apiId)
}

function anthropicOpus45(apiId: string): boolean {
  return ['opus-4-5', 'opus-4.5'].some(v => apiId.includes(v))
}

function anthropicOpus45Effort(info: ModelVariantInfo, effort: string): VariantBody {
  return {
    thinking: {
      type: 'enabled',
      budgetTokens: Math.min(16_000, Math.floor((info.limitOutput ?? 32000) / 2 - 1))
    },
    effort
  }
}

function isKimiFamily(info: ModelVariantInfo): boolean {
  if ([info.providerId, info.id].some(id => {
    const value = id.toLowerCase()
    return value.includes('kimi') || value.includes('moonshot')
  })) return true
  return false
}

function googleThinkingLevelEfforts(apiId: string): string[] {
  const id = apiId.toLowerCase()
  if (!id.includes('gemini-3')) return ['low', 'high']
  if (id.includes('flash-image')) return ['minimal', 'high']
  if (id.includes('pro-image')) return ['high']
  if (id.includes('flash')) return ['minimal', 'low', 'medium', 'high']
  return ['low', 'medium', 'high']
}

function googleThinkingBudgetMax(apiId: string): number {
  const id = apiId.toLowerCase()
  if (id.includes('2.5') && id.includes('pro') && !id.includes('flash')) return 32_768
  return 24_576
}

function googleThinkingVariants(info: ModelVariantInfo): VariantDescriptor {
  const id = info.id.toLowerCase()
  if (id.includes('2.5')) {
    return {
      high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
      max: { thinkingConfig: { includeThoughts: true, thinkingBudget: googleThinkingBudgetMax(id) } }
    }
  }
  return Object.fromEntries(
    googleThinkingLevelEfforts(id).map(effort => [
      effort,
      { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
    ])
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/model-variants.test.ts`
Expected: FAIL — `computeVariants` not yet defined (helper functions exist, export missing). This is fine; Task 2 adds the merge + body builders.

- [ ] **Step 5: Commit**

```bash
git add src/main/model-variants.ts tests/unit/model-variants.test.ts
git commit -m "feat(model-variants): port opencode variants() constants and helpers"
```

---

## Task 2: Add `computeVariants` + body builders + namespace

**Files:**
- Modify: `src/main/model-variants.ts`

- [ ] **Step 1: Append the body builders + `computeVariants`**

Add to `src/main/model-variants.ts` (after `googleThinkingVariants`):

```ts
function sdkKeyForProvider(providerId: string): string {
  if (providerId === 'anthropic') return 'anthropic'
  if (providerId === 'google') return 'google'
  return 'openaiCompatible'
}

function wrap(providerId: string, body: VariantBody): VariantBody {
  const key = sdkKeyForProvider(providerId)
  if (key === 'openaiCompatible') return { openaiCompatible: body }
  return { [key]: body }
}

function reasoningEffortBody(info: ModelVariantInfo, effort: string): VariantBody | undefined {
  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return { reasoning: { effort } }
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return anthropicEffortBody(info, effort) ?? { effort }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
    case '@ai-sdk/openai':
    case '@ai-sdk/azure':
      return { reasoningEffort: effort, reasoningSummary: 'auto', include: [...INCLUDE_ENCRYPTED_REASONING] }
    default:
      return { reasoningEffort: effort }
  }
}

function anthropicEffortBody(info: ModelVariantInfo, effort: string): VariantBody | undefined {
  if (anthropicOpus45(info.id)) return anthropicOpus45Effort(info, effort)
  if (isKimiFamily(info)) return { thinking: { type: 'adaptive', display: 'summarized' }, effort }
  if (!anthropicAdaptiveEfforts(info.id)) return undefined
  return {
    thinking: {
      type: 'adaptive',
      ...(anthropicOmitsThinking(info.id) ? { display: 'summarized' } : {})
    },
    effort
  }
}

function reasoningToggleBody(info: ModelVariantInfo): VariantDescriptor {
  if (info.providerId === 'minimax' && info.id.toLowerCase().includes('minimax-m3')) {
    return {
      none: { thinking: { type: 'disabled' } },
      thinking: { thinking: { type: 'adaptive' } }
    }
  }
  return {}
}

function reasoningBudgetBody(info: ModelVariantInfo, budget: number): VariantBody | undefined {
  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return { reasoning: { max_tokens: budget } }
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return { thinking: { type: 'enabled', budgetTokens: budget } }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
    default:
      return undefined
  }
}

function reasoningVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  const opts = info.reasoningOptions
  if (opts === undefined) return undefined
  if (opts.length === 0) return {}
  const effort = opts.find(o => o.type === 'effort')
  if (effort) {
    const out: VariantDescriptor = {}
    for (const value of effort.values ?? []) {
      const id = value === null ? 'none' : typeof value === 'string' ? value : undefined
      if (id === undefined) continue
      const body = reasoningEffortBody(info, id)
      if (body) out[id] = wrap(info.providerId, body)
    }
    return out
  }
  const toggle = opts.some(o => o.type === 'toggle')
  const budget = opts.find(o => o.type === 'budget_tokens')
  if (!budget) {
    if (!toggle) return undefined
    const t = reasoningToggleBody(info)
    return Object.keys(t).length > 0 ? t : {}
  }
  const out: VariantDescriptor = {}
  if (toggle) Object.assign(out, reasoningToggleBody(info))
  const maxBudget = Math.min(budget.max ?? 31999, (info.limitOutput ?? 32000) - 1, 31999)
  if (maxBudget > 0) {
    const high = Math.min(Math.max(budget.min ?? 0, Math.floor((maxBudget + 1) / 2)), maxBudget)
    for (const [id, b] of [
      ['high', reasoningBudgetBody(info, high)],
      ['max', reasoningBudgetBody(info, maxBudget)]
    ] as const) {
      if (b) out[id] = wrap(info.providerId, b)
    }
  }
  return Object.keys(out).length > 0 ? out : {}
}

function hardcodedVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  if (!info.reasoning) return undefined
  const id = info.id.toLowerCase()
  const glm52 = ['glm-5.2', 'glm-5-2', 'glm-5p2'].some(name => id.includes(name))
  if (id.includes('minimax-m3')) {
    return reasoningToggleBody(info)
  }
  const adaptiveEfforts = anthropicAdaptiveEfforts(info.id)
  if (glm52 && info.npm === '@openrouter/ai-sdk-provider') {
    return Object.fromEntries(['high', 'xhigh'].map(effort => [effort, wrap(info.providerId, { reasoning: { effort } })]))
  }
  if (glm52 && info.npm === '@ai-sdk/openai-compatible') {
    return Object.fromEntries(['high', 'max'].map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })]))
  }
  if (glm52 && info.npm === '@ai-sdk/anthropic') {
    return Object.fromEntries(['high', 'max'].map(effort => [effort, wrap(info.providerId, { effort })]))
  }
  if (isKimiFamily(info) && ['@ai-sdk/anthropic', '@ai-sdk/google-vertex/anthropic'].includes(info.npm)) {
    return Object.fromEntries(
      ['low', 'medium', 'high', 'xhigh', 'max'].map(effort => [
        effort,
        wrap(info.providerId, { thinking: { type: 'adaptive', display: 'summarized' }, effort })
      ])
    )
  }
  if (
    id.includes('deepseek-chat') || id.includes('deepseek-reasoner') || id.includes('deepseek-r1') ||
    id.includes('deepseek-v3') || id.includes('minimax') || (id.includes('glm') && !glm52) ||
    id.includes('kimi') || id.includes('k2p') || id.includes('qwen') || id.includes('big-pickle')
  ) return {}
  if (id.includes('grok') && id.includes('grok-3-mini')) {
    const body = (e: string) => info.npm === '@openrouter/ai-sdk-provider' ? { reasoning: { effort: e } } : { reasoningEffort: e }
    return Object.fromEntries(['low', 'high'].map(e => [e, wrap(info.providerId, body(e))]))
  }

  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return Object.fromEntries(
        (id.startsWith('openai/') || id.includes('gpt')
          ? openaiCompatibleReasoningEfforts(info.id)
          : WIDELY_SUPPORTED_EFFORTS
        ).map(effort => [effort, wrap(info.providerId, { reasoning: { effort } })])
      )
    case '@ai-sdk/azure':
    case '@ai-sdk/openai':
      return Object.fromEntries(
        openaiReasoningEfforts(info.id, info.releaseDate).map(effort => [
          effort,
          wrap(info.providerId, {
            reasoningEffort: effort,
            reasoningSummary: 'auto',
            include: [...INCLUDE_ENCRYPTED_REASONING]
          })
        ])
      )
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      if (adaptiveEfforts) {
        return Object.fromEntries(
          adaptiveEfforts.map(effort => [
            effort,
            wrap(info.providerId, {
              thinking: { type: 'adaptive', ...(anthropicOmitsThinking(info.id) ? { display: 'summarized' } : {}) },
              effort
            })
          ])
        )
      }
      if (anthropicOpus45(info.id)) {
        return Object.fromEntries(
          WIDELY_SUPPORTED_EFFORTS.map(effort => [effort, wrap(info.providerId, anthropicOpus45Effort(info, effort))])
        )
      }
      return {
        high: wrap(info.providerId, { thinking: { type: 'enabled', budgetTokens: Math.min(16_000, Math.floor((info.limitOutput ?? 32000) / 2 - 1)) } }),
        max: wrap(info.providerId, { thinking: { type: 'enabled', budgetTokens: Math.min(31_999, (info.limitOutput ?? 32000) - 1) } })
      }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return googleThinkingVariants(info)
    case '@ai-sdk/mistral':
      const MISTRAL_REASONING_IDS = ['mistral-small-2603', 'mistral-small-latest', 'mistral-medium-3.5', 'mistral-medium-2604']
      const mistralId = info.id.toLowerCase()
      if (!MISTRAL_REASONING_IDS.some(m => mistralId.includes(m))) return {}
      return { high: wrap(info.providerId, { reasoningEffort: 'high' }) }
    case '@ai-sdk/cohere':
    case '@ai-sdk/perplexity':
      return {}
    case '@ai-sdk/groq':
      return Object.fromEntries(
        ['none', ...WIDELY_SUPPORTED_EFFORTS].map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })])
      )
    case '@ai-sdk/cerebras':
    case '@ai-sdk/togetherai':
    case '@ai-sdk/xai':
    case '@ai-sdk/deepinfra':
    case '@ai-sdk/openai-compatible':
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (id.includes('deepseek-v4')) efforts.push('max')
      return Object.fromEntries(efforts.map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })]))
    default:
      return {}
  }
}

export function computeVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  return reasoningVariants(info) ?? hardcodedVariants(info)
}
```

Note: `googleThinkingVariants` output must ALSO be wrapped. In `googleThinkingVariants`, add the wrap at return time — modify Task 1's `googleThinkingVariants` to wrap each body. Apply this edit in Task 2:

```ts
function googleThinkingVariants(info: ModelVariantInfo): VariantDescriptor {
  const id = info.id.toLowerCase()
  const wrapBody = (body: VariantBody) => wrap(info.providerId, body)
  if (id.includes('2.5')) {
    return {
      high: wrapBody({ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } }),
      max: wrapBody({ thinkingConfig: { includeThoughts: true, thinkingBudget: googleThinkingBudgetMax(id) } })
    }
  }
  return Object.fromEntries(
    googleThinkingLevelEfforts(id).map(effort => [
      effort,
      wrapBody({ thinkingConfig: { includeThoughts: true, thinkingLevel: effort } })
    ])
  )
}
```

Also `reasoningToggleBody` for minimax must wrap. Update it to `wrap(info.providerId, { thinking: ... })`:

```ts
function reasoningToggleBody(info: ModelVariantInfo): VariantDescriptor {
  if (info.providerId === 'minimax' && info.id.toLowerCase().includes('minimax-m3')) {
    return {
      none: wrap(info.providerId, { thinking: { type: 'disabled' } }),
      thinking: wrap(info.providerId, { thinking: { type: 'adaptive' } })
    }
  }
  return {}
}
```

Since `wrap` is defined before these, reorder so `wrap`/`sdkKeyForProvider` come first in the file.

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/model-variants.test.ts`
Expected: PASS — but the test expectations must match `sdkKeyForProvider` namespacing by providerId:
- claude case (providerId `anthropic`) → body key `anthropic`:
  ```ts
  expect(v?.high).toEqual({ anthropic: { thinking: { type: 'adaptive' }, effort: 'high' } })
  ```
- google case (providerId `google`) → body key `google`:
  ```ts
  expect(v?.high).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } } })
  ```
- openai gpt-5 case (providerId `openai`) → body key `openaiCompatible` (providerId `openai` → else branch).

Update the test file to these expectations before running.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS for model-variants.ts (it has no external deps).

- [ ] **Step 4: Commit**

```bash
git add src/main/model-variants.ts tests/unit/model-variants.test.ts
git commit -m "feat(model-variants): computeVariants merge + namespaced variant bodies"
```

---

## Task 3: Update `models-catalog.ts` — descriptor storage + `getVariantOptions`

**Files:**
- Modify: `src/main/models-catalog.ts`
- Test: `tests/unit/models-catalog.test.ts`

- [ ] **Step 1: Update the failing test**

In `tests/unit/models-catalog.test.ts`, replace the two variant tests (extracts reasoning effort values per model + getVariants returns the list) with:

```ts
  it('extracts variant descriptors per model via computeVariants', async () => {
    const fetchFn = async () => jsonResponse({
      minimax: {
        name: 'MiniMax',
        npm: '@ai-sdk/anthropic',
        models: {
          'MiniMax-M3': { reasoning: true, reasoning_options: [{ type: 'toggle' }], release_date: '2026-06-01', limit: { output: 128000 } }
        }
      },
      deepseek: {
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        models: {
          'deepseek-v4-flash': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.minimax?.variants?.['MiniMax-M3']).toEqual({
      none: { openaiCompatible: { thinking: { type: 'disabled' } } },
      thinking: { openaiCompatible: { thinking: { type: 'adaptive' } } }
    })
    expect(providers.deepseek?.variants?.['deepseek-v4-flash']).toEqual({
      low: { openaiCompatible: { reasoningEffort: 'low' } },
      high: { openaiCompatible: { reasoningEffort: 'high' } },
      max: { openaiCompatible: { reasoningEffort: 'max' } }
    })
  })

  it('getVariants returns the variant id list, getVariantOptions returns a descriptor', async () => {
    const fetchFn = async () => jsonResponse({
      deepseek: {
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        models: {
          'deepseek-v4-flash': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    expect(await catalog.getVariants('deepseek', 'deepseek-v4-flash')).toEqual(['low', 'high'])
    expect(await catalog.getVariants('deepseek', 'unknown-model')).toEqual([])
    expect(await catalog.getVariants('unknown-provider', 'x')).toEqual([])
    expect(await catalog.getVariantOptions('deepseek', 'deepseek-v4-flash', 'high')).toEqual({
      openaiCompatible: { reasoningEffort: 'high' }
    })
    expect(await catalog.getVariantOptions('deepseek', 'deepseek-v4-flash', 'nope')).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/models-catalog.test.ts`
Expected: FAIL — `variants` still `string[]`, `getVariantOptions` missing.

- [ ] **Step 3: Update `models-catalog.ts`**

Changes:

```ts
// CatalogProvider: add npm, change variants type
export interface CatalogProvider {
  name: string
  api?: string
  npm?: string
  models: string[]
  limits?: Record<string, ModelLimit>
  variants?: Record<string, Record<string, VariantBody>>   // modelId → (variantId → providerOptions)
}
```

Import from model-variants:

```ts
import { computeVariants } from './model-variants'
import type { VariantBody } from './model-variants'
```

Rewrite `mapProviders` to build `rawModels` + compute variants:

```ts
interface RawModel {
  reasoning?: boolean
  release_date?: string
  limit?: { output?: number }
  reasoning_options?: unknown[]
}

interface RawProvider {
  name?: string
  api?: string
  npm?: string
  models?: Record<string, RawModel>
}

function toRawModel(m: unknown): RawModel | undefined {
  if (typeof m !== 'object' || m === null) return undefined
  const model = m as Record<string, unknown>
  return {
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
    release_date: typeof model.release_date === 'string' ? model.release_date : '',
    limit: (model.limit as { output?: number } | undefined),
    reasoning_options: Array.isArray(model.reasoning_options) ? model.reasoning_options : undefined
  }
}

function toRawProvider(p: unknown): RawProvider | undefined {
  if (typeof p !== 'object' || p === null) return undefined
  const prov = p as Record<string, unknown>
  const models = prov.models as Record<string, unknown> | undefined
  return {
    name: typeof prov.name === 'string' ? prov.name : undefined,
    api: typeof prov.api === 'string' ? prov.api : undefined,
    npm: typeof prov.npm === 'string' ? prov.npm : undefined,
    models: models && typeof models === 'object'
      ? Object.fromEntries(
          Object.entries(models)
            .map(([id, m]) => [id, toRawModel(m)] as const)
            .filter(([, m]) => m !== undefined)
        )
      : undefined
  }
}

function mapProviders(json: Record<string, unknown>): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {}
  for (const [id, rawP] of Object.entries(json)) {
    const p = toRawProvider(rawP)
    if (!p) continue
    const variants: Record<string, Record<string, VariantBody>> = {}
    for (const [modelId, m] of Object.entries(p.models ?? {})) {
      const info = {
        id: modelId,
        providerId: id,
        npm: p.npm ?? '@ai-sdk/openai-compatible',
        reasoning: m.reasoning ?? false,
        releaseDate: m.release_date ?? '',
        limitOutput: m.limit?.output,
        reasoningOptions: (m.reasoning_options ?? []) as Array<{ type: string; values?: unknown[]; min?: number; max?: number }>
      }
      const desc = computeVariants(info)
      if (desc && Object.keys(desc).length > 0) variants[modelId] = desc
    }
    providers[id] = {
      name: p.name ?? id,
      api: p.api,
      npm: p.npm,
      models: Object.keys(p.models ?? {}),
      limits: modelLimits(p.models as Record<string, unknown>),
      ...(Object.keys(variants).length > 0 ? { variants } : {})
    }
  }
  return providers
}
```

Note: `modelLimits` currently takes `Record<string, unknown>` — keep it; pass `p.models as Record<string, unknown>`.

Add `getVariantOptions` method:

```ts
  async getVariantOptions(providerId: string, modelId: string, variantId: string): Promise<VariantBody | undefined> {
    const providers = await this.fetch()
    return providers[providerId]?.variants?.[modelId]?.[variantId]
  }
```

Update `getVariants` to return `Object.keys`:

```ts
  async getVariants(providerId: string, modelId: string): Promise<string[]> {
    const providers = await this.fetch()
    return Object.keys(providers[providerId]?.variants?.[modelId] ?? {})
  }
```

Update `fetch()` — the merge now works on raw JSON. Since snapshot is raw-shaped, `{ ...SNAPSHOT, ...live }` merges raw then `mapProviders` runs on the merged raw:

```ts
  async fetch(): Promise<Record<string, CatalogProvider>> {
    const cached = this.loadCache()
    if (cached) return cached
    let live: Record<string, unknown> | null = null
    try {
      const res = await this.fetchFn(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        live = (await res.json()) as Record<string, unknown>
      }
    } catch {
      /* offline: fall back to the bundled snapshot */
    }
    const raw = live && Object.keys(live).length > 0 ? { ...SNAPSHOT, ...live } : SNAPSHOT
    const providers = mapProviders(raw)
    this.writeCache(providers)
    return providers
  }
```

Update `SNAPSHOT` typing: `const SNAPSHOT = snapshot as unknown as Record<string, unknown>`.

`loadCache` must reject stale old-shape cache (string[] variants):

```ts
  private loadCache(): Record<string, CatalogProvider> | null {
    if (!existsSync(this.cacheFile)) return null
    try {
      const entry = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as CacheEntry
      const isOldShape = Object.values(entry?.providers ?? {}).some(p => {
        const v = (p as CatalogProvider).variants
        return v && Object.values(v).some(val => Array.isArray(val))
      })
      if (entry?.providers && !isOldShape && Date.now() - entry.fetchedAt < TTL_MS) {
        return entry.providers
      }
    } catch {
      /* corrupt cache is ignored */
    }
    return null
  }
```

(The old cache shape had `variants: Record<string, string[]>`; new shape has
`variants: Record<string, Record<string, VariantBody>>`. An array value = old shape → reject and refetch.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/models-catalog.test.ts`
Expected: PASS (update the offline-snapshot test if it asserted `providers.deepseek.models` — that still works because `models` is `string[]`).

- [ ] **Step 5: Commit**

```bash
git add src/main/models-catalog.ts tests/unit/models-catalog.test.ts
git commit -m "feat(catalog): store variant descriptors via computeVariants"
```

---

## Task 4: Update snapshot regen script + regenerate

**Files:**
- Modify: `scripts/regen-models-snapshot.mjs`

- [ ] **Step 1: Rewrite the script to raw-shaped output**

```js
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://models.dev/api.json'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/main/models-snapshot.json')

async function main() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()

  const out = {}
  for (const [pid, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    const prov = p
    const models = {}
    for (const [mid, m] of Object.entries(prov.models ?? {})) {
      if (typeof m !== 'object' || m === null) continue
      const raw = {}
      if (typeof m.reasoning === 'boolean') raw.reasoning = m.reasoning
      if (typeof m.release_date === 'string') raw.release_date = m.release_date
      if (m.limit && (m.limit.context !== undefined || m.limit.output !== undefined)) {
        raw.limit = {}
        if (m.limit.context !== undefined) raw.limit.context = m.limit.context
        if (m.limit.output !== undefined) raw.limit.output = m.limit.output
      }
      if (Array.isArray(m.reasoning_options)) raw.reasoning_options = m.reasoning_options
      models[mid] = raw
    }
    out[pid] = {
      name: typeof prov.name === 'string' ? prov.name : pid,
      ...(typeof prov.api === 'string' ? { api: prov.api } : {}),
      ...(typeof prov.npm === 'string' ? { npm: prov.npm } : {}),
      models
    }
  }

  writeFileSync(OUT, JSON.stringify(out))
  console.log(`Wrote ${OUT} (${Object.keys(out).length} providers)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Regenerate + verify**

Run: `npm run regen:models`

Verify shape:
```bash
node -e "const s=require('./src/main/models-snapshot.json'); console.log('providers:', Object.keys(s).length); console.log('minimax npm:', s.minimax.npm); console.log('minimax M3:', JSON.stringify(s.minimax.models['MiniMax-M3']).slice(0,200))"
```

- [ ] **Step 3: Run catalog tests**

Run: `npx vitest run tests/unit/models-catalog.test.ts`
Expected: PASS (offline snapshot fallback test now parses raw-shaped snapshot via mapProviders).

- [ ] **Step 4: Commit**

```bash
git add scripts/regen-models-snapshot.mjs src/main/models-snapshot.json
git commit -m "chore(snapshot): raw-shaped snapshot with npm + reasoning metadata"
```

---

## Task 5: Update `llm.ts` — remove providerOptionsFor, add variantOptions

**Files:**
- Modify: `src/main/agent/llm.ts`
- Test: `tests/unit/llm-variant.test.ts`

- [ ] **Step 1: Update the failing test**

Rewrite `tests/unit/llm-variant.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLlm } from '../../src/main/agent/llm'
import type { LlmStreamOptions } from '../../src/main/agent/llm'

function openaiCompletion() {
  return JSON.stringify({
    id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'x',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

function googleCompletion() {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }],
    modelVersion: 'gemini-2.5-pro',
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
  })
}

function captureServer(completionBody: string) {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => {
      bodies.push(data)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(completionBody)
    })
  })
  return { server, bodies }
}

function opts(partial: Partial<LlmStreamOptions>): LlmStreamOptions {
  return { model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], ...partial }
}

describe('llm variantOptions merging', () => {
  it('openai-compatible: merges variantOptions into providerOptions', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    for (const v of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const stream = llm.stream(opts({ variantOptions: { openaiCompatible: { reasoningEffort: v } } }))
      for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    }
    server.close()
    const efforts = bodies.map(b => (JSON.parse(b) as { reasoning_effort?: string }).reasoning_effort)
    expect(efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('google: merges thinkingConfig under google key', async () => {
    const { server, bodies } = captureServer(googleCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('google', 'sk-test', `http://127.0.0.1:${port}/v1beta`)
    const stream = llm.stream(opts({
      model: 'gemini-2.5-pro',
      variantOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } } }
    }))
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    const body = JSON.parse(bodies[0]) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean } }
    }
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('high')
    expect(body.generationConfig?.thinkingConfig?.includeThoughts).toBe(true)
  })

  it('anthropic: merges thinking.budgetTokens under anthropic key', async () => {
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', c => { data += c })
      req.on('end', () => {
        bodies.push(data)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-4-5","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n')
        res.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n')
        res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
        res.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n')
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
        res.end()
      })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('anthropic', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const s1 = llm.stream(opts({
      model: 'claude-opus-4-5',
      variantOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 16384 } } }
    }))
    for await (const part of s1) { if (part.kind === 'error') throw new Error(part.error) }
    const parsed1 = JSON.parse(bodies[0]) as { thinking?: { budget_tokens?: number; type?: string } }
    expect(parsed1.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })
    server.close()
  })

  it('sends nothing when variantOptions is absent', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const stream = llm.stream(opts({}))
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    expect((JSON.parse(bodies[0]) as { reasoning_effort?: string }).reasoning_effort).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/llm-variant.test.ts`
Expected: FAIL — `LlmStreamOptions` has no `variantOptions`.

- [ ] **Step 3: Update `llm.ts`**

```ts
import type { ModelVariant } from '../../shared/types'   // keep? remove if unused

export interface LlmStreamOptions {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
  variantOptions?: Record<string, unknown>   // NEW: pre-built providerOptions
}
```

Remove `providerOptionsFor`, `ANTHROPIC_THINKING_BUDGET`, and the `provider`-based computation. In `stream()`:

```ts
      const tools = Object.fromEntries(opts.tools.map(def => [def.name, toToolDefinition(def)]))
      const result = streamText({
        model: model(opts.model),
        system: opts.system,
        messages: opts.messages,
        tools,
        abortSignal: opts.signal,
        ...(opts.variantOptions ? { providerOptions: opts.variantOptions as StreamProviderOptions } : {})
      })
```

Remove unused `ModelVariant` import if no longer referenced.

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run tests/unit/llm-variant.test.ts` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/llm.ts tests/unit/llm-variant.test.ts
git commit -m "feat(llm): merge variantOptions providerOptions, drop string-switch"
```

---

## Task 6: Update `loop.ts` + `meow-agent-manager.ts`

**Files:**
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: `loop.ts` — `LoopDeps.variantOptions`**

```ts
  variantOptions?: Record<string, unknown>   // NEW (replaces variant?: string)
```

In `run()`:

```ts
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system: this.deps.system,
          messages: llmMessages,
          tools: isLastStep ? [] : this.visibleToolDefs(),
          signal,
          variantOptions: this.deps.variantOptions
        })
```

- [ ] **Step 2: `meow-agent-manager.ts`**

In `register()`, replace the clamp + variant pass:

```ts
    const allowed = this.allowedVariantsFor(agent)
    const validVariant =
      agent.variant && allowed.includes(agent.variant) ? agent.variant : undefined
    if (validVariant !== agent.variant) {
      agent.variant = validVariant
      this.agents.set(agent.id, agent)
    }
    const modelKey = `${resolved.provider}/${resolved.model}`
    const variantOptions = validVariant ? this.modelVariants.get(modelKey)?.[validVariant] : undefined
```

`register()` stays **sync** — the sync `modelVariants` map (populated by `refreshModelLimits`) already holds full descriptors (`Record<variantId, VariantBody>`), so no `await` needed. Pass to runner:

```ts
      variantOptions,
```

And update `allowedVariantsFor` to use descriptor keys — it already returns `this.modelVariants.get(...) ?? []`; the map now stores `Record<string, VariantBody>` so change to:

```ts
  private allowedVariantsFor(agent: AgentConfig): string[] {
    if (!this.deps.catalog) return []
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    if (!resolved.provider || !resolved.model) return []
    return Object.keys(this.modelVariants.get(`${resolved.provider}/${resolved.model}`) ?? {})
  }
```

And in `refreshModelLimits`, the map value type changes from `string[]` to `Record<string, VariantBody>`:

```ts
  private modelVariants = new Map<string, Record<string, VariantBody>>()
```

and:

```ts
          const variants = p.variants?.[model]
          if (variants && Object.keys(variants).length > 0) {
            this.modelVariants.set(`${providerId}/${model}`, variants)
          }
```

Import `VariantBody` type from `./model-variants`.

- [ ] **Step 3: Update the manager test**

In `tests/unit/meow-agent-manager.test.ts`, the `llmVariants` capture currently reads `request.variant`. Change to `request.variantOptions`:

```ts
  const llmVariants: Array<Record<string, unknown> | undefined> = []
  ...
        llmVariants.push(request.variantOptions)
```

Update the two variant tests:

```ts
  it('setVariant passes a clamped variant descriptor to the llm stream', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-var-stream-'))
    try {
      const cfgPath = path.join(dir, 'meow.json')
      writeFileSync(cfgPath, JSON.stringify({
        provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
        model: 'test'
      }))
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          test: {
            name: 'Test',
            npm: '@ai-sdk/openai-compatible',
            models: {
              'test-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] }
            }
          }
        }) }) as unknown as Response)
      const { manager, llmVariants } = await makeManager({ configPath: cfgPath, catalog })
      await manager.send('a1', 'first')
      expect(llmVariants[0]).toBeUndefined()
      manager.setVariant('a1', 'high')
      await manager.send('a1', 'second')
      expect(llmVariants[1]).toEqual({ openaiCompatible: { reasoningEffort: 'high' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setVariant clamps an out-of-allow value to undefined', async () => {
    const { manager } = await makeManager()
    await manager.send('a1', 'first')
    manager.setVariant('a1', 'xhigh')
    expect(manager.getVariant('a1')).toBeUndefined()
  })

  it('setVariant keeps an allow-listed value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-var-'))
    try {
      const cfgPath = path.join(dir, 'meow.json')
      writeFileSync(cfgPath, JSON.stringify({
        provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
        model: 'test'
      }))
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          test: {
            name: 'Test',
            npm: '@ai-sdk/openai-compatible',
            models: {
              'test-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }] }
            }
          }
        }) }) as unknown as Response)
      const { manager } = await makeManager({ configPath: cfgPath, catalog })
      await manager.send('a1', 'first')
      manager.setVariant('a1', 'low')
      expect(manager.getVariant('a1')).toBe('low')
      manager.setVariant('a1', 'max')
      expect(manager.getVariant('a1')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
```

Note: `manager.send` already awaits; `register()` being async is fine because `init`/`reload` already `await` it. If `makeManager` calls `await manager.init(...)` and `send` awaits `runner.run`, the `register` inside `send`'s rebuild path is awaited before returning.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/loop.ts src/main/meow-agent-manager.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat(manager): resolve variant descriptor at register, pass via variantOptions"
```

---

## Task 7: Final verification

**Files:**
- none (verification)

- [ ] **Step 1: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: full tests**

Run: `npm test`
Expected: PASS. Specifically:
- `tests/unit/model-variants.test.ts` — 9 cases
- `tests/unit/models-catalog.test.ts` — updated
- `tests/unit/llm-variant.test.ts` — 4 cases
- `tests/unit/meow-agent-manager.test.ts` — variant tests updated

- [ ] **Step 3: build + e2e**

Run: `npm run build && npm run e2e`
Expected: build pass, 7 e2e pass.

- [ ] **Step 4: manual check**

Run: `npm run dev`
With the user's `meow.json` (deepseek + minimax):
- minimax/MiniMax-M3 agent → picker shows `[Default, none, thinking]`.
- deepseek/deepseek-v4-flash → `[Default, low, medium, high, max]` (after snapshot has `medium` from variants() — note: with `reasoning_options` present, effort values win; deepseek-v4-flash has explicit effort `[low,high,max]` in catalog so it shows those, NOT medium. The `[low,medium,high,max]` case applies when reasoning_options is absent.)

If a provider's picker still empty, verify snapshot has `npm` + `reasoning` for that provider.

---

## Self-Review Checklist

- [ ] Spec coverage: model-variants module ✓ (Tasks 1-2), catalog descriptor ✓ (Task 3), snapshot raw ✓ (Task 4), llm variantOptions ✓ (Task 5), manager/loop ✓ (Task 6), verification ✓ (Task 7).
- [ ] No placeholder steps ("TBD", "implement later", "similar to").
- [ ] Type consistency: `VariantBody = Record<string, unknown>` used everywhere; `variantOptions?: Record<string, unknown>` in `LlmStreamOptions` + `LoopDeps`; `getVariantOptions` returns `VariantBody | undefined`; `computeVariants` returns `VariantDescriptor | undefined`.
- [ ] `register()` stays sync — variantOptions read from sync `modelVariants` map.
- [ ] Namespace matches meow's client routing: `anthropic`→`anthropic`, `google`→`google`, else→`openaiCompatible`.
- [ ] Commit messages match repo style.
