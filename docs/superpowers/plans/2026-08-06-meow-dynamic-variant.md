# Dynamic Per-Model Variant (Reasoning Effort) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the variant/reasoning-effort picker in the chat panel render dynamically based on the currently selected model's supported values (sourced from `https://models.dev/api.json`), matching opencode's behavior.

**Architecture:** Hybrid approach — replace the hardcoded `'medium' | 'high' | 'max'` union with a runtime string validated against a per-model `variants?: Record<string, string[]>` field in the existing `ModelsCatalog`. Add an IPC channel `agent:get-variants` to query available variants for the agent's current model. Extend `providerOptionsFor` to add a Google branch (`thinkingConfig.thinkingLevel`). Two layers of clamping in `MeowAgentManager.setVariant` + `register()` ensure `workspaces.json` never holds an out-of-range variant.

**Tech Stack:** TypeScript strict, Electron IPC, React, Vitest. Same as existing codebase.

**Spec:** `docs/superpowers/specs/2026-08-06-meow-dynamic-variant-design.md`

---

## File Structure

Files created or modified by this plan:

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | Loosen `ModelVariant` to `string`; keep `AgentConfig.variant?: string` |
| `src/shared/ipc.ts` | Add `Channels.AgentGetVariants`; widen `setAgentVariant` signature |
| `src/preload/index.ts` | Expose `getAgentVariants`; widen `setAgentVariant` signature |
| `src/main/index.ts` | New IPC handler `AgentGetVariants`; widen `setAgentVariant`; clamp persistence |
| `src/main/models-catalog.ts` | Parser reads `reasoning_options` → `variants` field; new `getVariants(p, m)` API |
| `src/main/models-snapshot.json` | Regenerate with `variants` fields |
| `src/main/meow-agent-manager.ts` | `setVariant` clamps via `allowedVariantsFor`; `register()` defense-in-depth clamp; new `getVariant` getter |
| `src/main/agent/llm.ts` | `ModelVariant` → `string`; `providerOptionsFor(provider, model, variant)` adds Google branch; Anthropic out-of-budget → undefined |
| `src/main/agent/loop.ts` | `LoopDeps.variant?: string` |
| `src/renderer/src/components/chat/ChatPanel.tsx` | Dynamic `<select>`; fetch `availableVariants` via IPC; hide when empty; clamp on model change |
| `src/renderer/src/components/chat/ModelPicker.tsx` | Fire `meow:model-changed` after `setAgentModel` |
| `src/renderer/src/components/Pane.tsx` | Widen `handleVariantChange` signature |
| `scripts/regen-models-snapshot.ts` | New script: fetch models.dev → write snapshot with `variants` |
| `package.json` | Add `regen:models` script |
| `tests/unit/models-catalog.test.ts` | Add tests for `variants` extraction + `getVariants` |
| `tests/unit/llm-variant.test.ts` | Add Google + Anthropic-out-of-budget tests |
| `tests/unit/meow-agent-manager.test.ts` | Add clamp test |
| `tests/unit/ipc-contract.test.ts` | Add `getAgentVariants` to required methods + channel assert |

---

## Task 1: Loosen `ModelVariant` type to `string`

**Files:**
- Modify: `src/shared/types.ts:5`

- [ ] **Step 1: Replace the union with `string`**

Edit `src/shared/types.ts` line 5:

```ts
// Before:
export type ModelVariant = 'medium' | 'high' | 'max'

// After:
export type ModelVariant = string
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: pass. The union narrowing only affects the `ANTHROPIC_THINKING_BUDGET` map (which we'll fix in Task 6). Other typecheck errors will appear there.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor(types): loosen ModelVariant to string"
```

---

## Task 2: Add `AgentGetVariants` channel + IPC contract

**Files:**
- Modify: `src/shared/ipc.ts:16,85`

- [ ] **Step 1: Add new channel constant**

In `src/shared/ipc.ts`, add after line 16 (next to existing `AgentSetVariant`):

```ts
  AgentGetVariants: 'agent:get-variants',
```

- [ ] **Step 2: Widen `setAgentVariant` and add `getAgentVariants`**

In `src/shared/ipc.ts`, modify line 85:

```ts
// Before:
  setAgentVariant(agentId: string, variant: 'medium' | 'high' | 'max'): Promise<void>
  setAgentModel(agentId: string, provider: string, model: string): Promise<void>
  getAgentModel(agentId: string): Promise<ModelRef | null>

// After:
  setAgentVariant(agentId: string, variant: string | null): Promise<void>
  getAgentVariants(agentId: string): Promise<string[]>
  setAgentModel(agentId: string, provider: string, model: string): Promise<void>
  getAgentModel(agentId: string): Promise<ModelRef | null>
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL with errors in `src/preload/index.ts:28`, `src/main/index.ts:240,371` — the 3 sites using the inline union. These are fixed in Task 3 and Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts
git commit -m "feat(ipc): add AgentGetVariants channel, widen setAgentVariant signature"
```

---

## Task 3: Update preload to match new IPC contract

**Files:**
- Modify: `src/preload/index.ts:28`

- [ ] **Step 1: Replace inline union + add `getAgentVariants`**

In `src/preload/index.ts`, modify lines 28-29:

```ts
// Before:
  setAgentVariant: (agentId: string, variant: 'medium' | 'high' | 'max') =>
    ipcRenderer.invoke(Channels.AgentSetVariant, agentId, variant),

// After:
  setAgentVariant: (agentId: string, variant: string | null) =>
    ipcRenderer.invoke(Channels.AgentSetVariant, agentId, variant),
  getAgentVariants: (agentId: string) =>
    ipcRenderer.invoke(Channels.AgentGetVariants, agentId),
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL only with `src/main/index.ts:240,371` errors remaining.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose getAgentVariants, widen setAgentVariant"
```

---

## Task 4: Update `MainApp.setAgentVariant` + add IPC handler for `AgentGetVariants`

**Files:**
- Modify: `src/main/index.ts:240-246,371-372`
- Modify (later): `src/main/meow-agent-manager.ts` — needs `getVariant` getter (Task 7)

- [ ] **Step 1: Widen `setAgentVariant` signature**

In `src/main/index.ts` line 240:

```ts
// Before:
  setAgentVariant(agentId: string, variant: 'medium' | 'high' | 'max'): void {
    this.meowAgent.setVariant(agentId, variant)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      this.workspaces.updateAgent(ws.projectPath, agentId, { variant })
    }
  }

// After:
  setAgentVariant(agentId: string, variant: string | null): void {
    this.meowAgent.setVariant(agentId, variant ?? undefined)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      const stored = this.meowAgent.getVariant(agentId)
      this.workspaces.updateAgent(ws.projectPath, agentId, { variant: stored })
    }
  }
```

- [ ] **Step 2: Widen IPC handler signature**

In `src/main/index.ts` line 371:

```ts
// Before:
  ipcMain.handle(Channels.AgentSetVariant, (_e, agentId: string, variant: 'medium' | 'high' | 'max') =>
    mainApp.setAgentVariant(agentId, variant))

// After:
  ipcMain.handle(Channels.AgentSetVariant, (_e, agentId: string, variant: string | null) =>
    mainApp.setAgentVariant(agentId, variant))
  ipcMain.handle(Channels.AgentGetVariants, (_e, agentId: string) =>
    mainApp.meowAgent.getAvailableVariants(agentId))
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL — `getVariant` and `getAvailableVariants` are not defined yet. They're added in Task 5 + Task 7.

- [ ] **Step 4: Commit (only if all dependent methods already exist; otherwise commit after Task 5 + Task 7)**

Skip commit until Task 5 + Task 7 land.

---

## Task 5: Add `ModelsCatalog.getVariants` + parser for `reasoning_options`

**Files:**
- Modify: `src/main/models-catalog.ts:11-56`

- [ ] **Step 1: Write the failing test**

In `tests/unit/models-catalog.test.ts`, add at the end of the `describe('ModelsCatalog', ...)` block:

```ts
  it('extracts reasoning effort values per model', async () => {
    const fetchFn = async () => jsonResponse({
      google: {
        name: 'Google',
        models: {
          'gemini-2.5-pro': {
            reasoning: true,
            reasoning_options: [
              { type: 'effort', values: ['none', 'low', 'medium', 'high', 'max'] }
            ]
          },
          'gemini-no-reasoning': {}
        }
      },
      anthropic: {
        name: 'Anthropic',
        models: {
          'claude-opus-4-5': {
            reasoning: true,
            reasoning_options: [
              { type: 'budget_tokens', min: 1024, max: 32000 },
              { type: 'toggle' }
            ]
          }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.google?.variants?.['gemini-2.5-pro']).toEqual(['none', 'low', 'medium', 'high', 'max'])
    expect(providers.google?.variants?.['gemini-no-reasoning']).toBeUndefined()
    expect(providers.anthropic?.variants?.['claude-opus-4-5']).toBeUndefined()
  })

  it('getVariants returns the list for a known model', async () => {
    const fetchFn = async () => jsonResponse({
      google: {
        name: 'Google',
        models: {
          'gemini-2.5-pro': {
            reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
          }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    expect(await catalog.getVariants('google', 'gemini-2.5-pro')).toEqual(['low', 'medium', 'high'])
    expect(await catalog.getVariants('google', 'unknown-model')).toEqual([])
    expect(await catalog.getVariants('unknown-provider', 'x')).toEqual([])
  })
```

- [ ] **Step 2: Run the new test**

Run: `npx vitest run tests/unit/models-catalog.test.ts`

Expected: FAIL — `getVariants` not defined; `variants` field not extracted.

- [ ] **Step 3: Add `variants` field to `CatalogProvider`**

In `src/main/models-catalog.ts`, modify lines 11-16:

```ts
// Before:
export interface CatalogProvider {
  name: string
  api?: string
  models: string[]
  limits?: Record<string, ModelLimit>
}

// After:
export interface CatalogProvider {
  name: string
  api?: string
  models: string[]
  limits?: Record<string, ModelLimit>
  variants?: Record<string, string[]>
}
```

- [ ] **Step 4: Add `reasoningEffortValues` and `modelVariants` helpers + extend `mapProviders`**

In `src/main/models-catalog.ts`, insert after line 33 (after `modelLimits`):

```ts
function reasoningEffortValues(model: unknown): string[] | undefined {
  if (typeof model !== 'object' || model === null) return undefined
  const opts = (model as { reasoning_options?: unknown }).reasoning_options
  if (!Array.isArray(opts)) return undefined
  const effort = opts.find((o: unknown) => {
    return typeof o === 'object' && o !== null && (o as { type?: unknown }).type === 'effort'
  }) as { values?: unknown } | undefined
  if (!effort || !Array.isArray(effort.values)) return undefined
  const values = effort.values.filter((v): v is string => typeof v === 'string')
  return values.length > 0 ? values : undefined
}

function modelVariants(models: Record<string, unknown> | undefined): Record<string, string[]> | undefined {
  if (typeof models !== 'object' || models === null) return undefined
  const out: Record<string, string[]> = {}
  let found = false
  for (const [id, m] of Object.entries(models)) {
    const values = reasoningEffortValues(m)
    if (values) { out[id] = values; found = true }
  }
  return found ? out : undefined
}
```

Then modify `mapProviders` (lines 44-56) to include `variants`:

```ts
function mapProviders(json: Record<string, { name?: string; api?: string; models?: Record<string, unknown> }>): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {}
  for (const [id, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    providers[id] = {
      name: p.name ?? id,
      api: p.api,
      models: Object.keys(p.models ?? {}),
      limits: modelLimits(p.models),
      variants: modelVariants(p.models)
    }
  }
  return providers
}
```

- [ ] **Step 5: Add `getVariants` method to `ModelsCatalog` class**

In `src/main/models-catalog.ts`, after the `getModelLimit` method (after line 95):

```ts
  async getVariants(providerId: string, modelId: string): Promise<string[]> {
    const providers = await this.fetch()
    return providers[providerId]?.variants?.[modelId] ?? []
  }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/models-catalog.test.ts`

Expected: PASS (all existing tests + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src/main/models-catalog.ts tests/unit/models-catalog.test.ts
git commit -m "feat(catalog): extract reasoning_options into per-model variants"
```

---

## Task 6: Wire-format mapping (Google + Anthropic out-of-budget)

**Files:**
- Modify: `src/main/agent/llm.ts:33-50`

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/llm-variant.test.ts` content with:

```ts
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLlm } from '../../src/main/agent/llm'

function openaiCompletion() {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'x',
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

describe('llm variant mapping', () => {
  it('openai-compatible: sends reasoning_effort verbatim (medium/high/low/xhigh/max)', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    for (const v of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const stream = llm.stream({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], variant: v })
      for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    }
    server.close()
    const efforts = bodies.map(b => (JSON.parse(b) as { reasoning_effort?: string }).reasoning_effort)
    expect(efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('google: sends thinkingLevel under thinkingConfig', async () => {
    const { server, bodies } = captureServer(googleCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('google', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const stream = llm.stream({ model: 'gemini-2.5-pro', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], variant: 'high' })
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    const body = JSON.parse(bodies[0]) as { generationConfig?: { thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean } } }
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('high')
    expect(body.generationConfig?.thinkingConfig?.includeThoughts).toBe(true)
  })

  it('anthropic: sends thinking.budgetTokens only for budget variants', async () => {
    let lastBody = ''
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', c => { data += c })
      req.on('end', () => {
        lastBody = data
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }],
          model: 'claude-opus-4-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }
        }))
      })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('anthropic', 'sk-test', `http://127.0.0.1:${port}/v1`)

    // in-budget: 'high' → budgetTokens 16384
    const s1 = llm.stream({ model: 'claude-opus-4-5', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], variant: 'high' })
    for await (const part of s1) { if (part.kind === 'error') throw new Error(part.error) }
    const parsed1 = JSON.parse(lastBody) as { thinking?: { budget_tokens?: number; type?: string } }
    expect(parsed1.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })

    // out-of-budget: 'xhigh' → no thinking field
    const s2 = llm.stream({ model: 'claude-opus-4-5', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], variant: 'xhigh' })
    for await (const part of s2) { if (part.kind === 'error') throw new Error(part.error) }
    const parsed2 = JSON.parse(lastBody) as { thinking?: unknown }
    expect(parsed2.thinking).toBeUndefined()

    server.close()
  })

  it('sends nothing when variant is absent', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const stream = llm.stream({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [] })
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    expect((JSON.parse(bodies[0]) as { reasoning_effort?: string }).reasoning_effort).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run new tests**

Run: `npx vitest run tests/unit/llm-variant.test.ts`

Expected: FAIL — Google and Anthropic branches don't exist yet.

- [ ] **Step 3: Rewrite `providerOptionsFor` + Anthropic budget map**

In `src/main/agent/llm.ts`, replace lines 35-50:

```ts
// Before:
const ANTHROPIC_THINKING_BUDGET: Record<ModelVariant, number> = {
  medium: 8192,
  high: 16384,
  max: 32000
}

function providerOptionsFor(provider: string, variant?: ModelVariant): StreamProviderOptions | undefined {
  if (!variant) return undefined
  if (provider === 'anthropic') {
    return {
      anthropic: { thinking: { type: 'enabled', budgetTokens: ANTHROPIC_THINKING_BUDGET[variant] } }
    } as StreamProviderOptions
  }
  const reasoningEffort = variant === 'max' ? 'xhigh' : variant
  return { openaiCompatible: { reasoningEffort } } as StreamProviderOptions
}

// After:
const ANTHROPIC_THINKING_BUDGET: Record<string, number> = {
  medium: 8192,
  high: 16384,
  max: 32000
}

function providerOptionsFor(provider: string, variant?: string): StreamProviderOptions | undefined {
  if (!variant) return undefined
  if (provider === 'anthropic') {
    const budget = ANTHROPIC_THINKING_BUDGET[variant]
    if (!budget) return undefined
    return {
      anthropic: { thinking: { type: 'enabled', budgetTokens: budget } }
    } as StreamProviderOptions
  }
  if (provider === 'google') {
    return {
      google: { thinkingConfig: { includeThoughts: true, thinkingLevel: variant } }
    } as StreamProviderOptions
  }
  return { openaiCompatible: { reasoningEffort: variant } } as StreamProviderOptions
}
```

- [ ] **Step 4: Update `LlmStreamOptions.variant` type**

In `src/main/agent/llm.ts`, modify line 26:

```ts
// Before:
  variant?: ModelVariant

// After:
  variant?: string
```

- [ ] **Step 5: Run all variant tests**

Run: `npx vitest run tests/unit/llm-variant.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL with errors in `src/main/agent/loop.ts:37` (`variant?: ModelVariant`) and
`src/main/meow-agent-manager.ts:313,563` — fixed in Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/llm.ts tests/unit/llm-variant.test.ts
git commit -m "feat(llm): add Google thinkingLevel branch, Anthropic out-of-budget fallback"
```

---

## Task 7: Clamp variant in `MeowAgentManager` (set + register + getter)

**Files:**
- Modify: `src/main/meow-agent-manager.ts:4,313-324,563`
- Modify: `src/main/agent/loop.ts:2,37`

- [ ] **Step 1: Update imports + `LoopDeps.variant` type**

In `src/main/agent/loop.ts` line 2 and 37:

```ts
// Line 2 — remove ModelVariant from type import:
// Before:
import type { ChatEvent, ChatMessage, ModelVariant, PromptResponse, QuestionPrompt, TokenUsage, TodoItem, ToolCallData } from '../../shared/types'

// After:
import type { ChatEvent, ChatMessage, PromptResponse, QuestionPrompt, TokenUsage, TodoItem, ToolCallData } from '../../shared/types'

// Line 37:
// Before:
  variant?: ModelVariant

// After:
  variant?: string
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL only with `src/main/meow-agent-manager.ts` errors.

- [ ] **Step 3: Write the failing test in `meow-agent-manager.test.ts`**

Add after the existing `setVariant passes the variant to the llm stream (default high)` test
(after line 332):

```ts
  it('setVariant clamps an out-of-allow value to undefined', async () => {
    const { manager } = await makeManager()
    await manager.send('a1', 'first')
    manager.setVariant('a1', 'xhigh')  // not in any allow list (allow list is empty in test fixture)
    const stored = manager.getVariant('a1')
    expect(stored).toBeUndefined()
  })

  it('setVariant keeps an allow-listed value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-var-'))
    try {
      const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () =>
        ({ ok: true, json: async () => ({
          deepseek: {
            name: 'DeepSeek',
            models: {
              'deepseek-chat': { reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }] }
            }
          }
        }) }) as unknown as Response)
      const { manager } = await makeManager({ configPath: path.join(dir, 'meow.json'), catalog })
      await manager.send('a1', 'first')
      manager.setVariant('a1', 'low')
      expect(manager.getVariant('a1')).toBe('low')
      manager.setVariant('a1', 'max')  // not allowed for this model
      expect(manager.getVariant('a1')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "clamps an out-of-allow"`

Expected: FAIL — `setVariant` doesn't clamp yet, `getVariant` doesn't exist.

- [ ] **Step 5: Remove `ModelVariant` import and add helper methods**

In `src/main/meow-agent-manager.ts`, modify line 4:

```ts
// Before:
import type { AgentConfig, AgentMode, CatalogProviderSummary, Command, ModelRef, ModelVariant } from '../shared/types'

// After:
import type { AgentConfig, AgentMode, CatalogProviderSummary, Command, ModelRef } from '../shared/types'
```

Add new methods in the class. Insert after `getProviderModels` (after line 354):

```ts
  getAvailableVariants(agentId: string): string[] {
    const agent = this.agents.get(agentId)
    if (!agent || !this.deps.catalog) return []
    return this.allowedVariantsFor(agent)
  }

  getVariant(agentId: string): string | undefined {
    return this.agents.get(agentId)?.variant
  }

  private allowedVariantsFor(agent: AgentConfig): string[] {
    if (!this.deps.catalog) return []
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    if (!resolved.provider || !resolved.model) return []
    return this.deps.catalog.getVariants(resolved.provider, resolved.model)
  }
```

Note: `getAvailableVariants` is async (calls catalog) — change to:

```ts
  async getAvailableVariants(agentId: string): Promise<string[]> {
    const agent = this.agents.get(agentId)
    if (!agent || !this.deps.catalog) return []
    return this.allowedVariantsFor(agent)
  }
```

- [ ] **Step 6: Update `setVariant` to clamp + update `register()` for defense-in-depth**

Modify `setVariant` (lines 313-324):

```ts
// Before:
  setVariant(agentId: string, variant: ModelVariant): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.variant = variant
      this.agents.set(agentId, agent)
      if (!this.running.has(agentId)) {
        this.runners.delete(agentId)
        this.resolved.delete(agentId)
        this.register(agent)
      }
    }
  }

// After:
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
```

Modify the `register()` method (lines 563 + nearby):

```ts
// Before (line 563):
      variant: agent.variant ?? 'high',

// After (replace the variant line + insert clamp before):
    const allowed = this.allowedVariantsFor(agent)
    const validVariant =
      agent.variant && allowed.includes(agent.variant) ? agent.variant : undefined
    if (validVariant !== agent.variant) {
      agent.variant = validVariant
      this.agents.set(agent.id, agent)
    }
// ... (later, where SessionRunner is constructed)
      variant: validVariant,
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`

Expected: PASS (all tests, including new ones).

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`

Expected: PASS (no remaining errors in main process code; renderer errors next).

- [ ] **Step 9: Commit**

```bash
git add src/main/meow-agent-manager.ts src/main/agent/loop.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat(manager): clamp variant on set + register, expose getAvailableVariants/getVariant"
```

---

## Task 8: IPC contract test — add `getAgentVariants`

**Files:**
- Modify: `tests/unit/ipc-contract.test.ts:10,32,116`

- [ ] **Step 1: Add `getAgentVariants` to required methods**

In `tests/unit/ipc-contract.test.ts` line 10 (inside `required: (keyof AgentApi)[]` array), add:

```ts
      'getAgentVariants',
```

(Insert after `'setAgentVariant'` and before `'setAgentModel'` to match alphabetical order.)

- [ ] **Step 2: Add stub in test `AgentApi`**

In `tests/unit/ipc-contract.test.ts`, add stub after `setAgentVariant` (after line 32):

```ts
      getAgentVariants: async () => [],
```

- [ ] **Step 3: Add channel assertion**

In `tests/unit/ipc-contract.test.ts`, add after line 116 (after `Channels.AgentSetVariant`):

```ts
    expect(Channels.AgentGetVariants).toBe('agent:get-variants')
```

- [ ] **Step 4: Run ipc-contract test**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/ipc-contract.test.ts
git commit -m "test(ipc): cover getAgentVariants in contract test"
```

---

## Task 9: Renderer — widen `Pane.handleVariantChange`

**Files:**
- Modify: `src/renderer/src/components/Pane.tsx:38`

- [ ] **Step 1: Widen callback signature**

In `src/renderer/src/components/Pane.tsx`, modify line 38:

```ts
// Before:
  const handleVariantChange = useCallback((v: 'medium' | 'high' | 'max') => void window.api.setAgentVariant(id, v), [id])

// After:
  const handleVariantChange = useCallback((v: string | undefined) => void window.api.setAgentVariant(id, v ?? null), [id])
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL — `ChatPanel` props still have the old union. Fixed in Task 10.

- [ ] **Step 3: Commit (after Task 10 fixes typecheck)**

Defer commit.

---

## Task 10: Renderer — `ChatPanel` dynamic picker

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx:2,54-63,679-695`

- [ ] **Step 1: Update props + state**

In `src/renderer/src/components/chat/ChatPanel.tsx`, modify line 2:

```ts
// Before:
import type { AgentMode, ChatEvent, ChatMessage, Command, ModelVariant, QuestionOption, SessionSummary, TodoItem, TodoStatus, ToolCallData } from '@shared/types'

// After:
import type { AgentMode, ChatEvent, ChatMessage, Command, QuestionOption, SessionSummary, TodoItem, TodoStatus, ToolCallData } from '@shared/types'
```

Modify lines 54-63:

```ts
// Before:
interface Props {
  agentId: string
  cwd: string
  mode?: AgentMode
  variant?: ModelVariant
  onModeChange?: (mode: AgentMode) => void
  onVariantChange?: (variant: ModelVariant) => void
}

function ChatPanel({ agentId, cwd, mode = 'build', variant, onModeChange, onVariantChange }: Props) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentMode, setCurrentMode] = useState<AgentMode>(mode)
  const [currentVariant, setCurrentVariant] = useState<ModelVariant>(variant ?? 'high')

// After:
interface Props {
  agentId: string
  cwd: string
  mode?: AgentMode
  variant?: string
  onModeChange?: (mode: AgentMode) => void
  onVariantChange?: (variant: string | undefined) => void
}

function ChatPanel({ agentId, cwd, mode = 'build', variant, onModeChange, onVariantChange }: Props) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentMode, setCurrentMode] = useState<AgentMode>(mode)
  const [currentVariant, setCurrentVariant] = useState<string>(variant ?? '')
  const [availableVariants, setAvailableVariants] = useState<string[]>([])
```

- [ ] **Step 2: Add `refreshVariants` effect**

Add inside the `ChatPanel` component body (right after the existing `useState` calls, before
`useEffect(() => { if (pendingPrompt...)` at line 89):

```ts
  const refreshVariants = useCallback(() => {
    void window.api.getAgentVariants(agentId).then(list => {
      setAvailableVariants(list)
      setCurrentVariant(current => {
        if (current && !list.includes(current)) {
          onVariantChange?.(undefined)
          return ''
        }
        return current
      })
    })
  }, [agentId, onVariantChange])

  useEffect(() => { refreshVariants() }, [refreshVariants])

  useEffect(() => {
    const onModelChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string }>).detail
      if (detail?.agentId === agentId) refreshVariants()
    }
    window.addEventListener('meow:model-changed', onModelChanged)
    return () => window.removeEventListener('meow:model-changed', onModelChanged)
  }, [agentId, refreshVariants])
```

- [ ] **Step 3: Replace variant picker JSX**

In `src/renderer/src/components/chat/ChatPanel.tsx`, replace the existing `<select>` block
(lines 685-695):

```tsx
// Before:
        <select
          className="input chat-variant-select"
          value={currentVariant}
          aria-label="model effort"
          onChange={e => {
            const v = e.target.value as ModelVariant
            setCurrentVariant(v)
            onVariantChange?.(v)
          }}
        >
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="max">max</option>
        </select>

// After:
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
            {availableVariants.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/components/Pane.tsx
git commit -m "feat(renderer): dynamic per-model variant picker"
```

---

## Task 11: Renderer — `ModelPicker` fires model-changed event

**Files:**
- Modify: `src/renderer/src/components/chat/ModelPicker.tsx:78-82`

- [ ] **Step 1: Dispatch event after successful `setAgentModel`**

In `src/renderer/src/components/chat/ModelPicker.tsx`, modify the `onClick` handler (lines 78-82):

```tsx
// Before:
                    onClick={() => {
                      setOpen(false)
                      setCurrent({ provider, model: m })
                      void window.api.setAgentModel(agentId, provider, m)
                    }}

// After:
                    onClick={() => {
                      setOpen(false)
                      setCurrent({ provider, model: m })
                      void window.api.setAgentModel(agentId, provider, m)
                      window.dispatchEvent(new CustomEvent('meow:model-changed', { detail: { agentId } }))
                    }}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/chat/ModelPicker.tsx
git commit -m "feat(renderer): notify variant picker when model changes"
```

---

## Task 12: Snapshot regen script

**Files:**
- Create: `scripts/regen-models-snapshot.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

Create `scripts/regen-models-snapshot.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://models.dev/api.json'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/main/models-snapshot.json')

async function main(): Promise<void> {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as Record<string, unknown>

  const out: Record<string, unknown> = {}
  for (const [pid, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    const prov = p as { name?: unknown; api?: unknown; models?: Record<string, unknown> }
    const models = Object.keys(prov.models ?? {})
    const variants: Record<string, string[]> = {}
    for (const [mid, m] of Object.entries(prov.models ?? {})) {
      if (typeof m !== 'object' || m === null) continue
      const opts = (m as { reasoning_options?: unknown }).reasoning_options
      if (!Array.isArray(opts)) continue
      const effort = opts.find((o: unknown) => {
        return typeof o === 'object' && o !== null && (o as { type?: unknown }).type === 'effort'
      }) as { values?: unknown } | undefined
      if (!effort || !Array.isArray(effort.values)) continue
      const values = (effort.values as unknown[]).filter((v): v is string => typeof v === 'string')
      if (values.length > 0) variants[mid] = values
    }
    out[pid] = {
      name: typeof prov.name === 'string' ? prov.name : pid,
      ...(typeof prov.api === 'string' ? { api: prov.api } : {}),
      models,
      ...(Object.keys(variants).length > 0 ? { variants } : {})
    }
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`Wrote ${OUT} (${Object.keys(out).length} providers)`)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add script to `package.json`**

In `package.json`, add inside `"scripts"`:

```json
    "regen:models": "tsx scripts/regen-models-snapshot.ts",
```

(Check existing scripts for proper comma placement; tsx is already in devDependencies per AGENTS.md.)

- [ ] **Step 3: Run the script to regenerate the snapshot**

Run: `npm run regen:models`

Expected: writes `src/main/models-snapshot.json` with `variants` field on providers whose models have `reasoning_options`. Size grows ~100-300KB.

- [ ] **Step 4: Verify snapshot shape**

Run: `node -e "const s = require('./src/main/models-snapshot.json'); console.log('google variants:', JSON.stringify(s.google?.variants).slice(0, 200))"`

Expected: shows `{"gemini-2.5-pro":["none","low","medium","high","max"], ...}` (or similar shape).

- [ ] **Step 5: Commit**

```bash
git add scripts/regen-models-snapshot.ts src/main/models-snapshot.json package.json
git commit -m "feat(scripts): add regen:models + populate snapshot variants"
```

---

## Task 13: Final verification

**Files:**
- none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS. Specifically check:
- `tests/unit/models-catalog.test.ts` — 8 tests (6 existing + 2 new)
- `tests/unit/llm-variant.test.ts` — 4 tests (rewritten)
- `tests/unit/meow-agent-manager.test.ts` — 3 variant-related tests (1 existing + 2 new)
- `tests/unit/ipc-contract.test.ts` — 1 new assertion for `AgentGetVariants`

- [ ] **Step 3: Manual smoke check (renderer)**

Run: `npm run dev`

Open workspace, add a provider whose model has variants (Gemini or GPT-5). Expected:
- Variant picker renders `[Default, none, low, medium, high, max]` for Gemini 2.5 Pro.
- Changing model via `ModelPicker` triggers picker to refresh.
- Selecting "Default" calls `setAgentVariant(id, null)`; persisted variant cleared in `workspaces.json`.

If `npm run dev` not available, run `npm run build` to ensure the production bundle still type-checks and bundles.

- [ ] **Step 4: Commit any lockfile changes**

```bash
git status
# If package-lock.json changed:
git add package-lock.json
git commit -m "chore: lockfile after regen:models script"
```

(If no changes, skip this step.)

---

## Self-Review Checklist

After completing all tasks:

- [ ] Spec coverage: data model ✓ (Tasks 1, 2), catalog parser ✓ (Task 5), wire-format ✓ (Task 6),
      renderer ✓ (Tasks 9, 10, 11), snapshot regen ✓ (Task 12), validation ✓ (Task 7), tests ✓ (Tasks 5, 6, 7, 8).
- [ ] No placeholder steps ("TBD", "implement later", "similar to").
- [ ] Type consistency: `setAgentVariant` signature is `(agentId, variant: string | null)` everywhere
      (preload, MainApp, AgentApi). `getAvailableVariants` is async (returns `Promise<string[]>`).
      `getVariant` is sync. `LoopDeps.variant` is `string | undefined`.
- [ ] No `ModelVariant` union reference remains (grep `ModelVariant` should return 0 hits).
- [ ] All commits use the project's existing commit-message style.
