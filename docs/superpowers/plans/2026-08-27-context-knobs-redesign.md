# Context Knobs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compaction knobs auto-compute by ratio of the model's context window (buffer 15%, keepTokens 6%, toolOutputMaxChars 1.5%, with floors) instead of fixed 128k-tuned values, reorganize the ContextTab settings UI into Basic + collapsible Advanced (empty = auto, fill = override), and add an `mcpOutputMaxTokens` knob (default 25000) that truncates MCP tool output before it enters context.

**Architecture:** Compaction fields become optional (`undefined` = auto). A new `resolveCompactionSettings(raw, contextLimit, outputReserve)` in `compact.ts` fills auto values at run start, once `LimitsService` has resolved the context limit — mirroring the existing `resolveOutputTokens`/`LimitsService` pattern of "resolve at runtime, never persist computed values." `SessionRunner` caches the resolved compaction and feeds every consumer (`compactIfOverThreshold`, `compact`, `forceCompact`, `pruneToolOutputs`, `hardTruncate`, `toLlmOpts`, `getContextInfo`). MCP output is truncated inside `McpManager`'s `run` wrapper via `TruncationStore`. The UI splits into Basic (always visible) and Advanced (collapsed), where empty inputs patch `undefined` so `normalizeCompaction` omits the field from `meow.json` and the resolver computes it.

**Tech Stack:** TypeScript, Electron main process, React renderer, vitest, `@modelcontextprotocol/sdk`, AI SDK.

**Spec:** `docs/superpowers/specs/2026-08-27-context-knobs-redesign-design.md`

## Global Constraints

- Ratios: `buffer` 0.15, `keepTokens` 0.06, `toolOutputMaxChars` 0.015 (of context window).
- Floors: `buffer` ≥ 10000, `keepTokens` ≥ 4000, `toolOutputMaxChars` ≥ 1500 tokens.
- `keepTokens` guard: `min(autoByRatio, floor(usableContext/2))` where `usable = max(0, contextLimit − outputReserve)`.
- `tailTurns` is NOT scaled (turn count, not tokens); stays a required number with default 2.
- `maxBytes`/`maxLines` (`TruncationStore`) are NOT scaled — absolute byte/line caps for the file-preview path; stay required with current defaults (51200 / 2000).
- `mcpOutputMaxTokens` default 25000; truncation keeps the first `maxTokens` tokens and writes the full output to `TruncationStore`, returning a head preview + file path (existing `TruncationStore.truncate` behavior).
- `contextLimit` unknown on the first run (live `/models` still fetching) → caller passes `DEFAULT_MAX_CONTEXT_TOKENS` (128000) so compaction still works; later runs use the real limit. Never block the first run.
- No migration script: optional fields self-handle legacy `meow.json` (a present `buffer: 20000` is an override that wins over the ratio; deleting the field makes it auto).
- Tests use the model stub / in-memory MCP transport patterns already in `tests/unit/` — never hit a real LLM or MCP server.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/shared/types.ts` | `CompactionSettings` optional fields; `MeowSettings.mcpOutput` | Modify |
| `src/main/agent/compact.ts` | `COMPACTION_RATIOS`, `FLOOR`, `ResolvedCompaction`, `resolveCompactionSettings` | Modify |
| `src/main/agent/config.ts` | `DEFAULT_COMPACTION` trim to auto/tailTurns/prune; `normalizeCompaction` drops `?? DEFAULT`; `normalizeMcpOutput`; `DEFAULT_MCP_OUTPUT_TOKENS`; `configToSettings`/`settingsToConfig` carry `mcpOutput` | Modify |
| `src/main/agent/loop.ts` | `SessionRunner.compaction` cached field; resolve at run start; all consumers use resolved; `toLlmOpts` uses resolved | Modify |
| `src/main/meow-agent-manager.ts` | `getContextInfo` resolves buffer via `resolveCompactionSettings`; wire `McpManager` truncation + `mcpOutputMaxTokens` getter | Modify |
| `src/main/agent/mcp/manager.ts` | `McpManagerDeps.truncation` + `getMcpOutputMaxTokens`; `run` wrapper truncates | Modify |
| `src/renderer/src/components/settings/ContextTab.tsx` | Basic/Advanced reorg; `numOrUndefined`; `auto ≈` placeholders; `mcpOutputMaxTokens` field; optional `resolvedContextTokens` prop | Modify |
| `src/renderer/src/components/settings/SettingsDialog.tsx` | Pass `resolvedContextTokens` (active agent's context limit) to `ContextTab`; pass `mcpOutput` | Modify |
| `tests/unit/agent-compact.test.ts` | `resolveCompactionSettings` unit tests | Modify |
| `tests/unit/agent-config.test.ts` | optional compaction + `mcpOutput` normalize roundtrip | Modify |
| `tests/unit/agent-loop.test.ts` | loop uses auto when config empty; override wins | Modify |
| `tests/unit/agent-mcp-manager.test.ts` | MCP output truncation | Modify |

---

## Task 1: Optional compaction fields + `DEFAULT_COMPACTION` trim

Make `buffer`/`keepTokens`/`toolOutputMaxChars` optional in `CompactionSettings` and stop `normalizeCompaction` from forcing the old fixed defaults, so a missing field means "auto." No behavior change for legacy configs that still carry the numbers.

**Files:**
- Modify: `src/shared/types.ts:289-296`
- Modify: `src/main/agent/config.ts:108-115` (`DEFAULT_COMPACTION`), `216-225` (`normalizeCompaction`)
- Test: `tests/unit/agent-config.test.ts`

**Interfaces:**
- Produces: `CompactionSettings.buffer?: number`, `CompactionSettings.keepTokens?: number`, `CompactionSettings.toolOutputMaxChars?: number` (all `number | undefined`). Later tasks treat `undefined` as "auto."

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/agent-config.test.ts` (inside an existing or new `describe` block — match the file's import of `loadMeowConfig`/`mergeDefaults`/`normalizeCompaction` as already used there):

```ts
import { normalizeCompaction, DEFAULT_COMPACTION } from '../../src/main/agent/config'

describe('normalizeCompaction optional fields', () => {
  it('drops fixed defaults — missing fields become undefined (auto)', () => {
    const out = normalizeCompaction({ auto: true, tailTurns: 2 })
    expect(out.buffer).toBeUndefined()
    expect(out.keepTokens).toBeUndefined()
    expect(out.toolOutputMaxChars).toBeUndefined()
    expect(out.auto).toBe(true)
    expect(out.tailTurns).toBe(2)
    expect(out.prune).toBe(true)
  })

  it('preserves explicit values as overrides', () => {
    const out = normalizeCompaction({ auto: true, tailTurns: 1, buffer: 50000, keepTokens: 12000, toolOutputMaxChars: 4000 })
    expect(out.buffer).toBe(50000)
    expect(out.keepTokens).toBe(12000)
    expect(out.toolOutputMaxChars).toBe(4000)
    expect(out.tailTurns).toBe(1)
  })

  it('DEFAULT_COMPACTION no longer carries fixed token numbers', () => {
    expect(DEFAULT_COMPACTION.buffer).toBeUndefined()
    expect(DEFAULT_COMPACTION.keepTokens).toBeUndefined()
    expect(DEFAULT_COMPACTION.toolOutputMaxChars).toBeUndefined()
    expect(DEFAULT_COMPACTION.auto).toBe(true)
    expect(DEFAULT_COMPACTION.tailTurns).toBe(2)
    expect(DEFAULT_COMPACTION.prune).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-config.test.ts -t "optional fields"`
Expected: FAIL — `normalizeCompaction` still returns `buffer: 20000` from `?? DEFAULT_COMPACTION.buffer`.

- [ ] **Step 3: Make the fields optional in types**

`src/shared/types.ts:289-296` — change to:

```ts
export interface CompactionSettings {
  auto: boolean
  /** Undefined = auto (ratio × context window, with floor). */
  buffer?: number
  /** Undefined = auto. */
  keepTokens?: number
  tailTurns: number
  /** Undefined = auto. */
  toolOutputMaxChars?: number
  prune?: boolean
}
```

- [ ] **Step 4: Trim `DEFAULT_COMPACTION` and `normalizeCompaction`**

`src/main/agent/config.ts:108-115`:

```ts
export const DEFAULT_COMPACTION: MeowCompactionConfig = {
  auto: true,
  tailTurns: 2,
  prune: true
}
```

`src/main/agent/config.ts:216-225`:

```ts
function normalizeCompaction(raw: Partial<MeowCompactionConfig> | undefined): MeowCompactionConfig {
  return {
    auto: raw?.auto ?? DEFAULT_COMPACTION.auto,
    buffer: raw?.buffer,
    keepTokens: raw?.keepTokens,
    tailTurns: raw?.tailTurns ?? DEFAULT_COMPACTION.tailTurns,
    toolOutputMaxChars: raw?.toolOutputMaxChars,
    prune: raw?.prune ?? DEFAULT_COMPACTION.prune
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-config.test.ts -t "optional fields"`
Expected: PASS.

- [ ] **Step 6: Run the full config + compact test suites to catch regressions**

Run: `npx vitest run tests/unit/agent-config.test.ts tests/unit/agent-compact.test.ts tests/unit/agent-loop.test.ts`
Expected: PASS (consumers still read `compaction.buffer` etc. — `undefined` is handled by the resolver added in Task 3; until then the loop path with `auto: true` and a present `maxContextTokens` will compute `usable = limit - undefined - reserve = NaN`. **This is expected and fixed in Task 3** — if a loop test fails here because of `undefined` buffer, confirm it is the compaction-threshold path and proceed; Task 3 makes the loop resolve defaults. If a non-compaction loop test fails, investigate before continuing.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/agent/config.ts tests/unit/agent-config.test.ts
git commit -m "$(cat <<'EOF'
refactor(config): make compaction knob fields optional (undefined = auto)

buffer/keepTokens/toolOutputMaxChars become number | undefined; missing
means auto-resolve by ratio of context window (wired in a later task).
Legacy meow.json values are preserved as overrides. DEFAULT_COMPACTION drops
the fixed 128k-tuned numbers, keeping auto/tailTurns/prune.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `resolveCompactionSettings` resolver + unit tests

Add the runtime resolver that fills auto values from the context limit, with floors and the `keepTokens` guard. Pure function, fully unit-testable.

**Files:**
- Modify: `src/main/agent/compact.ts` (add near `usableContextTokens`, ~line 75)
- Test: `tests/unit/agent-compact.test.ts`

**Interfaces:**
- Consumes: `CompactionSettings` (from `./compact` itself), `DEFAULT_MAX_CONTEXT_TOKENS` (from `./config` — already imported elsewhere; add import here).
- Produces: `ResolvedCompaction` (all numeric fields required) and `resolveCompactionSettings(raw: CompactionSettings, contextLimit: number, outputReserve?: number): ResolvedCompaction`. Later tasks call this at run start.

- [ ] **Step 1: Write the failing test**

Add an import of `resolveCompactionSettings`, `COMPACTION_RATIOS` to the existing import line in `tests/unit/agent-compact.test.ts:2`, then append:

```ts
describe('resolveCompactionSettings', () => {
  const full: CompactionSettings = { auto: true, tailTurns: 2, prune: true }

  it('scales buffer/keepTokens/toolOutputMaxChars by ratio of context window', () => {
    const r = resolveCompactionSettings(full, 200000, 0)
    expect(r.buffer).toBe(Math.round(200000 * COMPACTION_RATIOS.buffer))   // 30000
    expect(r.keepTokens).toBe(Math.round(200000 * COMPACTION_RATIOS.keepTokens)) // 12000
    expect(r.toolOutputMaxChars).toBe(Math.round(200000 * COMPACTION_RATIOS.toolOutputMaxChars)) // 3000
    expect(r.tailTurns).toBe(2)
    expect(r.auto).toBe(true)
  })

  it('applies floors for small context windows', () => {
    const r = resolveCompactionSettings(full, 128000, 0)
    expect(r.buffer).toBeGreaterThanOrEqual(10000)
    expect(r.keepTokens).toBeGreaterThanOrEqual(4000)
    expect(r.toolOutputMaxChars).toBeGreaterThanOrEqual(1500)
  })

  it('override values win over the ratio', () => {
    const r = resolveCompactionSettings(
      { auto: true, tailTurns: 2, buffer: 5000, keepTokens: 5000, toolOutputMaxChars: 500 },
      1000000, 0
    )
    expect(r.buffer).toBe(5000)
    expect(r.keepTokens).toBe(5000)
    expect(r.toolOutputMaxChars).toBe(500)
  })

  it('clamps keepTokens to at most half the usable context', () => {
    // tiny usable so the ratio (6% of 10000 = 600) is fine, but force a
    // path where outputReserve eats most of the window:
    const r = resolveCompactionSettings(full, 10000, 9000)
    const usable = Math.max(0, 10000 - 9000)
    expect(r.keepTokens).toBeLessThanOrEqual(Math.floor(usable / 2))
  })

  it('passes through tailTurns and auto/prune untouched', () => {
    const r = resolveCompactionSettings({ auto: false, tailTurns: 4, prune: false }, 200000, 0)
    expect(r.auto).toBe(false)
    expect(r.tailTurns).toBe(4)
    expect(r.prune).toBe(false)
  })
})
```

Add `import type { CompactionSettings } from '../../src/main/agent/compact'` to the test file's imports if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-compact.test.ts -t "resolveCompactionSettings"`
Expected: FAIL — `resolveCompactionSettings` is not exported.

- [ ] **Step 3: Implement the resolver**

In `src/main/agent/compact.ts`, add after the `usableContextTokens` function (~line 77) and add the `DEFAULT_MAX_CONTEXT_TOKENS` import at the top:

```ts
import { DEFAULT_MAX_CONTEXT_TOKENS } from './config'
```

```ts
/** Ratios of the model's context window used when a knob is left on "auto." */
export const COMPACTION_RATIOS = {
  buffer: 0.15,
  keepTokens: 0.06,
  toolOutputMaxChars: 0.015,
} as const

/** Minimums so a small context window never gets unusably tiny knobs. */
const FLOOR = { buffer: 10000, keepTokens: 4000, toolOutputMaxChars: 1500 }

export interface ResolvedCompaction {
  auto: boolean
  buffer: number
  keepTokens: number
  tailTurns: number
  toolOutputMaxChars: number
  prune?: boolean
}

/**
 * Fills auto (undefined) compaction knobs from the model's context window.
 * Present values are overrides and pass through unchanged. `keepTokens` is
 * clamped to at most half the usable context so the verbatim tail can never
 * consume the whole window. Call with `DEFAULT_MAX_CONTEXT_TOKENS` when the
 * real limit is not yet known (live /models still fetching).
 */
export function resolveCompactionSettings(
  raw: CompactionSettings,
  contextLimit: number,
  outputReserve = 0
): ResolvedCompaction {
  const limit = contextLimit > 0 ? contextLimit : DEFAULT_MAX_CONTEXT_TOKENS
  const pct = (ratio: number, floor: number) => Math.max(floor, Math.round(limit * ratio))
  const usable = Math.max(0, limit - outputReserve)
  const autoKeep = pct(COMPACTION_RATIOS.keepTokens, FLOOR.keepTokens)
  return {
    auto: raw.auto,
    buffer: raw.buffer ?? pct(COMPACTION_RATIOS.buffer, FLOOR.buffer),
    keepTokens: raw.keepTokens ?? Math.min(autoKeep, Math.floor(usable / 2)),
    tailTurns: raw.tailTurns,
    toolOutputMaxChars: raw.toolOutputMaxChars ?? pct(COMPACTION_RATIOS.toolOutputMaxChars, FLOOR.toolOutputMaxChars),
    prune: raw.prune,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-compact.test.ts -t "resolveCompactionSettings"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/compact.ts tests/unit/agent-compact.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): resolveCompactionSettings auto-scales knobs by context window

buffer/keepTokens/toolOutputMaxChars auto-compute as ratio of the model's
context window (15/6/1.5%) with floors (10k/4k/1.5k), mirroring the
resolveOutputTokens pattern of resolving at runtime. keepTokens clamps to
half the usable context. Overrides pass through unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the resolver into `SessionRunner` and `getContextInfo`

Resolve the compaction once at the start of each run (when `maxContextTokens` is known) into a cached `this.compaction: ResolvedCompaction`, and switch every consumer from `this.deps.compaction` to the resolved object. Also fix `getContextInfo` (which reads `cfg.compaction.buffer` directly) to resolve first.

**Files:**
- Modify: `src/main/agent/loop.ts:10` (import), `79-95` (fields/ctor), `97-103` (run start), `376-408` (`compactIfOverThreshold`), `415-427` (`forceCompact`), `430-475` (`compact`), `502-508` (`toLlmOpts`)
- Modify: `src/main/meow-agent-manager.ts:587-609` (`getContextInfo`)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `resolveCompactionSettings`, `ResolvedCompaction` from `./compact` (Task 2); `DEFAULT_MAX_CONTEXT_TOKENS` (already imported in `loop.ts:14`).
- Produces: `SessionRunner` reads `this.compaction` (resolved) instead of `this.deps.compaction` (raw). Behavior with a fully-auto config now compacts at `limit − (15% limit) − reserve`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/agent-loop.test.ts`, find the existing compaction test pattern (the file already builds a `SessionRunner` with a model stub and a `compaction` setting + `maxContextTokens`). Add a test that drives a run with an auto (no buffer/keepTokens/toolOutputMaxChars) compaction config and asserts compaction triggers at the ratio-derived threshold. Match the file's existing helper for constructing the runner (reuse `makeRunner`/`createLlm` stub as already done there):

```ts
describe('SessionRunner compaction auto-resolve', () => {
  it('compacts using ratio-derived buffer when config omits it', async () => {
    // Reuse the file's existing stub runner builder; pass an auto compaction:
    const compaction = { auto: true, tailTurns: 2, prune: true } // no buffer/keepTokens/toolOutputMaxChars
    const maxContextTokens = 200000
    // Build the transcript large enough to exceed limit - 15% - reserve.
    // (Use the same transcript-stuffing helper the existing compaction tests use.)
    const runner = makeRunnerWithTranscript({
      compaction,
      maxContextTokens,
      maxOutputTokens: 8000,
      transcriptTokens: 180000 // above usable = 200000 - 30000 - 8000 = 162000
    })
    let compacted = false
    runner.on('compacted', () => { compacted = true }) // match the file's event spy pattern
    await runner.run()
    expect(compacted).toBe(true)
  })

  it('override buffer wins over the ratio', async () => {
    const compaction = { auto: true, tailTurns: 2, buffer: 100000, prune: true }
    const runner = makeRunnerWithTranscript({
      compaction,
      maxContextTokens: 200000,
      maxOutputTokens: 8000,
      transcriptTokens: 120000 // above usable = 200000 - 100000 - 8000 = 92000
    })
    let compacted = false
    runner.on('compacted', () => { compacted = true })
    await runner.run()
    expect(compacted).toBe(true) // would NOT compact if ratio (30k buffer) were used
  })
})
```

NOTE: `makeRunnerWithTranscript` and the event-spy pattern are placeholders for "do exactly what the existing compaction tests in this file already do to build a runner and detect a compaction event" — when implementing, copy the concrete setup from the nearest existing `it('...compacts...')` test in `agent-loop.test.ts` and only vary the `compaction` config + transcript size. Do not invent a new helper if one already exists; reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "auto-resolve"`
Expected: FAIL — the loop still reads `this.deps.compaction.buffer` (`undefined`), so `usableContextTokens` returns `NaN` and compaction never triggers (or the threshold math breaks).

- [ ] **Step 3: Add the resolved-compaction field and resolve at run start**

`src/main/agent/loop.ts` import line 10 — add `resolveCompactionSettings` and `ResolvedCompaction`:

```ts
import { selectHeadTail, serializeItems, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, pruneToolOutputs, hardTruncate, usableContextTokens, fitHeadToBudget, resolveCompactionSettings } from './compact'
import type { CompactionSettings, ResolvedCompaction } from './compact'
```

`src/main/agent/loop.ts` — add a field after `compactedThisRun` (line 81) and resolve in `run()` after `this.compactedThisRun = 0` (line 101):

```ts
private compaction!: ResolvedCompaction
```

```ts
async run(signal?: AbortSignal): Promise<void> {
  const { agentId } = this.deps
  const system = typeof this.deps.system === 'function' ? this.deps.system() : this.deps.system
  let steps = 0
  this.compactedThisRun = 0
  this.rejectRetriesThisRun = 0
  this.compaction = resolveCompactionSettings(
    this.deps.compaction ?? { auto: false, tailTurns: 2 },
    this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    this.deps.maxOutputTokens ?? 0
  )
  const runUsage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }
```

- [ ] **Step 4: Switch consumers from `this.deps.compaction` to `this.compaction`**

`compactIfOverThreshold` (line 376-408) — replace `const { compaction, maxContextTokens, replaceItems } = this.deps` and uses of `compaction.*` with the resolved object:

```ts
async compactIfOverThreshold(signal?: AbortSignal): Promise<void> {
  const compaction = this.compaction
  const { maxContextTokens, replaceItems } = this.deps
  if (!compaction?.auto || !maxContextTokens || maxContextTokens <= 0 || !replaceItems) return
  const usable = this.compactionTarget(maxContextTokens, compaction.buffer, this.deps.maxOutputTokens)
  let items = this.deps.getItems()
  const opts = this.toLlmOpts()
  const estimate = estimateUsage(toLlmMessages(items, opts))
  const providerTokens = this.lastTokens
    ? this.lastTokens.total ||
      this.lastTokens.input + this.lastTokens.output +
      (this.lastTokens.cacheRead ?? 0) + (this.lastTokens.cacheWrite ?? 0)
    : 0
  const usedTokens = Math.max(estimate, providerTokens)
  if (usedTokens < usable) return
  const pruned = pruneToolOutputs(items, compaction, maxContextTokens)
  if (pruned) {
    replaceItems(items)
    if (estimateUsage(toLlmMessages(items, opts)) < usable) return
  }
  await this.compact(signal)
}
```

`forceCompact` (line 415-427) — replace `const { compaction, replaceItems } = this.deps`:

```ts
private async forceCompact(signal?: AbortSignal): Promise<void> {
  const compaction = this.compaction
  const { replaceItems } = this.deps
  if (!compaction?.auto || !replaceItems) return
  const usable = this.compactionTarget(
    this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    compaction.buffer,
    this.deps.maxOutputTokens
  )
  const items = this.deps.getItems()
  const pruned = pruneToolOutputs(items, compaction, this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS)
  if (pruned) replaceItems(items)
  await this.compact(signal)
}
```

`compact` (line 430-475) — replace `const { compaction, replaceItems } = this.deps`:

```ts
private async compact(signal?: AbortSignal): Promise<void> {
  const compaction = this.compaction
  const { replaceItems } = this.deps
  if (!compaction?.auto || !replaceItems) return
  const usable = this.compactionTarget(
    this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    compaction.buffer,
    this.deps.maxOutputTokens
  )
  const items = this.deps.getItems()
  const opts = this.toLlmOpts()
  const measure = (its: TranscriptItem[]) => estimateUsage(toLlmMessages(its, opts))
  const shrink = () => {
    const truncated = hardTruncate(items, usable, measure)
    if (truncated !== items) replaceItems(truncated)
  }
  const { head, tail } = selectHeadTail(items, compaction.keepTokens, compaction.tailTurns)
  if (head.length === 0 || this.compactedThisRun >= MAX_COMPACT_PER_RUN) {
    shrink()
    return
  }
  const previousSummary = this.findPreviousSummary(items)
  const summarizable = fitHeadToBudget(head, usable, compaction.toolOutputMaxChars)
  const prompt = buildCompactionPrompt(previousSummary, serializeItems(summarizable, compaction.toolOutputMaxChars))
  this.deps.onEvent({ type: 'compaction-start', agentId: this.deps.agentId })
  const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
  if (signal?.aborted) return
  if (!summary) {
    this.deps.onEvent({ type: 'compaction-failed', agentId: this.deps.agentId })
    shrink()
    return
  }
  this.compactedThisRun++
  const now = Date.now()
  const markerItem: TranscriptItem = {
    kind: 'message',
    message: { id: randomUUID(), role: 'user', text: COMPACTION_MARKER, createdAt: now }
  }
  const summaryItem: TranscriptItem = {
    kind: 'message',
    message: { id: randomUUID(), role: 'assistant', text: summary, createdAt: now }
  }
  replaceItems([markerItem, summaryItem, ...tail])
  this.deps.onEvent({ type: 'compacted', agentId: this.deps.agentId, summary })
}
```

`toLlmOpts` (line 502-508) — use the resolved compaction:

```ts
private toLlmOpts(): ToLlmOptions {
  return {
    toolOutputMaxChars: this.compaction?.toolOutputMaxChars,
    keepFullTurns: this.compaction?.tailTurns ?? DEFAULT_KEEP_FULL_TURNS,
    ...this.truncationOpts()
  }
}
```

- [ ] **Step 5: Fix `getContextInfo` to resolve the buffer**

`src/main/meow-agent-manager.ts:587-609` — `cfg.compaction.buffer` is now possibly `undefined`; resolve it. Add the import at the top of the file (alongside the existing `usableContextTokens`/`resolveOutputTokens` imports):

```ts
import { resolveCompactionSettings } from './agent/compact'
```

Replace the `compactThreshold` computation:

```ts
async getContextInfo(agentId: string): Promise<ContextInfo> {
  const agent = this.agents.get(agentId)
  if (!agent) return { limit: null, compactThreshold: null, sessionCost: 0 }
  const cfg = loadMeowConfig(this.deps.configPath)
  const resolved = this.resolveAgentConfig(cfg, agent.name, agent.model, agent.accountId)
  const limits = await this.limitsService.resolveLimits({
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey ?? '',
    overrides: { context: cfg.maxContextTokens, output: cfg.maxOutputTokens }
  })
  const limit = limits.context
  const outputTokens = resolveOutputTokens({ output: limits.output ?? undefined }, limit, DEFAULT_MAX_OUTPUT_TOKENS)
  const compaction = resolveCompactionSettings(cfg.compaction, limit ?? DEFAULT_MAX_CONTEXT_TOKENS, outputTokens)
  const compactThreshold = cfg.compaction.auto && limit
    ? usableContextTokens(limit, compaction.buffer, outputTokens)
    : null
  return {
    limit,
    compactThreshold,
    sessionCost: this.deps.store.getUsage(this.activeSessionId(agentId)).cost
  }
}
```

If `DEFAULT_MAX_CONTEXT_TOKENS` is not already imported in this file, add it to the existing `config` import.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-compact.test.ts`
Expected: PASS. Also run the context-footer e2e if quick: `npx vitest run tests/e2e/context-footer.spec.ts` (skip if slow/unsupported in this environment — note in the commit if skipped).

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/loop.ts src/main/meow-agent-manager.ts tests/unit/agent-loop.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): wire resolveCompactionSettings into the loop and context info

SessionRunner resolves compaction once at run start (when maxContextTokens
is known) and feeds the resolved object to every consumer, so an auto
config (no buffer/keepTokens/toolOutputMaxChars) compacts at ratio-derived
thresholds instead of NaN. getContextInfo resolves the buffer too so the
footer's compactThreshold stays correct with optional fields.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `mcpOutput` config field

Add the `mcpOutput.maxTokens` knob to types, config, and the settings roundtrip. Default is `undefined` → resolved to 25000 at the MCP call site (Task 5).

**Files:**
- Modify: `src/shared/types.ts:316-333` (`MeowSettings`)
- Modify: `src/main/agent/config.ts` (`MeowConfig`, `DEFAULT_MEOW_CONFIG`, `mergeDefaults`, `configToSettings`, `settingsToConfig`)
- Test: `tests/unit/agent-config.test.ts`

**Interfaces:**
- Produces: `MeowConfig.mcpOutput?: { maxTokens?: number }`, `MeowSettings.mcpOutput?: { maxTokens?: number }`, `DEFAULT_MCP_OUTPUT_TOKENS = 25000` (exported from `config.ts`). Task 5 imports `DEFAULT_MCP_OUTPUT_TOKENS`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/agent-config.test.ts`:

```ts
import { DEFAULT_MCP_OUTPUT_TOKENS, mergeDefaults } from '../../src/main/agent/config'

describe('mcpOutput config', () => {
  it('defaults to undefined (auto → DEFAULT_MCP_OUTPUT_TOKENS at call site)', () => {
    const cfg = mergeDefaults({})
    expect(cfg.mcpOutput).toBeUndefined()
    expect(DEFAULT_MCP_OUTPUT_TOKENS).toBe(25000)
  })

  it('preserves an explicit maxTokens override through mergeDefaults', () => {
    const cfg = mergeDefaults({ mcpOutput: { maxTokens: 50000 } })
    expect(cfg.mcpOutput?.maxTokens).toBe(50000)
  })

  it('drops a non-number maxTokens', () => {
    const cfg = mergeDefaults({ mcpOutput: { maxTokens: 'nope' } })
    expect(cfg.mcpOutput?.maxTokens).toBeUndefined()
  })

  it('roundtrips through configToSettings → settingsToConfig', () => {
    const cfg = mergeDefaults({ mcpOutput: { maxTokens: 60000 } })
    const settings = configToSettings(cfg)
    expect(settings.mcpOutput?.maxTokens).toBe(60000)
    const back = settingsToConfig(settings)
    expect(back.mcpOutput?.maxTokens).toBe(60000)
  })
})
```

(Import `configToSettings`/`settingsToConfig` from the same module if not already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-config.test.ts -t "mcpOutput config"`
Expected: FAIL — `mcpOutput` is not a field on `MeowConfig`.

- [ ] **Step 3: Add the type and default**

`src/shared/types.ts` — add to `MeowSettings` (after `toolOutput`):

```ts
  mcpOutput?: { maxTokens?: number }
```

`src/main/agent/config.ts` — add to `MeowConfig` (after `toolOutput: ToolOutputConfig`):

```ts
  mcpOutput?: { maxTokens?: number }
```

Add the default constant near `DEFAULT_TOOL_OUTPUT` (~line 116):

```ts
/** Default cap for MCP tool output entering context when mcpOutput.maxTokens is unset. */
export const DEFAULT_MCP_OUTPUT_TOKENS = 25000
```

Add a normalizer near `normalizeToolOutput`:

```ts
function normalizeMcpOutput(raw: { maxTokens?: number } | undefined): { maxTokens?: number } | undefined {
  if (!raw) return undefined
  const maxTokens = typeof raw.maxTokens === 'number' && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0
    ? raw.maxTokens
    : undefined
  return maxTokens === undefined ? undefined : { maxTokens }
}
```

Wire into `mergeDefaults` (add a `mcpOutput` key returning `normalizeMcpOutput(raw.mcpOutput)`), into `DEFAULT_MEOW_CONFIG` (omit — undefined is the default), into `configToSettings` (add `mcpOutput: cfg.mcpOutput`), and into `settingsToConfig` (add `mcpOutput: normalizeMcpOutput(settings.mcpOutput ?? base.mcpOutput)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-config.test.ts -t "mcpOutput config"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/agent/config.ts tests/unit/agent-config.test.ts
git commit -m "$(cat <<'EOF'
feat(config): add mcpOutput.maxTokens knob (default auto → 25000)

New optional config section caps MCP tool output entering context; unset
means the call site resolves to DEFAULT_MCP_OUTPUT_TOKENS (25000), mirroring
Claude Code MAX_MCP_OUTPUT_TOKENS. Roundtrips through settings ↔ config.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MCP output truncation in `McpManager`

Truncate MCP tool output to `mcpOutputMaxTokens` inside the `run` wrapper, writing the full output to `TruncationStore` and returning its head/tail preview when the limit is exceeded.

**Files:**
- Modify: `src/main/agent/mcp/manager.ts:33-37` (`McpManagerDeps`), `92-120` (`getTools`/`run`)
- Modify: `src/main/meow-agent-manager.ts:98` (`new McpManager()` wiring), `syncTools`
- Test: `tests/unit/agent-mcp-manager.test.ts`

**Interfaces:**
- Consumes: `TruncationStore` (from `../truncation`), `estimateTokens`, `charsForTokens` (from `../token`), `DEFAULT_MCP_OUTPUT_TOKENS` (from `../config`). `ToolContext.agentId` (already exists on `ToolContext`).
- Produces: `McpManagerDeps.truncation?: TruncationStore`, `McpManagerDeps.getMcpOutputMaxTokens?: () => number | undefined`. The `run` wrapper truncates output exceeding the resolved max.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/agent-mcp-manager.test.ts`. The test needs a `TruncationStore` in a temp dir and a server that returns a large string. Add a server factory that echoes arbitrary text:

```ts
function makeBigServer(payload: string): Server {
  const server = new Server({ name: 'big', version: '1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'blob', description: 'big', inputSchema: { type: 'object', properties: {} } }]
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: payload }]
  }))
  return server
}
```

Add the test:

```ts
import { TruncationStore } from '../../src/main/agent/truncation'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

it('truncates MCP output exceeding maxTokens and writes the full output to disk', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-trunc-'))
  const truncation = new TruncationStore(dir)
  // ~60k tokens of text — well over the 25000 default
  const payload = 'x'.repeat(60 * 4000)
  const server = makeBigServer(payload)
  servers.push(server)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)

  const mcp = new McpManager({ createTransport: () => clientSide, truncation, getMcpOutputMaxTokens: () => 25000 })
  managers.push(mcp)
  await mcp.connect({ big: { command: 'node' } })

  const tools = mcp.getTools()
  const r = await tools.get('mcp__big__blob')!.run({}, { ...ctx, agentId: 'agent-1' })
  expect(r.output).toContain('truncated')
  expect(truncation.exists('agent-1', 'mcp__big__blob')).toBe(true)
})

it('passes small MCP output through unchanged', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-trunc-small-'))
  const truncation = new TruncationStore(dir)
  const server = makeBigServer('small payload')
  servers.push(server)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const mcp = new McpManager({ createTransport: () => clientSide, truncation, getMcpOutputMaxTokens: () => 25000 })
  managers.push(mcp)
  await mcp.connect({ big: { command: 'node' } })
  const r = await mcp.getTools().get('mcp__big__blob')!.run({}, { ...ctx, agentId: 'agent-1' })
  expect(r.output).toBe('small payload')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-mcp-manager.test.ts -t "truncates MCP output"`
Expected: FAIL — `McpManagerDeps` has no `truncation`/`getMcpOutputMaxTokens`; output is returned unchanged.

- [ ] **Step 3: Implement truncation in `McpManager`**

`src/main/agent/mcp/manager.ts` — add imports at the top:

```ts
import type { TruncationStore } from '../truncation'
import { estimateTokens, charsForTokens } from '../token'
import { DEFAULT_MCP_OUTPUT_TOKENS } from '../config'
```

Extend `McpManagerDeps` (line 33-37):

```ts
export interface McpManagerDeps {
  createTransport?: (cfg: McpServerConfig) => Transport
  /** Project dir served to servers as workspace root and used as spawn cwd. */
  projectPath?: string
  /** Persists full MCP output when it exceeds the token cap; the model gets a head/tail preview + file path. */
  truncation?: TruncationStore
  /** Returns the current mcpOutput.maxTokens override (undefined = default). */
  getMcpOutputMaxTokens?: () => number | undefined
}
```

In `getTools()`, update the `run` wrapper (currently lines 102-115) to truncate:

```ts
run: async (input, callCtx) => {
  const current = this.connections.get(serverName)
  if (!current) return { error: `MCP server "${serverName}" is not connected` }
  const res = await current.client.callTool({ name: tool.name, arguments: input })
  const content = (res.content ?? []) as Array<{ type: string; text?: string }>
  const texts = content.filter(c => c.type === 'text').map(c => c.text ?? '')
  const text = texts.join('\n')
  if (res.isError) return { error: text || 'mcp tool error' }
  const full = text || JSON.stringify(content)
  const maxTokens = this.deps.getMcpOutputMaxTokens?.() ?? DEFAULT_MCP_OUTPUT_TOKENS
  if (estimateTokens(full) <= maxTokens) return { output: full }
  // Exceeds the cap: persist the full output and return a head preview + file path.
  if (this.deps.truncation && callCtx?.agentId) {
    const preview = this.deps.truncation.truncate(callCtx.agentId, fullName, full, { maxBytes: charsForTokens(maxTokens) })
    return { output: preview }
  }
  return { output: full.slice(0, charsForTokens(maxTokens)) + '\n[truncated]' }
}
```

Note: `callCtx` is the `ToolContext` already passed to `run` (the interface is `run(input, ctx: ToolContext)`); rename the existing wrapper's unused second param from omission to `callCtx`. `fullName` is already in scope (the `mcp__<server>__<tool>` string).

- [ ] **Step 4: Wire deps from `MeowAgentManager`**

`src/main/meow-agent-manager.ts:98` — change:

```ts
private mcp = new McpManager()
```

to

```ts
private mcp = new McpManager({
  truncation: this.deps.truncation,
  getMcpOutputMaxTokens: () => this.cachedMcpOutputMaxTokens
})
```

Add a field + update it in `syncTools()` (which already calls `loadMeowConfig`):

```ts
private cachedMcpOutputMaxTokens: number | undefined = undefined
```

In `syncTools()` (after `const cfg = loadMeowConfig(this.deps.configPath)`):

```ts
this.cachedMcpOutputMaxTokens = cfg.mcpOutput?.maxTokens
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-mcp-manager.test.ts`
Expected: PASS (both the existing echo test and the two new truncation tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/mcp/manager.ts src/main/meow-agent-manager.ts tests/unit/agent-mcp-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): truncate MCP tool output to mcpOutputMaxTokens before context

MCP results exceeding the token cap (default 25000, Claude Code
MAX_MCP_OUTPUT_TOKENS parity) are written to TruncationStore and replaced
with a head/tail preview + file path, so a chatty MCP server cannot fill the
context window. Small results pass through unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ContextTab UI reorg (Basic + Advanced, empty = auto, placeholders)

Reorganize `ContextTab.tsx` into a Basic section (always visible) and a collapsed Advanced section. Empty optional inputs patch `undefined`; placeholders show the auto-computed value when `resolvedContextTokens` is supplied. Add the `mcpOutputMaxTokens` field to Basic. Wire `mcpOutput` and `resolvedContextTokens` through `SettingsDialog`.

**Files:**
- Modify: `src/renderer/src/components/settings/ContextTab.tsx` (whole file)
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx:239-247`
- Test: manual (no component render test in repo) — verify by running the app if the environment allows; otherwise verify the props/onChange logic by reading.

**Interfaces:**
- Consumes: new optional prop `resolvedContextTokens?: number | null` (the active agent's context limit, for `auto ≈` placeholders); `mcpOutput` from the settings draft.
- Produces: `onChange` patches `{ buffer?: number | undefined, keepTokens?: number | undefined, toolOutputMaxChars?: number | undefined, mcpOutput?: { maxTokens?: number } }` — empty inputs yield `undefined`, not 0.

- [ ] **Step 1: Update `ContextTab.tsx`**

Replace the file's content. Key changes: `numOrUndefined` helper; `mcpOutput` in props; optional `resolvedContextTokens` prop; Basic section (maxSteps, auto-compact, mcpOutputMaxTokens); collapsible Advanced section (`<details>`) for buffer/keepTokens/tailTurns/toolOutputMaxChars/maxBytes/maxLines; placeholders compute `auto ≈ ${charsForTokens(resolvedContextTokens * RATIO)}` when `resolvedContextTokens` is a positive number.

```tsx
import type { CompactionSettings, NotificationsSettings, ToolOutputSettings } from '@shared/types'
import { charsForTokens } from '@main/agent/token'

interface Props {
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  notifications: NotificationsSettings
  mcpOutput?: { maxTokens?: number }
  resolvedContextTokens?: number | null
  onChange: (patch: {
    maxSteps: number
    compaction: CompactionSettings
    toolOutput: ToolOutputSettings
    notifications: NotificationsSettings
    mcpOutput?: { maxTokens?: number }
  }) => void
}

function numOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function num(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function displaySteps(n: number): string {
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

const RATIO = { buffer: 0.15, keepTokens: 0.06, toolOutputMaxChars: 0.015 }

export default function ContextTab({ maxSteps, compaction, toolOutput, notifications, mcpOutput, resolvedContextTokens, onChange }: Props) {
  const setMaxSteps = (value: string) =>
    onChange({ maxSteps: num(value, maxSteps), compaction, toolOutput, notifications, mcpOutput })
  const setComp = (patch: Partial<CompactionSettings>) =>
    onChange({ maxSteps, compaction: { ...compaction, ...patch }, toolOutput, notifications, mcpOutput })
  const setToolOutput = (patch: Partial<ToolOutputSettings>) =>
    onChange({ maxSteps, compaction, toolOutput: { ...toolOutput, ...patch }, notifications, mcpOutput })
  const setNotifications = (patch: Partial<NotificationsSettings>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications: { ...notifications, ...patch }, mcpOutput })
  const setMcpOutput = (patch: Partial<NonNullable<typeof mcpOutput>>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications, mcpOutput: { ...mcpOutput, ...patch } })

  const ctx = typeof resolvedContextTokens === 'number' && resolvedContextTokens > 0 ? resolvedContextTokens : null
  const auto = (key: keyof typeof RATIO) => ctx ? `auto ≈ ${charsForTokens(ctx * RATIO[key])}` : 'auto'

  return (
    <div className="settings-tab context-tab">
      <section className="settings-section">
        <h4 className="settings-section-header">Limits</h4>
        <div className="settings-field">
          <label className="label">Max steps per turn</label>
          <input className="input" type="number" min={1} value={displaySteps(maxSteps)} placeholder="unlimited"
            onChange={e => setMaxSteps(e.target.value)} />
          <p className="settings-hint">Maximum tool steps before the agent is forced to wrap up (empty = unlimited).</p>
        </div>
        <div className="settings-field">
          <label className="settings-check">
            <input type="checkbox" checked={compaction.auto} onChange={e => setComp({ auto: e.target.checked })} />
            Auto-compact context when approaching the limit
          </label>
        </div>
        <div className="settings-field">
          <label className="label">MCP output max tokens</label>
          <input className="input" type="number" min={1000} value={mcpOutput?.maxTokens ?? ''} placeholder="25000"
            onChange={e => setMcpOutput({ maxTokens: numOrUndefined(e.target.value) })} />
          <p className="settings-hint">MCP tool results larger than this are written to a file and replaced by a preview. Empty = 25000.</p>
        </div>
      </section>

      <details className="settings-section">
        <summary className="settings-section-header">Advanced (compaction tuning — empty = auto)</summary>
        <div className="settings-field">
          <label className="label">Buffer (tokens)</label>
          <input className="input" type="number" min={1000} value={compaction.buffer ?? ''} placeholder={auto('buffer')}
            onChange={e => setComp({ buffer: numOrUndefined(e.target.value) })} />
          <p className="settings-hint">Tokens reserved for the model output before compaction triggers. Empty = auto.</p>
        </div>
        <div className="settings-field">
          <label className="label">Keep recent tokens</label>
          <input className="input" type="number" min={1000} value={compaction.keepTokens ?? ''} placeholder={auto('keepTokens')}
            onChange={e => setComp({ keepTokens: numOrUndefined(e.target.value) })} />
          <p className="settings-hint">Tokens of the recent tail kept verbatim during compaction. Empty = auto.</p>
        </div>
        <div className="settings-field">
          <label className="label">Tail turns</label>
          <input className="input" type="number" min={0} value={compaction.tailTurns}
            onChange={e => setComp({ tailTurns: num(e.target.value, compaction.tailTurns) })} />
          <p className="settings-hint">Recent turns kept verbatim during compaction.</p>
        </div>
        <div className="settings-field">
          <label className="label">Tool output max chars</label>
          <input className="input" type="number" min={100} value={compaction.toolOutputMaxChars ?? ''} placeholder={auto('toolOutputMaxChars')}
            onChange={e => setComp({ toolOutputMaxChars: numOrUndefined(e.target.value) })} />
          <p className="settings-hint">Tool results sent to the model are truncated to this many characters. Empty = auto.</p>
        </div>
        <div className="settings-field">
          <label className="label">Tool output max bytes</label>
          <input className="input" type="number" min={1000} value={toolOutput.maxBytes}
            onChange={e => setToolOutput({ maxBytes: num(e.target.value, toolOutput.maxBytes) })} />
          <p className="settings-hint">Tool results larger than this are written to a file and replaced by a head/tail preview.</p>
        </div>
        <div className="settings-field">
          <label className="label">Tool output max lines</label>
          <input className="input" type="number" min={100} value={toolOutput.maxLines}
            onChange={e => setToolOutput({ maxLines: num(e.target.value, toolOutput.maxLines) })} />
          <p className="settings-hint">Maximum lines kept in the tool-result preview.</p>
        </div>
      </details>

      <section className="settings-section">
        <h4 className="settings-section-header">Notifications</h4>
        <div className="settings-field">
          <label className="settings-check">
            <input type="checkbox" checked={notifications.needsInput} onChange={e => setNotifications({ needsInput: e.target.checked })} />
            Notify when the agent needs input
          </label>
        </div>
        <div className="settings-field">
          <label className="settings-check">
            <input type="checkbox" checked={notifications.onDone} onChange={e => setNotifications({ onDone: e.target.checked })} />
            Notify when a turn finishes or errors
          </label>
        </div>
      </section>
    </div>
  )
}
```

If `@main/agent/token` is not an importable alias from the renderer, import via the shared path the renderer already uses for token helpers (check how `ContextFooter.tsx` imports `charsForTokens`/`estimateTokens` and mirror that import — do not invent an alias). If the renderer cannot import main-process `token.ts` directly, move `charsForTokens` usage to a value computed in the main process and passed as a prop instead; prefer mirroring `ContextFooter`'s existing import.

- [ ] **Step 2: Update `SettingsDialog.tsx` wiring**

`src/renderer/src/components/settings/SettingsDialog.tsx:239-247` — pass `mcpOutput` and `resolvedContextTokens`:

```tsx
{draft && tab === 'context' && (
  <ContextTab
    maxSteps={draft.maxSteps}
    compaction={draft.compaction}
    toolOutput={draft.toolOutput}
    notifications={draft.notifications ?? { needsInput: true, onDone: true }}
    mcpOutput={draft.mcpOutput}
    resolvedContextTokens={activeContextLimit}
    onChange={ctx => patch(ctx)}
  />
)}
```

Add `draft.mcpOutput?: { maxTokens?: number }` to the settings draft type if it is a separate type from `MeowSettings` (follow how `draft.toolOutput` is typed). For `activeContextLimit`: the dialog does not currently subscribe to context info. Add a one-shot fetch on mount via `window.api.getContextInfo(activeAgentId)` (mirror `ChatPanel.tsx:164-172`'s `loadContextInfo` pattern), store in state, and pass as `resolvedContextTokens`. If there is no notion of an "active agent id" in the settings dialog, fetch for the first registered agent; if none, pass `null` (placeholders fall back to "auto"). Keep this wiring minimal — a single `useEffect` + `useState<number | null>(null)`.

- [ ] **Step 3: Typecheck and run unit tests**

Run: `npx tsc --noEmit` (or the project's typecheck script — check `package.json` `scripts` for `typecheck`/`build`).
Run: `npx vitest run tests/unit/agent-config.test.ts tests/unit/agent-compact.test.ts tests/unit/agent-loop.test.ts tests/unit/agent-mcp-manager.test.ts`
Expected: PASS (no behavioral change to unit tests; this task is renderer + types).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/ContextTab.tsx src/renderer/src/components/settings/SettingsDialog.tsx
git commit -m "$(cat <<'EOF'
feat(settings): ContextTab Basic + Advanced, empty = auto, MCP token knob

Basic shows max steps, auto-compact toggle, and the new MCP output max
tokens. Compaction tuning (buffer/keepTokens/tailTurns/toolOutputMaxChars/
maxBytes/maxLines) collapses under Advanced; empty inputs patch undefined
(= auto-resolved by ratio of context window) and placeholders show the
auto-computed value for the active agent's model.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Sync AGENTS.md docs

Update the docs that describe the changed files so the docs match the new behavior.

**Files:**
- Modify: `src/main/agent/AGENTS.md:22` (`compact.ts` row)
- Modify: `src/main/agent/AGENTS.md:14` (`config.ts` row)
- Modify: `src/main/agent/mcp/AGENTS.md` (`manager.ts` row)
- Modify: `src/renderer/src/components/settings/AGENTS.md:16` (`ContextTab.tsx` row)

- [ ] **Step 1: Update `compact.ts` row in `src/main/agent/AGENTS.md:22`**

```md
| `compact.ts` | Context compaction: `usableContextTokens` (buffer + output reserve), `resolveCompactionSettings` (auto-scales buffer/keepTokens/toolOutputMaxChars by ratio of context window with floors; `keepTokens` clamped to half usable), `truncateToolOutput`, `fitHeadToBudget`, `hardTruncate` (last-resort shrink), `pruneToolOutputs`. |
```

- [ ] **Step 2: Update `config.ts` row in `src/main/agent/AGENTS.md:14`**

Append to the existing description: " `mcpOutput.maxTokens` (default `DEFAULT_MCP_OUTPUT_TOKENS` 25000) caps MCP tool output; `compaction` numeric knobs are optional (undefined = auto-resolved by `resolveCompactionSettings`)."

- [ ] **Step 3: Update `manager.ts` row in `src/main/agent/mcp/AGENTS.md`**

Add that `McpManagerDeps` now accepts `truncation` + `getMcpOutputMaxTokens`, and the `run` wrapper truncates output exceeding the cap to a `TruncationStore` preview.

- [ ] **Step 4: Update `ContextTab.tsx` row in `src/renderer/src/components/settings/AGENTS.md:16`**

```md
| `ContextTab.tsx` | Context/compaction settings: max steps, auto-compact, MCP output max tokens (Basic) + collapsible Advanced (buffer/keepTokens/tailTurns/toolOutputMaxChars/maxBytes/maxLines). Empty optional fields = auto-resolved by ratio of context window; placeholders show the auto value for the active agent. |
```

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AGENTS.md src/main/agent/mcp/AGENTS.md src/renderer/src/components/settings/AGENTS.md
git commit -m "$(cat <<'EOF'
docs(agent): sync AGENTS.md with context-knobs redesign

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed inline)

**1. Spec coverage:**
- Auto-scale buffer/keepTokens/toolOutputMaxChars by ratio + floor → Task 2 + Task 3. ✓
- `tailTurns` not scaled → Task 1 (stays required, default 2). ✓
- `maxBytes`/`maxLines` not scaled → Task 6 (required, Advanced). ✓
- `mcpOutput.maxTokens` (default 25000) → Task 4 (config) + Task 5 (truncation). ✓
- UI Basic + Advanced collapse, empty = auto, placeholder `auto ≈` → Task 6. ✓
- Runtime resolve, never persist computed → Task 3 (resolve at run start). ✓
- `contextLimit` unknown on first run → Task 2 (`DEFAULT_MAX_CONTEXT_TOKENS` fallback in resolver) + Task 3 (passes `maxContextTokens ?? DEFAULT`). ✓
- No migration → Task 1 (optional fields preserve legacy overrides). ✓
- `getContextInfo` resolves buffer → Task 3 Step 5. ✓
- keepTokens guard `≤ usable/2` → Task 2. ✓

**2. Placeholder scan:** No TBD/TODO/“add error handling”. The one "NOTE" in Task 3 Step 1 instructs the implementer to reuse the file's existing runner-builder rather than invent one — it names the concrete existing pattern to copy, which is guidance, not a placeholder. The renderer import caveat in Task 6 Step 1 names the fallback (mirror `ContextFooter`'s import) concretely.

**3. Type consistency:** `ResolvedCompaction` (Task 2) is consumed by `this.compaction` (Task 3). `McpManagerDeps.truncation`/`getMcpOutputMaxTokens` (Task 5) match the wiring in `MeowAgentManager` (Task 5 Step 4) and the test (Task 5 Step 1). `DEFAULT_MCP_OUTPUT_TOKENS` exported from `config.ts` (Task 4) imported by `manager.ts` (Task 5). `mcpOutput` shape `{ maxTokens?: number }` consistent across types (Task 4), config (Task 4), `ContextTab` props (Task 6), `SettingsDialog` (Task 6). `numOrUndefined` (Task 6) returns `number | undefined`, matching the optional `CompactionSettings` fields (Task 1).