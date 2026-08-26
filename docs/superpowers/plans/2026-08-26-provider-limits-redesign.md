# Provider Limits Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay "một catalog tĩnh + một setting" bằng hệ thống phân giải giới hạn nhiều tầng theo mô hình *"trust the provider, verify by error"* — tự khám phá giới hạn thật từ provider lúc runtime, `max_tokens` chỉ gửi khi đã xác minh (không biết thì bỏ hẳn), và tự sửa mọi lỗi giới hạn (max_tokens reject → retry + learn; context overflow → force-compact + retry) thay vì làm chết cả turn.

**Architecture:** `LimitsService.resolveLimits()` hợp nhất 4 nguồn theo thứ tự ưu tiên (overrides → learned → live `/models` → catalog) và trả `{ context, output: number | null }`. `LearnedLimitsStore` persist giới hạn khám phá được từ lỗi thật vào `userData/learned-limits.json` (debounced). Loop tách `compact()` khỏi `compactIfOverThreshold`, thêm `forceCompact()` + `tryRecoverFromReject()` để compact-and-retry khi provider reject context overflow, và tách wire vs reserve: `maxOutputTokensWire` gửi đi còn `maxOutputTokens` chỉ dùng cho toán compaction.

**Tech Stack:** Electron 41 · electron-vite 5 · React 19 · TypeScript strict · `ai@^6.0.241` + `@ai-sdk/anthropic@^3.0.105` + `@ai-sdk/google` + `@ai-sdk/openai-compatible` · Vitest (unit) · Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-26-provider-limits-redesign-design.md` — plan này triển khai spec Section 8 (9 bước → 8 task), mọi quyết định thiết kế lấy từ spec Section 2, 4, 5, 6, 7.

## Global Constraints

- **TypeScript strict** — `npm run typecheck` (4× tsc) phải xanh sau **mỗi task**.
- **`npm test` phải xanh sau mỗi task.** Baseline đã xác minh: 96 file test / 930 tests pass, exit 0. `npm test` = `vitest run --passWithNoTests`.
- **TDD:** mỗi task viết test trước → chạy thấy FAIL → implement tối thiểu → chạy PASS → commit. Mỗi task commit riêng.
- **Commit message** theo convention hiện tại (`feat|fix|refactor(scope): ...`), kết thúc bằng `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Quy tắc docs sync:** AGENTS.md phải được cập nhật trong cùng commit với code liên quan (Task 8 rà toàn bộ).
- **Điều lệch so với spec (đã xác minh trước khi viết plan):** tầng AI SDK `getModelConfig` **KHÔNG tồn tại** trong `ai@^6.0.241` / `@ai-sdk/anthropic@^3.0.105` (đã grep `getModelConfig`, không thấy export). Precedence thực thi là: **overrides → learned → live `/models` → catalog (cap `MAX_OUTPUT_HARD_CAP`) → default 128k / output null**. Không có code tầng SDK. Spec Section 2 dòng "Nguồn giới hạn" coi đây là điều lệch đã được chốt ở brainstorming.
- **Wire vs reserve:** `maxOutputTokensWire` = output đã xác minh, gửi provider làm `max_tokens`; `undefined` = **omit hẳn** (provider tự chọn — không thể lỗi `max_tokens exceeds`). `maxOutputTokens` = reserve, chỉ dùng cho `usableContextTokens`/footer. reserve = `resolveOutputTokens({ output: wire ?? undefined }, context, DEFAULT_MAX_OUTPUT_TOKENS)`.
- **Live `/models` là fetch nền:** `LimitsService.liveInfo()` là synchronous, cache miss → kick background fetch (không await trong `register()`), `livePending` Set để dedupe, cache theo `${baseUrl}|${apiKey}` với `LIVE_MODELS_TTL_MS = 5*60_000`.
- **Single-chain precedence:** nguồn đầu tiên có **bất kỳ** field nào (`context` hoặc `output`) thắng toàn bộ; field còn thiếu → `context ?? DEFAULT_MAX_CONTEXT_TOKENS` (128000) / `output ?? null`. Overrides cũng cùng luật (set 1 field → thắng, field kia về default).
- **Cap output chỉ cho catalog:** `output` từ catalog bị `min(x, MAX_OUTPUT_HARD_CAP)` (claim 1M có thể vô lý); learned/live là sự thật của endpoint → giữ nguyên giá trị.
- **Self-healing bounded:** `MAX_COMPACT_PER_RUN = 2` (compact/context-overflow), `maxAttempts = 3` (retry). Hết khả năng tự sửa → emit lỗi thật một lần, không loop vô hạn.
- **Retry sau compact không tốn step:** `tryRecoverFromReject` return true → `steps--` → `continue`.
- **`src/shared/*` chỉ chứa type thuần** — không import Node/Electron.
- **Ngoài phạm vi** (spec Section 1): probe request riêng, đổi IPC contract, đổi `compaction` settings, `maxSteps`/subagent, task tool (giữ `maxContextTokens`/`maxOutputTokens` như cũ).
- Code comments giải thích luồng bằng tiếng Việt (theo convention repo), tên định danh tiếng Anh.
- Test dùng stub LLM — không bao giờ gọi API thật.

---

### Task 1: LearnedLimitsStore

**Files:**
- Create: `src/main/agent/learned-limits.ts`
- Test: `tests/unit/agent-learned-limits.test.ts`

**Interfaces:**
- Consumes: `JsonStore<T>` (`src/main/json-store.ts`, đã có: `{ load(): T[]; save(items: T[]): void; flush?(): void }`).
- Produces:
  - `export interface LearnedLimitEntry { key: string; context?: number; output?: number }`
  - `export function normalizeLearnedKey(baseUrl: string | undefined, model: string): string`
  - `export class LearnedLimitsStore` — `constructor(store: JsonStore<LearnedLimitEntry>)`, `get(key: string): LearnedLimitEntry | undefined`, `recordMaxTokensLimit(key: string, realLimit: number): void`, `recordContextOverflow(key: string, promptTokens: number): void`.
  - Task 3 dùng `get()`, Task 7 dùng `recordMaxTokensLimit()`/`recordContextOverflow()`.

- [ ] **Step 1: Viết test fail**

```ts
import { describe, expect, it } from 'vitest'
import { LearnedLimitsStore, normalizeLearnedKey } from '../../src/main/agent/learned-limits'
import type { LearnedLimitEntry } from '../../src/main/agent/learned-limits'
import type { JsonStore } from '../../src/main/json-store'

// Lưu ý: tên hàm phải là `makeStore`, không được là `store` — dùng `const { store } = store([...])`
// trong cùng block scope khiến RHS `store([...])` trỏ vào binding `const store` (TDZ) → ReferenceError
// bất kể implementation thế nào. Đã phát hiện khi thực thi Task 1 (Ruling 2 trong ledger).
function makeStore(initial: LearnedLimitEntry[] = []) {
  const data: LearnedLimitEntry[] = [...initial]
  const json: JsonStore<LearnedLimitEntry> = {
    load: () => data,
    save: (next) => data.splice(0, data.length, ...next)
  }
  return { store: new LearnedLimitsStore(json), data }
}

describe('normalizeLearnedKey', () => {
  it('keys by baseUrl|model, tolerating a missing base url', () => {
    expect(normalizeLearnedKey('https://ollama.com/v1', 'deepseek-v4-flash')).toBe('https://ollama.com/v1|deepseek-v4-flash')
    expect(normalizeLearnedKey(undefined, 'deepseek-v4-flash')).toBe('|deepseek-v4-flash')
  })
})

describe('LearnedLimitsStore', () => {
  it('loads existing entries and serves them by key', () => {
    const { store } = store([{ key: 'a|m', context: 64000, output: 65536 }])
    expect(store.get('a|m')).toEqual({ key: 'a|m', context: 64000, output: 65536 })
    expect(store.get('nope')).toBeUndefined()
  })

  it('records a max_tokens limit and persists it', () => {
    const { store, data } = store()
    store.recordMaxTokensLimit('a|m', 65536)
    expect(store.get('a|m')?.output).toBe(65536)
    expect(data).toEqual([{ key: 'a|m', output: 65536 }])
  })

  it('never raises an already-learned output cap', () => {
    const { store } = store([{ key: 'a|m', output: 65536 }])
    store.recordMaxTokensLimit('a|m', 131072)
    expect(store.get('a|m')?.output).toBe(65536)
  })

  it('records a context ceiling only when it shrinks', () => {
    const { store } = store([{ key: 'a|m', context: 200000 }])
    store.recordContextOverflow('a|m', 50000)
    expect(store.get('a|m')?.context).toBe(50000)
    store.recordContextOverflow('a|m', 80000) // larger ceiling is no tighter
    expect(store.get('a|m')?.context).toBe(50000)
  })

  it('merges a new limit with the existing entry', () => {
    const { store } = store([{ key: 'a|m', output: 65536 }])
    store.recordContextOverflow('a|m', 50000)
    expect(store.get('a|m')).toEqual({ key: 'a|m', output: 65536, context: 50000 })
  })
})
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-learned-limits.test.ts`
Expected: FAIL với "Cannot find module ... learned-limits" (module chưa tồn tại).

- [ ] **Step 3: Implement `learned-limits.ts`**

```ts
import type { JsonStore } from '../json-store'

export interface LearnedLimitEntry {
  key: string
  context?: number
  output?: number
}

// Khóa theo endpoint thật, không phải theo id provider: cùng một model catalog
// (vd deepseek-v4-flash) có giới hạn thật khác nhau giữa ollama-cloud và một
// box tự host — học lẫn nhau giữa hai endpoint là sai.
export function normalizeLearnedKey(baseUrl: string | undefined, model: string): string {
  return `${baseUrl ?? ''}|${model}`
}

/**
 * Giới hạn khám phá được từ chính provider (qua lỗi reject), persist trong
 * userData/learned-limits.json (debounced bởi createJsonStore ở caller).
 * Chỉ bao giờ siết chặt hơn — không nâng lên: catalog có thể vẫn khai quá,
 * một giá trị wire lớn hơn chỉ tái phát lỗi 400 vừa mới học được.
 */
export class LearnedLimitsStore {
  private cache = new Map<string, LearnedLimitEntry>()

  constructor(private store: JsonStore<LearnedLimitEntry>) {
    for (const entry of store.load()) {
      if (entry && typeof entry.key === 'string') this.cache.set(entry.key, entry)
    }
  }

  get(key: string): LearnedLimitEntry | undefined {
    return this.cache.get(key)
  }

  /** Provider đã đích danh output cap thật trong một lần reject max_tokens. */
  recordMaxTokensLimit(key: string, realLimit: number): void {
    const current = this.cache.get(key)
    if (current && current.output !== undefined && current.output <= realLimit) return
    this.cache.set(key, { ...current, key, output: realLimit })
    this.persist()
  }

  /**
   * Một reject context-overflow chặn context thật ở cỡ prompt bị reject.
   * Chỉ thu hẹp trần đã lưu — giá trị lớn hơn sẽ làm compaction trễ hơn mức
   * thực tế đã fail.
   */
  recordContextOverflow(key: string, promptTokens: number): void {
    const current = this.cache.get(key)
    if (current && current.context !== undefined && current.context <= promptTokens) return
    this.cache.set(key, { ...current, key, context: promptTokens })
    this.persist()
  }

  private persist(): void {
    this.store.save([...this.cache.values()])
  }
}
```

- [ ] **Step 4: Chạy test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-learned-limits.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/learned-limits.ts tests/unit/agent-learned-limits.test.ts
git commit -m "feat(agent): learned-limits store for provider-verified token caps"
```

---

### Task 2: Limits parsing helpers + live /models metadata

**Files:**
- Create: `src/main/agent/limits.ts`
- Modify: `src/main/models-catalog.ts` (interface `LiveModelInfo` gần `ModelLimit` dòng 8-11; thêm import `parseLiveModelsInfo`; sửa `fetchLiveModels` dòng 164-177)
- Test: `tests/unit/agent-limits.test.ts` (helpers) + `tests/unit/models-catalog.test.ts` (fetchLiveModelsInfo)

**Interfaces:**
- Consumes: `LiveModelInfo` (định nghĩa ở models-catalog trong task này), `MAX_OUTPUT_HARD_CAP`/`DEFAULT_MAX_CONTEXT_TOKENS` từ `./config` (Task 3 dùng).
- Produces (trong `src/main/agent/limits.ts`):
  - `export function parseLiveModelsInfo(body: unknown): LiveModelInfo[]`
  - `export function matchModel(liveId: string, modelId: string): boolean`
  - `export function classifyContextOverflowError(message: string | undefined): boolean`
  - `export function parseContextLimitFromError(message: string | undefined): number | undefined`
- Produces (trong `src/main/models-catalog.ts`):
  - `export interface LiveModelInfo { id: string; context?: number; output?: number }`
  - `async fetchLiveModelsInfo(baseUrl: string, apiKey: string): Promise<LiveModelInfo[] | null>`
- Task 3 dùng `parseLiveModelsInfo`/`matchModel`; Task 5 dùng `classifyContextOverflowError`; Task 7 dùng `parseContextLimitFromError`.

- [ ] **Step 1: Viết test helpers fail**

```ts
import { describe, expect, it } from 'vitest'
import {
  parseLiveModelsInfo, matchModel, classifyContextOverflowError, parseContextLimitFromError
} from '../../src/main/agent/limits'

describe('parseLiveModelsInfo', () => {
  it('reads context/output from any of the known field names', () => {
    const out = parseLiveModelsInfo({
      data: [
        { id: 'a', context_window: 131072, max_output_tokens: 65536 },
        { id: 'b', max_context_length: 200000, max_tokens: 8192 },
        { id: 'c', context_length: 128000, output_tokens: 4096 }
      ]
    })
    expect(out).toEqual([
      { id: 'a', context: 131072, output: 65536 },
      { id: 'b', context: 200000, output: 8192 },
      { id: 'c', context: 128000, output: 4096 }
    ])
  })

  it('keeps entries without limits and skips garbage', () => {
    expect(parseLiveModelsInfo({ data: [{ id: 'a' }, 42, { id: 'b', context_window: 1000 }] }))
      .toEqual([{ id: 'a' }, { id: 'b', context: 1000 }])
    expect(parseLiveModelsInfo({})).toEqual([])
    expect(parseLiveModelsInfo(null)).toEqual([])
    expect(parseLiveModelsInfo(undefined)).toEqual([])
  })
})

describe('matchModel', () => {
  it('matches exact ids', () => {
    expect(matchModel('deepseek-v4-flash', 'deepseek-v4-flash')).toBe(true)
  })
  it('matches a server :tag against the bare catalog id', () => {
    expect(matchModel('deepseek-v4-flash:0731', 'deepseek-v4-flash')).toBe(true)
    expect(matchModel('deepseek-v4-flash', 'deepseek-v4-flash:0731')).toBe(true)
  })
  it('falls back to containment for namespaced server ids', () => {
    expect(matchModel('accounts/fireworks/models/llama-v3p1-70b-instruct', 'llama-v3p1-70b-instruct')).toBe(true)
  })
  it('rejects unrelated ids', () => {
    expect(matchModel('gpt-5', 'deepseek-v4-flash')).toBe(false)
  })
})

describe('classifyContextOverflowError', () => {
  it('recognizes the known rejection shapes', () => {
    for (const msg of [
      'prompt is too long: 19000 tokens > 16000 maximum',
      'This model\'s maximum context length is 128000 tokens',
      'The request exceeded the maximum context length',
      'context_length_exceeded: requested 200000 tokens',
      'input exceeds the context window of the model',
      'Please reduce the length of the messages or completion'
    ]) {
      expect(classifyContextOverflowError(msg), msg).toBe(true)
    }
  })
  it('ignores unrelated errors, including a max_tokens rejection', () => {
    expect(classifyContextOverflowError('max_tokens (131072) exceeds model\'s maximum output tokens (65536)')).toBe(false)
    expect(classifyContextOverflowError('bad api key')).toBe(false)
    expect(classifyContextOverflowError(undefined)).toBe(false)
  })
})

describe('parseContextLimitFromError', () => {
  it('extracts the cap from OpenAI and Anthropic messages', () => {
    expect(parseContextLimitFromError('This model\'s maximum context length is 128000 tokens. However, you requested 200000 tokens.')).toBe(128000)
    expect(parseContextLimitFromError('prompt is too long: 19000 tokens > 16000 maximum')).toBe(16000)
  })
  it('returns undefined when no cap is named', () => {
    expect(parseContextLimitFromError('context_length_exceeded')).toBeUndefined()
    expect(parseContextLimitFromError(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-limits.test.ts`
Expected: FAIL với "Cannot find module ... limits".

- [ ] **Step 3: Implement `limits.ts` (phần helpers)**

```ts
import type { LiveModelInfo } from '../models-catalog'

// Field của response /models OpenAI-compatible có thể mang context/output dưới
// nhiều tên khác nhau (Ollama Cloud, các proxy); mỗi danh sách thử theo thứ tự.
const CONTEXT_FIELDS = ['context_window', 'max_context_length', 'context_length'] as const
const OUTPUT_FIELDS = ['max_output_tokens', 'max_tokens', 'output_tokens'] as const

export function parseLiveModelsInfo(body: unknown): LiveModelInfo[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: LiveModelInfo[] = []
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue
    const m = raw as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id) continue
    const context = firstNumber(m, CONTEXT_FIELDS)
    const output = firstNumber(m, OUTPUT_FIELDS)
    out.push({
      id: m.id,
      ...(context !== undefined ? { context } : {}),
      ...(output !== undefined ? { output } : {})
    })
  }
  return out
}

function firstNumber(m: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const value = m[field]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

// Server-side model tag có thể lệch với id cấu hình (Ollama Cloud phục vụ
// `deepseek-v4-flash:0731` trong khi config/catalog nói `deepseek-v4-flash`).
// Bỏ :tag trước, rồi containment cho id có namespace (Fireworks).
export function matchModel(liveId: string, modelId: string): boolean {
  if (liveId === modelId) return true
  const stripTag = (id: string) => id.split(':')[0]
  if (stripTag(liveId) === stripTag(modelId)) return true
  if (liveId.includes(modelId) || modelId.includes(liveId)) return true
  return false
}

const CONTEXT_OVERFLOW_PATTERNS = [
  'prompt is too long',
  'context length exceeded',
  'maximum context length',
  'context_length_exceeded',
  'exceeds the context window',
  'please reduce the length of the messages'
] as const

export function classifyContextOverflowError(message: string | undefined): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => lower.includes(pattern))
}

/**
 * Trần context thật mà provider đích danh trong message reject, khi có.
 * Ngược lại undefined — caller rơi về cỡ prompt bị reject làm trần.
 */
export function parseContextLimitFromError(message: string | undefined): number | undefined {
  if (!message) return undefined
  // OpenAI: "This model's maximum context length is 128000 tokens"
  const maxContext = message.match(/maximum\s+context\s+(?:length|window)[^\d]*(\d+)/i)
  if (maxContext) return Number(maxContext[1])
  // Anthropic: "prompt is too long: 19000 tokens > 16000 maximum"
  const tooLong = message.match(/tokens?\s*[>≥]+\s*(\d+)\s*maximum/i)
  if (tooLong) return Number(tooLong[1])
  // Generic: "maximum is 128000" / "max: 128000"
  const maxIs = message.match(/\bmax(?:imum)?\s*(?:is|:)\s*(\d+)/i)
  if (maxIs) return Number(maxIs[1])
  return undefined
}
```

- [ ] **Step 4: Viết test `fetchLiveModelsInfo` fail** (thêm vào `tests/unit/models-catalog.test.ts`)

Thêm vào cuối describe `ModelsCatalog`:

```ts
  it('parses live /models limits into fetchLiveModelsInfo', async () => {
    const fetchFn = async () => jsonResponse({
      data: [
        { id: 'deepseek-v4-flash:0731', context_window: 131072, max_output_tokens: 65536 },
        { id: 'plain-model' }
      ]
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    expect(await catalog.fetchLiveModelsInfo('https://ollama.com/v1', 'sk')).toEqual([
      { id: 'deepseek-v4-flash:0731', context: 131072, output: 65536 },
      { id: 'plain-model' }
    ])
  })

  it('fetchLiveModelsInfo returns null on a non-ok response', async () => {
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () => jsonResponse({}, false))
    expect(await catalog.fetchLiveModelsInfo('https://x/v1', 'sk')).toBeNull()
  })

  it('fetchLiveModels still returns just the ids', async () => {
    const fetchFn = async () => jsonResponse({ data: [{ id: 'a' }, { id: 'b' }] })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    expect(await catalog.fetchLiveModels('https://x/v1', 'sk')).toEqual(['a', 'b'])
  })
```

- [ ] **Step 5: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/models-catalog.test.ts`
Expected: FAIL — `fetchLiveModelsInfo` chưa tồn tại.

- [ ] **Step 6: Implement `models-catalog.ts`**

Thêm import (đầu file, sau `import snapshot ...`):
```ts
import { parseLiveModelsInfo } from './agent/limits'
```

Thêm interface (cạnh `ModelLimit`, dòng ~11):
```ts
export interface LiveModelInfo {
  id: string
  context?: number
  output?: number
}
```

Thay toàn bộ thân `fetchLiveModels` (dòng 164-177) bằng:
```ts
  /**
   * Fetch the live model list from an OpenAI-compatible /models endpoint with
   * whatever limit metadata the server exposes (Ollama Cloud and several
   * proxies include context/output numbers under various field names). Returns
   * null on any failure so callers can fall back to the static catalog.
   */
  async fetchLiveModelsInfo(baseUrl: string, apiKey: string): Promise<LiveModelInfo[] | null> {
    try {
      const res = await this.fetchFn(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return null
      const info = parseLiveModelsInfo(await res.json())
      return info.length > 0 ? info : null
    } catch {
      return null
    }
  }

  /** Legacy wrapper: chỉ trả id — vẫn dùng bởi fetchProviderModels. */
  async fetchLiveModels(baseUrl: string, apiKey: string): Promise<string[] | null> {
    const info = await this.fetchLiveModelsInfo(baseUrl, apiKey)
    return info && info.length > 0 ? info.map(m => m.id) : null
  }
```

- [ ] **Step 7: Chạy 2 file test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-limits.test.ts tests/unit/models-catalog.test.ts`
Expected: toàn bộ PASS (helpers + fetchLiveModelsInfo).

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/limits.ts src/main/models-catalog.ts tests/unit/agent-limits.test.ts tests/unit/models-catalog.test.ts
git commit -m "feat(agent): parse live /models limits and classify overflow errors"
```

---

### Task 3: LimitsService.resolveLimits

**Files:**
- Modify: `src/main/agent/limits.ts` (thêm `ResolvedLimits`, `LimitsServiceDeps`, `LimitsService`, `LIVE_MODELS_TTL_MS` vào cuối file)
- Test: `tests/unit/agent-limits.test.ts` (thêm describe `LimitsService`)

**Interfaces:**
- Consumes: `parseLiveModelsInfo`, `matchModel` (Task 2, cùng file); `LearnedLimitsStore`, `normalizeLearnedKey` (`./learned-limits`, Task 1); `DEFAULT_MAX_CONTEXT_TOKENS`, `MAX_OUTPUT_HARD_CAP` (`./config`); `LiveModelInfo` (`../models-catalog`, Task 2).
- Produces:
  - `export interface ResolvedLimits { context: number; output: number | null }`
  - `export interface LimitsServiceDeps { learned: LearnedLimitsStore; getCatalogLimit?: (providerId: string, modelId: string) => Promise<{ context?: number; output?: number } | undefined>; fetchLiveModels?: (baseUrl: string, apiKey: string) => Promise<LiveModelInfo[] | null>; now?: () => number }`
  - `export const LIVE_MODELS_TTL_MS = 5 * 60_000`
  - `export class LimitsService` — `constructor(deps: LimitsServiceDeps)`, `resolveLimits(args: { provider: string; model: string; baseUrl?: string; apiKey?: string; overrides?: { context?: number; output?: number } }): Promise<ResolvedLimits>`
- Task 7 dùng `LimitsService` + `LIVE_MODELS_TTL_MS` (test).

- [ ] **Step 1: Viết test fail** (thêm vào `tests/unit/agent-limits.test.ts`)

```ts
import { LimitsService } from '../../src/main/agent/limits'
import type { LimitsServiceDeps, ResolvedLimits } from '../../src/main/agent/limits'
import { LearnedLimitsStore } from '../../src/main/agent/learned-limits'
import type { LearnedLimitEntry } from '../../src/main/agent/learned-limits'
import { MAX_OUTPUT_HARD_CAP } from '../../src/main/agent/config'
```

(và thêm vào cuối file):

```ts
describe('LimitsService', () => {
  const CATALOG: LimitsServiceDeps['getCatalogLimit'] = async () => ({ context: 200000, output: 384000 })

  function service(over: Partial<LimitsServiceDeps> = {}) {
    const data: LearnedLimitEntry[] = []
    const learned = new LearnedLimitsStore({ load: () => data, save: (next) => data.splice(0, data.length, ...next) })
    const clock = { now: 1000 }
    const deps: LimitsServiceDeps = { learned, now: () => clock.now, ...over }
    return { service: new LimitsService(deps), clock }
  }

  it('prefers user overrides over everything else', async () => {
    const { service } = service()
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', overrides: { context: 64000, output: 8192 } })
    expect(limits).toEqual({ context: 64000, output: 8192 })
  })

  it('treats a partial override as authoritative for the missing field', async () => {
    const { service } = service()
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', overrides: { context: 64000 } })
    expect(limits).toEqual({ context: 64000, output: null })
  })

  it('falls back to a learned limit for the same endpoint', async () => {
    const { service } = service({ getCatalogLimit: CATALOG })
    service['deps'].learned.recordMaxTokensLimit('https://x/v1|m', 65536)
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(limits).toEqual({ context: 200000, output: 65536 })
  })
```

Ghi chú cho người thực thi: dòng trên dùng `service['deps']` để truy cập deps private — nếu không muốn, thay bằng: truyền `learned` riêng từ `service()` (trả về thêm `learned`), như test dưới:

```ts
  it('matches a live /models tag against the bare model id', async () => {
    const { service } = service({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => [{ id: 'deepseek-v4-flash:0731', context: 131072, output: 65536 }]
    })
    const limits = await service.resolveLimits({ provider: 'p', model: 'deepseek-v4-flash', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(limits).toEqual({ context: 131072, output: 65536 })
  })

  it('caches the live fetch per endpoint and refreshes after the ttl', async () => {
    let calls = 0
    const { service, clock } = service({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => { calls++; return [{ id: 'm', output: 65536 }] }
    })
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(calls).toBe(1)
    clock.now += 6 * 60_000
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(calls).toBe(2)
  })

  it('never blocks the first resolve on the network and lands the fetch for the next', async () => {
    let called = false
    const { service, clock } = service({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => { called = true; return [{ id: 'm', context: 64000 }] }
    })
    // Lần đầu: chưa có cache → resolve trả về catalog mà không await fetch.
    const first = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(first).toEqual({ context: 200000, output: MAX_OUTPUT_HARD_CAP })
    // Cho background fetch một tick để vào cache.
    await new Promise(r => setTimeout(r, 10))
    expect(called).toBe(true)
    clock.now += 1000
    const second = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(second).toEqual({ context: 64000, output: null })
  })

  it('caps a catalog output claim but trusts learned/live values uncapped', async () => {
    const { service } = service({ getCatalogLimit: CATALOG })
    const catalog = await service.resolveLimits({ provider: 'p', model: 'm' })
    expect(catalog.output).toBe(MAX_OUTPUT_HARD_CAP) // 384000 → cap 131072

    const { service: live } = service({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => [{ id: 'm', output: 1000000 }]
    })
    const liveLimits = await live.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(liveLimits.output).toBe(1000000) // live là sự thật của endpoint
  })

  it('falls back to the 128k default when nothing knows the model', async () => {
    const { service } = service()
    const limits = await service.resolveLimits({ provider: 'p', model: 'unknown-model' })
    expect(limits).toEqual({ context: 128000, output: null })
  })
})
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-limits.test.ts`
Expected: FAIL — `LimitsService` không tồn tại.

- [ ] **Step 3: Implement `LimitsService`** (thêm 2 import mới vào block import đầu file `src/main/agent/limits.ts` — `LiveModelInfo` **đã import ở Task 2, không thêm lại**; thêm phần còn lại vào cuối file)

```ts
import { LearnedLimitsStore, normalizeLearnedKey } from './learned-limits'
import { DEFAULT_MAX_CONTEXT_TOKENS, MAX_OUTPUT_HARD_CAP } from './config'

export interface ResolvedLimits {
  context: number
  output: number | null
}

export interface LimitsServiceDeps {
  learned: LearnedLimitsStore
  getCatalogLimit?: (providerId: string, modelId: string) => Promise<{ context?: number; output?: number } | undefined>
  fetchLiveModels?: (baseUrl: string, apiKey: string) => Promise<LiveModelInfo[] | null>
  now?: () => number
}

export const LIVE_MODELS_TTL_MS = 5 * 60_000

interface LiveCacheEntry {
  fetchedAt: number
  info: LiveModelInfo[] | null
}

/**
 * Phân giải giới hạn thật của model từ nguồn đáng tin cậy nhất có biết về nó.
 * "Trust the provider, verify by error": mỗi tầng là một phỏng đoán cho tới khi
 * provider tự xác nhận. output = null khi không nguồn nào đáng tin khai cap —
 * wire lúc đó bỏ hẳn max_tokens, đó chính là thứ làm lỗi `max_tokens exceeds`
 * không thể xảy ra.
 */
export class LimitsService {
  private liveCache = new Map<string, LiveCacheEntry>()
  private livePending = new Set<string>()

  constructor(private deps: LimitsServiceDeps) {}

  async resolveLimits(args: {
    provider: string
    model: string
    baseUrl?: string
    apiKey?: string
    overrides?: { context?: number; output?: number }
  }): Promise<ResolvedLimits> {
    const overrides = args.overrides
    if (overrides && (overrides.context !== undefined || overrides.output !== undefined)) {
      return { context: overrides.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: overrides.output ?? null }
    }
    const learned = this.deps.learned.get(normalizeLearnedKey(args.baseUrl, args.model))
    if (learned && (learned.context !== undefined || learned.output !== undefined)) {
      return { context: learned.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: learned.output ?? null }
    }
    const live = this.liveInfo(args.baseUrl, args.apiKey)
    const liveModel = live?.find(m => matchModel(m.id, args.model))
    if (liveModel && (liveModel.context !== undefined || liveModel.output !== undefined)) {
      return { context: liveModel.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: liveModel.output ?? null }
    }
    const catalogLimit = await this.deps.getCatalogLimit?.(args.provider, args.model)
    if (catalogLimit && (catalogLimit.context !== undefined || catalogLimit.output !== undefined)) {
      return {
        context: catalogLimit.context ?? DEFAULT_MAX_CONTEXT_TOKENS,
        // Catalog là nguồn duy nhất có thể khai quá mức trắng trợn (claim 1M
        // trên endpoint thật chỉ 64k), nên output của nó bị cap.
        output: catalogLimit.output === undefined ? null : Math.min(catalogLimit.output, MAX_OUTPUT_HARD_CAP)
      }
    }
    return { context: DEFAULT_MAX_CONTEXT_TOKENS, output: null }
  }

  // Synchronous: không bao giờ chặn caller lên mạng. Cache miss → kick fetch
  // nền (dedupe bằng livePending); resolve hiện tại trả về cái đang biết, fetch
  // lấp cache cho resolve kế tiếp.
  private liveInfo(baseUrl: string | undefined, apiKey: string | undefined): LiveModelInfo[] | null {
    if (!baseUrl || !apiKey || !this.deps.fetchLiveModels) return null
    const cacheKey = `${baseUrl}|${apiKey}`
    const now = this.deps.now?.() ?? Date.now()
    const cached = this.liveCache.get(cacheKey)
    if (cached && now - cached.fetchedAt < LIVE_MODELS_TTL_MS) return cached.info
    if (this.livePending.has(cacheKey)) return cached?.info ?? null
    this.livePending.add(cacheKey)
    const finish = (info: LiveModelInfo[] | null): void => {
      this.livePending.delete(cacheKey)
      this.liveCache.set(cacheKey, { fetchedAt: now, info })
    }
    Promise.resolve(this.deps.fetchLiveModels(baseUrl, apiKey)).then(finish, () => finish(null))
    return cached?.info ?? null
  }
}
```

- [ ] **Step 4: Chạy test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-limits.test.ts`
Expected: toàn bộ PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/limits.ts tests/unit/agent-limits.test.ts
git commit -m "feat(agent): LimitsService resolves limits from learned/live/catalog"
```

---

### Task 4: llm.ts — onReducedBudget hook

**Files:**
- Modify: `src/main/agent/llm.ts` — `RetryOptions` (315-320) + cả 2 nhánh `reduceBudget` trong `withRetry` (366-371 và 380-385)
- Test: `tests/unit/agent-llm-retry.test.ts`

**Interfaces:**
- Consumes: `withRetry`, `reduceBudgetForMaxTokensError` (đã có).
- Produces: `RetryOptions.onReducedBudget?: (realLimit: number) => void` — fire khi `reduceBudgetForMaxTokensError` parse được real limit, ở cả 2 nhánh (thrown + error-part), chỉ khi budget thực sự giảm.
- Lưu ý: `createLlm` (dòng 152) **không đổi chữ ký** — `onReducedBudget` nằm trong `RetryOptions` và được truyền qua `...retry` (dòng 249). Task 7 thêm tham số `retry?: RetryOptions` vào `createLlm` dep của manager.

- [ ] **Step 1: Viết test fail** (thêm vào `tests/unit/agent-llm-retry.test.ts`, trong describe `withRetry`)

```ts
  it('fires onReducedBudget when a max_tokens rejection is parsed (thrown branch)', async () => {
    const realLimits: number[] = []
    let attempts = 0
    const make = (budget?: number) => {
      attempts++
      if (attempts === 1) {
        throw Object.assign(
          new Error('max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
          { statusCode: 400 }
        )
      }
      return parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))
    expect(realLimits).toEqual([65536])
  })

  it('fires onReducedBudget from the error-part branch too', async () => {
    const realLimits: number[] = []
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash', retryable: false })()
        : parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))
    expect(realLimits).toEqual([65536])
  })

  it('does not fire onReducedBudget when nothing is parsed', async () => {
    const realLimits: number[] = []
    const make = () => { throw Object.assign(new Error('bad api key'), { statusCode: 401 }) }
    await expect(collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))).rejects.toThrow('bad api key')
    expect(realLimits).toEqual([])
  })
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-llm-retry.test.ts`
Expected: FAIL — `onReducedBudget` không phải một field hợp lệ của opts (TS error) / callback không fire.

- [ ] **Step 3: Implement**

Thêm field vào `RetryOptions` (dòng 315-320):
```ts
export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  /** Provider đã đích danh output cap thật khi reject max_tokens — ghi lại để turn sau khỏi lỗi lại. */
  onReducedBudget?: (realLimit: number) => void
}
```

Trong `withRetry`, thêm callback vào cả 2 nhánh — nhánh thrown (trước `continue` ở dòng 369-370):
```ts
      const reduced = opts.reduceBudget?.(err)
      if (reduced !== undefined && reduced < (budget ?? Number.POSITIVE_INFINITY)) {
        if (!canRetry(true, attempt, maxAttempts, opts.signal)) throw err
        budget = reduced
        opts.onReducedBudget?.(reduced)
        continue
      }
```

Nhánh error-part (trước `continue` ở dòng 383-384):
```ts
    const reduced = opts.reduceBudget?.(failure.error)
    if (reduced !== undefined && reduced < (budget ?? Number.POSITIVE_INFINITY)) {
      if (!canRetry(true, attempt, maxAttempts, opts.signal)) { yield failure; return }
      budget = reduced
      opts.onReducedBudget?.(reduced)
      continue
    }
```

- [ ] **Step 4: Chạy test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-llm-retry.test.ts`
Expected: toàn bộ PASS (test cũ + 3 test mới).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/llm.ts tests/unit/agent-llm-retry.test.ts
git commit -m "feat(agent): fire onReducedBudget when max_tokens budget shrinks"
```

---

### Task 5: loop.ts — compact/forceCompact + compact-on-reject + wire/reserve split

**Files:**
- Modify: `src/main/agent/loop.ts` — imports (thêm `classifyContextOverflowError` từ `./limits`, `DEFAULT_MAX_CONTEXT_TOKENS` từ `./config`); `LoopDeps` (17-62); field `rejectRetriesThisRun` (cạnh `compactedThisRun` dòng 71); `run()` reset field + error-part (187-191) + catch (193-201); stream call (138-146); tách `compact()` khỏi `compactIfOverThreshold` (336-413); thêm `forceCompact()` + `tryRecoverFromReject()`
- Test: `tests/unit/agent-loop.test.ts` — sửa test 893-899 (wire), thêm describe compact-on-reject

**Interfaces:**
- Consumes: `classifyContextOverflowError` (Task 2), `DEFAULT_MAX_CONTEXT_TOKENS` (`./config`), `toLlmMessages`/`TranscriptItem` (đã có), `estimateUsage` (đã có).
- Produces (thêm vào `LoopDeps`):
  - `maxOutputTokensWire?: number` — value gửi provider làm `max_tokens`; `undefined` = omit.
  - `onContextOverflow?: (promptTokens: number, message?: string) => void`
  - Nội bộ: `compactIfOverThreshold(signal)` giữ chữ ký cũ (manager `maybeCompactIdle` dùng); `forceCompact(signal)` private; `compact(signal)` private; `tryRecoverFromReject(llmMessages, message, signal): Promise<boolean>` private.
- Task 7 truyền `maxOutputTokensWire`/`onContextOverflow`.

- [ ] **Step 1: Sửa test wire (893-899)**

Thay:
```ts
  it('asks the model for no more output than the reserved budget', async () => {
    const h = makeHarness({ maxOutputTokens: 4096 })
```
bằng:
```ts
  it('asks the model for no more output than the verified wire budget', async () => {
    const h = makeHarness({ maxOutputTokensWire: 4096 })
```
(assertion `expect(h.llm.calls[0].maxOutputTokens).toBe(4096)` giữ nguyên.)

- [ ] **Step 2: Viết test compact-on-reject fail** (thêm describe mới vào `tests/unit/agent-loop.test.ts`)

```ts
describe('SessionRunner compact-on-reject', () => {
  const OVERFLOW = 'prompt is too long: 19000 tokens > 16000 maximum'

  // getItems/replaceItems phải cùng một array để sau compaction, retry đọc
  // transcript đã thu gọn chứ không phải bản gốc (giống store thật).
  function makeOverflowHarness(overrides: Partial<LoopDeps> = {}) {
    const replaced: TranscriptItem[][] = []
    let items: TranscriptItem[] = []
    const h = makeHarness({
      maxContextTokens: 1000,
      compaction: { auto: true, buffer: 100, keepTokens: 100, tailTurns: 1, toolOutputMaxChars: 2000, prune: true },
      maxSteps: 3,
      getItems: () => items,
      replaceItems: (next) => { replaced.push(next); items = next },
      ...overrides
    })
    const seed = () => {
      // Ít nhất 2 lượt user để head không rỗng (selectHeadTail giữ tailTurns=1
      // làm tail) — head rỗng sẽ rơi vào shrink(), không chạy compactTranscript.
      items.push(
        { kind: 'message', message: { id: 'u1', role: 'user', text: 'first', createdAt: 1 } },
        { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'reply', createdAt: 1 } },
        { kind: 'message', message: { id: 'u2', role: 'user', text: 'second', createdAt: 2 } },
        { kind: 'message', message: { id: 'a2', role: 'assistant', text: 'work', createdAt: 2 } },
        { kind: 'message', message: { id: 'u3', role: 'user', text: 'latest', createdAt: 3 } }
      )
    }
    return { ...h, replaced, seed }
  }

  it('force-compacts and retries when the provider rejects with a context overflow', async () => {
    const overflow: Array<{ promptTokens: number; message: string }> = []
    // Có tools để calls[2].tools.length > 0 phân biệt retry call với compaction
    // call (compactTranscript luôn truyền tools: []).
    const h = makeOverflowHarness({
      onContextOverflow: (promptTokens, message) => overflow.push({ promptTokens, message }),
      tools: new Map([['read', stubTool('read')]])
    })
    h.seed()
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary'),
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(h.replaced.length).toBeGreaterThan(0)
    expect(overflow).toHaveLength(1)
    expect(overflow[0].message).toBe(OVERFLOW)
    expect(overflow[0].promptTokens).toBeGreaterThan(0)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }> | undefined
    expect(done).toBeDefined()
    expect(done?.reason).toBe('complete')
    // Lần gọi thứ 3 là retry của step 1 — vẫn còn tools (không phải step chết cuối).
    expect(h.llm.calls[2]?.tools.length).toBeGreaterThan(0)
  })

  it('stops after MAX_COMPACT_PER_RUN recoveries and surfaces the real error', async () => {
    const h = makeOverflowHarness()
    h.seed()
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary1'),
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary2'),
      [{ kind: 'error', error: OVERFLOW, retryable: false }]
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const error = h.events.find(e => e.type === 'error') as Extract<ChatEvent, { type: 'error' }> | undefined
    expect(error).toBeDefined()
    expect(error?.message).toContain(OVERFLOW)
  })

  it('does not burn a step on the retry after a compact', async () => {
    const h = makeOverflowHarness({
      maxSteps: 2,
      tools: new Map([['read', stubTool('read')]])
    })
    h.seed()
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary'),
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    // Retry vẫn là step 1 (steps-- khôi phục) nên vẫn có tools và tool chạy được.
    expect(h.llm.calls[2]?.tools.length).toBeGreaterThan(0)
    expect(h.appended.tools).toBe(1)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }> | undefined
    expect(done?.reason).toBe('complete')
  })
})
```

- [ ] **Step 3: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: FAIL — error part vẫn emit lỗi (chưa recover), và stream vẫn dùng `maxOutputTokens` (wire test sai).

- [ ] **Step 4: Implement loop.ts**

Thêm imports (sau dòng 13 `import { estimateUsage } from './token'`):
```ts
import { DEFAULT_MAX_CONTEXT_TOKENS } from './config'
import { classifyContextOverflowError } from './limits'
```

Thêm deps vào `LoopDeps` (sau `maxOutputTokens` dòng 42):
```ts
  /**
   * Giá trị đã xác minh gửi provider làm `max_tokens`; undefined = omit hẳn
   * (provider tự chọn) — không thể lỗi `max_tokens exceeds`. Khác `maxOutputTokens`
   * (reserve, chỉ cho compaction/footer).
   */
  maxOutputTokensWire?: number
  /** Provider reject context overflow — ghi trần context học được. */
  onContextOverflow?: (promptTokens: number, message?: string) => void
```

Thêm field (cạnh `compactedThisRun` dòng 71):
```ts
  // Số lần đã tự sửa reject context-overflow trong một run — cùng giới hạn với
  // compact để một prompt thật sự vượt trần emit lỗi thay vì loop.
  private rejectRetriesThisRun = 0
```

Trong `run()`: reset `rejectRetriesThisRun` cạnh `this.compactedThisRun = 0` (dòng 88):
```ts
    this.compactedThisRun = 0
    this.rejectRetriesThisRun = 0
```

Thay toàn bộ khối `try/catch` của `run()` (137-201) — gồm stream call (đổi `maxOutputTokens` → `this.deps.maxOutputTokensWire`; wire gửi đi, reserve chỉ dùng cho compaction), error-part và catch. **Chú ý:** error-part nằm trong `for await (const part of stream)` — `continue` ở đó sẽ đi tiếp *vòng for-await*, không phải vòng `while`. Phải dùng cờ `recover` + `break` rồi `continue` ở cấp `while` (sau catch). Nhánh catch thì `continue` trực tiếp được (đã ở cấp `while`).
```ts
      let recover = false
      try {
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system,
          messages: llmMessages,
          tools: isLastStep ? [] : this.visibleToolDefs(),
          signal,
          maxOutputTokens: this.deps.maxOutputTokensWire,
          variantOptions: this.deps.variantOptions
        })
        for await (const part of stream) {
          // (các nhánh text/reasoning/tool-call/finish giữ nguyên)
          } else if (part.kind === 'error') {
            // Thử tự sửa trước; persistPartial chỉ khi không recover — retry
            // dựng lại transcript từ đầu, persist trước sẽ nhân đôi text.
            if (await this.tryRecoverFromReject(llmMessages, part.error, signal)) {
              steps--
              recover = true
              break
            }
            persistPartial()
            this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
            return
          }
        }
      } catch (err) {
        const message = formatLlmError(err)
        if (await this.tryRecoverFromReject(llmMessages, message, signal)) {
          steps--
          continue
        }
        persistPartial()
        if (signal?.aborted) {
          this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        } else {
          this.deps.onEvent({ type: 'error', agentId, message })
        }
        return
      }
      // Recover thành công ở error-part → retry step (đã steps--). Nếu signal
      // aborted giữa chừng, vòng while kiểm tra lại ở đầu và emit 'stopped'.
      if (recover) continue
```

Tách `compact()`: thay khối `measure`→`replaceItems([markerItem, summaryItem, ...tail])` (dòng 367-412) bằng lời gọi `await this.compact(signal)`, rồi thêm 2 method mới. Cụ thể, cuối `compactIfOverThreshold` (sau khối prune dòng 361-365) trở thành:
```ts
    await this.compact(signal)
  }
```

Rồi thêm (ngay sau method `compactIfOverThreshold`):
```ts
  /**
   * Compact không kiểm tra threshold — provider vừa báo context đã vượt trần
   * thật. Vẫn giữ các fallback (head rỗng / summary fail → hardTruncate) để
   * retry luôn có transcript nhỏ hơn. Trả về false khi không thể làm gì.
   */
  private async forceCompact(signal?: AbortSignal): Promise<void> {
    const { compaction, replaceItems } = this.deps
    if (!compaction?.auto || !replaceItems) return
    const usable = usableContextTokens(
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      compaction.buffer,
      this.deps.maxOutputTokens
    )
    if (usable <= 0) return
    const items = this.deps.getItems()
    const pruned = pruneToolOutputs(items, compaction, this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS)
    if (pruned) replaceItems(items)
    await this.compact(signal)
  }

  // Phần thân compaction thật, dùng chung cho cả ngưỡng lẫn force-compact.
  private async compact(signal?: AbortSignal): Promise<void> {
    const { compaction, replaceItems } = this.deps
    if (!compaction?.auto || !replaceItems) return
    const usable = usableContextTokens(
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      compaction.buffer,
      this.deps.maxOutputTokens
    )
    if (usable <= 0) return
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

  /**
   * Một reject của provider có thể tự sửa thay vì giết cả turn:
   * context overflow → force-compact transcript rồi retry step. Chặn bởi
   * MAX_COMPACT_PER_RUN để prompt thật sự quá trần emit lỗi. Caller quản lý
   * `steps--` trước `continue` để retry không tốn step.
   */
  private async tryRecoverFromReject(
    llmMessages: ReturnType<typeof toLlmMessages>,
    message: string | undefined,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (signal?.aborted) return false
    if (this.rejectRetriesThisRun >= MAX_COMPACT_PER_RUN) return false
    if (!classifyContextOverflowError(message)) return false
    this.rejectRetriesThisRun++
    // Trần context thật ≤ cỡ prompt bị reject (hoặc con số provider đích danh).
    this.deps.onContextOverflow?.(estimateUsage(llmMessages), message)
    await this.forceCompact(signal)
    return true
  }
```

Lưu ý: `compactIfOverThreshold` sau khi đổi vẫn giữ phần prune và comment cũ; chỉ thay đoạn `measure`/`shrink`/`selectHeadTail`/... phía sau bằng `await this.compact(signal)`.

- [ ] **Step 5: Chạy toàn bộ agent-loop test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: toàn bộ PASS (test cũ + 3 test compact-on-reject + wire test đã sửa).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): compact-on-reject for context overflow + wire/reserve split"
```

---

### Task 6: config + types optional overrides + renderer field removal + manager shims

**Files:**
- Modify: `src/main/agent/config.ts` — `MeowConfig` (49-50), `DEFAULT_MEOW_CONFIG` (162-163), `mergeDefaults` (313-314), `settingsToConfig` (468-469)
- Modify: `src/shared/types.ts` — `MeowSettings` (322, 324)
- Modify: `src/main/meow-agent-manager.ts` — 3 chỗ `resolveOutputTokens(..., cfg.maxOutputTokens)` (580, 853, 923) + import `DEFAULT_MAX_OUTPUT_TOKENS`
- Modify: `src/renderer/src/components/settings/ContextTab.tsx` — bỏ 2 props + 2 field + các `set*` handler
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx` — bỏ 2 props (240-248)
- Test: `tests/unit/agent-config.test.ts` (344-347)

**Interfaces:**
- Consumes: `MeowConfig`/`MeowSettings` (đổi trong task này), `resolveOutputTokens` (giữ nguyên chữ ký).
- Produces:
  - `MeowConfig.maxContextTokens?: number`, `MeowConfig.maxOutputTokens?: number` (optional override — `undefined` = auto).
  - `MeowSettings.maxContextTokens?: number`, `MeowSettings.maxOutputTokens?: number`.
  - `ContextTab` Props bỏ `maxContextTokens`/`maxOutputTokens`; onChange patch chỉ còn `{ maxSteps, compaction, toolOutput, notifications }`.
- Task 7 dùng `cfg.maxContextTokens`/`cfg.maxOutputTokens` làm `overrides` (undefined-safe).

- [ ] **Step 1: Sửa config.test (344-347)**

Thay:
```ts
    expect(cfg.maxContextTokens).toBe(128000)
    expect(cfg.maxOutputTokens).toBe(32000)
```
bằng:
```ts
    expect(cfg.maxContextTokens).toBeUndefined()
    expect(cfg.maxOutputTokens).toBeUndefined()
```
Đổi tên test thành `'defaults to auto limits and token-based compaction settings'`. Thêm test mới vào cuối describe config:
```ts
  it('preserves an explicit context/output override', () => {
    writeFileSync(file, JSON.stringify({ maxContextTokens: 64000, maxOutputTokens: 8192 }))
    const cfg = loadMeowConfig(file)
    expect(cfg.maxContextTokens).toBe(64000)
    expect(cfg.maxOutputTokens).toBe(8192)
  })
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: FAIL — `cfg.maxContextTokens` vẫn là số (chưa đổi code) → `toBeUndefined()` trượt.

- [ ] **Step 3: Implement config.ts + types.ts**

`src/main/agent/config.ts`:
```ts
  maxContextTokens?: number
  maxOutputTokens?: number
```
(thay ở `MeowConfig` dòng 49-50)

Trong `DEFAULT_MEOW_CONFIG` (162-163): xóa 2 dòng `maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,` / `maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,`.

`mergeDefaults` (313-314):
```ts
    maxContextTokens: raw.maxContextTokens,
    maxOutputTokens: raw.maxOutputTokens,
```

`settingsToConfig` (468-469):
```ts
    maxContextTokens: settings.maxContextTokens ?? base.maxContextTokens,
    maxOutputTokens: settings.maxOutputTokens ?? base.maxOutputTokens,
```
(`configToSettings` 424-425 không đổi — vẫn pass-through, giờ truyền `number | undefined` vào field optional.)

`src/shared/types.ts` (322, 324):
```ts
  maxContextTokens?: number
  maxOutputTokens?: number
```

- [ ] **Step 4: Chạy config test, mong đợi PASS**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: PASS (kể cả round-trip test 406-427 giữ nguyên vì settings truyền value rõ ràng).

- [ ] **Step 5: Shims manager + renderer**

`src/main/meow-agent-manager.ts` — import (thêm vào block import từ `./agent/config`, sau `resolveOutputTokens`):
```ts
  DEFAULT_MAX_OUTPUT_TOKENS,
```
Sửa 3 chỗ `resolveOutputTokens(modelLimit, limit, cfg.maxOutputTokens)` thành `resolveOutputTokens(modelLimit, limit, cfg.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)` tại dòng 580, 853, 923.

`tests/unit/meow-agent-manager.test.ts` — harness `makeManager` (59-62): thêm `maxContextTokens: 128000` và `maxOutputTokens: 32000` vào meow.json mặc định. **Lý do bắt buộc:** trước Task 6, `mergeDefaults` tự điền 128000/32000 nên test `getContextInfo` (986-995, assert `limit 128000` / `compactThreshold 76000`) đạt; sau khi xóa default-fill, `cfg.maxContextTokens` thành `undefined` → `limit` thành `null` → test trượt. Pinning giá trị rõ ràng giữ test xanh ở cả Task 6 (override path) lẫn Task 7 (resolver path trả về override). Không đổi assert — vẫn 128000/76000.
```ts
    writeFileSync(defaultCfg, JSON.stringify({
      provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
      model: 'test',
      maxContextTokens: 128000,
      maxOutputTokens: 32000
    }))
```

`src/renderer/src/components/settings/ContextTab.tsx` — Props:
```ts
interface Props {
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  notifications: NotificationsSettings
  onChange: (patch: { maxSteps: number; compaction: CompactionSettings; toolOutput: ToolOutputSettings; notifications: NotificationsSettings }) => void
}
```
Component (thay 22-34):
```tsx
export default function ContextTab({ maxSteps, compaction, toolOutput, notifications, onChange }: Props) {
  const setMaxSteps = (value: string) =>
    onChange({ maxSteps: num(value, maxSteps), compaction, toolOutput, notifications })
  const setComp = (patch: Partial<CompactionSettings>) =>
    onChange({ maxSteps, compaction: { ...compaction, ...patch }, toolOutput, notifications })
  const setToolOutput = (patch: Partial<ToolOutputSettings>) =>
    onChange({ maxSteps, compaction, toolOutput: { ...toolOutput, ...patch }, notifications })
  const setNotifications = (patch: Partial<NotificationsSettings>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications: { ...notifications, ...patch } })
```
Xóa 2 field "Max context tokens"/"Max output tokens" (dòng 40-65) cùng `setTokens`/`setOutputTokens` — section "Limits" chỉ còn "Max steps per turn".

`src/renderer/src/components/settings/SettingsDialog.tsx` (240-248): bỏ 2 props
```tsx
                maxContextTokens={draft.maxContextTokens}
                maxOutputTokens={draft.maxOutputTokens}
```

- [ ] **Step 6: Typecheck + full unit test, mong đợi PASS**

Run: `npm run typecheck && npm test`
Expected: typecheck xanh (4× tsc), 930+ tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/config.ts src/shared/types.ts src/main/meow-agent-manager.ts src/renderer/src/components/settings/ContextTab.tsx src/renderer/src/components/settings/SettingsDialog.tsx tests/unit/agent-config.test.ts tests/unit/meow-agent-manager.test.ts
git commit -m "refactor(config): token limits become optional auto overrides"
```

---

### Task 7: meow-agent-manager wiring + index.ts learnedLimits

**Files:**
- Modify: `src/main/meow-agent-manager.ts` — imports; `MeowAgentManagerDeps` (54); bỏ field `modelLimits` (94); constructor (115-124); `getContextInfo` (571-589); `maybeCompactIdle` (835-867); `refreshModelLimits` (869-890); `register` (905-1117: 919-923, 929, 976-977, 1081-1082)
- Modify: `src/main/index.ts` — thêm `learnedLimits` vào manager deps (quanh dòng 133-152)
- Test: `tests/unit/meow-agent-manager.test.ts` — 986-1000 (await), 1091-1095 (arg thứ 4)

**Interfaces:**
- Consumes: `LimitsService` (Task 3), `LearnedLimitsStore`/`normalizeLearnedKey` (Task 1), `parseContextLimitFromError` (Task 2), `DEFAULT_MAX_OUTPUT_TOKENS` (đã import Task 6), `RetryOptions` (`./agent/llm`), `LiveModelInfo` (`./models-catalog`).
- Produces:
  - `MeowAgentManagerDeps.createLlm?: (provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions) => LlmClient`
  - `MeowAgentManagerDeps.learnedLimits?: LearnedLimitsStore`
  - `getContextInfo(agentId: string): Promise<ContextInfo>` (đổi sync → async)
  - SessionRunner deps nhận `maxOutputTokensWire` + `onContextOverflow`; taskTool/subagent giữ nguyên `maxContextTokens`/`maxOutputTokens` (reserve).
- `LIVE_MODELS_TTL_MS` không dùng ở manager (chỉ test) — không import.

- [ ] **Step 1: Sửa test manager fail**

Trong `tests/unit/meow-agent-manager.test.ts`:
- 986-995: `const info = manager.getContextInfo('a1')` → `const info = await manager.getContextInfo('a1')` (assertions giữ nguyên: limit 128000, compactThreshold 76000).
- 997-1000: `expect(manager.getContextInfo('nope'))` → `expect(await manager.getContextInfo('nope'))`.
- 1091-1095: thay `toHaveBeenCalledWith('codex', 'local-account-scoped-key', 'http://127.0.0.1:43123/v1')` bằng:
```ts
      expect(createLlm).toHaveBeenCalledWith(
        'codex',
        'local-account-scoped-key',
        'http://127.0.0.1:43123/v1',
        expect.objectContaining({ onReducedBudget: expect.any(Function) })
      )
```

- [ ] **Step 2: Chạy test, mong đợi FAIL**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: FAIL — `getContextInfo` sync (await trên số không lỗi nhưng vẫn pass? Thực tế `await` trên giá trị không phải Promise vẫn cho giá trị, nhưng chữ ký `Promise<ContextInfo>` thì `manager.getContextInfo('a1')` trong test cũ trả `Promise` chưa resolve → toEqual trượt). Chính `toEqual` ở test 992-994 sẽ FAIL khi chưa đổi code vì Promise ≠ object.

- [ ] **Step 3: Implement manager**

Imports — thêm vào block import hiện có:
```ts
import { LimitsService } from './agent/limits'
import { parseContextLimitFromError } from './agent/limits'
import { LearnedLimitsStore, normalizeLearnedKey } from './agent/learned-limits'
import type { LearnedLimitsStore } from './agent/learned-limits'
import type { RetryOptions } from './agent/llm'
```

`MeowAgentManagerDeps` (54):
```ts
  createLlm?: (provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions) => LlmClient
  learnedLimits?: LearnedLimitsStore
```

Bỏ field `modelLimits` (94):
```ts
  private modelLimits = new Map<string, { context?: number; output?: number }>()
```
→ xóa dòng này. Thêm 2 field (cạnh `modelVariants` 95):
```ts
  private learnedLimits: LearnedLimitsStore
  private limitsService: LimitsService
```

Constructor (115-124) — thêm vào đầu constructor:
```ts
    this.learnedLimits = deps.learnedLimits ?? new LearnedLimitsStore({ load: () => [], save: () => {} })
    this.limitsService = new LimitsService({
      learned: this.learnedLimits,
      getCatalogLimit: (providerId, modelId) => this.deps.catalog
        ? this.deps.catalog.getModelLimit(providerId, modelId)
        : Promise.resolve(undefined),
      fetchLiveModels: (baseUrl, apiKey) => this.deps.catalog
        ? this.deps.catalog.fetchLiveModelsInfo(baseUrl, apiKey)
        : Promise.resolve(null)
    })
```

`getContextInfo` (571-589) — đổi chữ ký + thân:
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
    const compactThreshold = cfg.compaction.auto && limit
      ? usableContextTokens(limit, cfg.compaction.buffer, outputTokens)
      : null
    return {
      limit,
      compactThreshold,
      sessionCost: this.deps.store.getUsage(this.activeSessionId(agentId)).cost
    }
  }
```

`maybeCompactIdle` (835-867) — thay block `modelLimit`/`limit`/`outputTokens` (844-854):
```ts
      const limits = await this.limitsService.resolveLimits({
        provider: resolved.provider,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey ?? '',
        overrides: { context: cfg.maxContextTokens, output: cfg.maxOutputTokens }
      })
      const limit = limits.context
      const compaction = cfg.compaction
      if (!compaction?.auto || !limit || limit <= 0) continue
      const used = this.lastUsageByAgent.get(agentId)
      if (!used) continue
      const usedTokens = used.total > 0
        ? used.total
        : used.input + used.output + (used.cacheRead ?? 0) + (used.cacheWrite ?? 0)
      const outputTokens = resolveOutputTokens({ output: limits.output ?? undefined }, limit, DEFAULT_MAX_OUTPUT_TOKENS)
      if (usedTokens < usableContextTokens(limit, compaction.buffer, outputTokens)) continue
```

`refreshModelLimits` (869-890) — bỏ phần `modelLimits`:
```ts
  private async refreshModelLimits(): Promise<void> {
    if (!this.deps.catalog) return
    try {
      const providers = await this.deps.catalog.fetch()
      this.modelVariants.clear()
      for (const [providerId, p] of Object.entries(providers)) {
        for (const model of p.models) {
          const variants = p.variants?.[model]
          if (variants && Object.keys(variants).length > 0) {
            this.modelVariants.set(`${providerId}/${model}`, variants)
          }
        }
      }
    } catch {
      /* offline: giới hạn phân giải lúc call time từ learned/live/catalog/default */
    }
  }
```

`register` — thay block 919-923:
```ts
    const limits = await this.limitsService.resolveLimits({
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey ?? '',
      overrides: { context: cfg.maxContextTokens, output: cfg.maxOutputTokens }
    })
    const contextTokens = limits.context
    const outputWire = limits.output
    // Reserve = wire đã xác minh (hoặc 32k) — chỉ cho compaction/footer, không
    // phải giá trị gửi provider.
    const outputReserve = resolveOutputTokens({ output: outputWire ?? undefined }, contextTokens, DEFAULT_MAX_OUTPUT_TOKENS)
```

Thay `llmClient` (929):
```ts
    const learnedKey = normalizeLearnedKey(resolved.baseUrl, resolved.model)
    const llmClient = (this.deps.createLlm ?? createLlm)(
      resolved.provider,
      resolved.apiKey ?? '',
      resolved.baseUrl,
      { onReducedBudget: (realLimit) => this.learnedLimits.recordMaxTokensLimit(learnedKey, realLimit) }
    )
```

Thay taskTool (976-977) — subagent giữ reserve:
```ts
      maxContextTokens: contextTokens,
      maxOutputTokens: outputReserve,
```

Thay SessionRunner (1081-1082) + thêm deps:
```ts
      maxContextTokens: contextTokens,
      maxOutputTokens: outputReserve,
      maxOutputTokensWire: outputWire ?? undefined,
      onContextOverflow: (promptTokens, message) => this.learnedLimits.recordContextOverflow(
        learnedKey,
        parseContextLimitFromError(message) ?? promptTokens
      ),
```

- [ ] **Step 4: Wire index.ts**

`src/main/index.ts` — trong object deps dựng `MeowAgentManager` (cạnh `catalog: new ModelsCatalog(...)`):
```ts
      learnedLimits: new LearnedLimitsStore(
        createJsonStore<LearnedLimitEntry>(path.join(app.getPath('userData'), 'learned-limits.json'), { debounceMs: 500 })
      ),
```
Thêm import (`createJsonStore` đã có sẵn trong index.ts cho SessionStore):
```ts
import { LearnedLimitsStore } from './agent/learned-limits'
import type { LearnedLimitEntry } from './agent/learned-limits'
```

- [ ] **Step 5: Typecheck + full unit test, mong đợi PASS**

Run: `npm run typecheck && npm test`
Expected: typecheck xanh, toàn bộ unit PASS (kể cả manager test đã sửa).

- [ ] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts src/main/index.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat(agent): wire LimitsService and learned limits into the manager"
```

---

### Task 8: AGENTS.md sync + full suite + e2e

**Files:**
- Modify: `src/main/agent/AGENTS.md` (llm.ts row 12, config.ts row 14; thêm 2 row mới)
- Modify: `src/renderer/src/components/settings/AGENTS.md` (ContextTab row 16)
- Modify: `src/main/AGENTS.md` (nếu có nhắc `maxContextTokens`/`maxOutputTokens`)
- Run: full suite

**Interfaces:**
- Không đổi interface. Đảm bảo docs phản ánh code đã merge (quy tắc docs sync).

- [ ] **Step 1: Cập nhật `src/main/agent/AGENTS.md`**

Sửa row `llm.ts` (12) — thêm mention hook:
```
| `llm.ts` | `LlmClient` interface + `createLlm` factory (Anthropic / OpenAI-compatible); `classifyLlmError` + `withRetry` retry a stream that failed before emitting anything, and `reduceBudgetForMaxTokensError` re-runs with a smaller budget when the provider rejects `max_tokens` (catalog overstates the model's real output limit), firing `onReducedBudget(realLimit)` so the learned-limits store can remember it; `withCacheBreakpoints` breaks after the anchored summary. |
```

Sửa row `config.ts` (14) — note optional overrides:
```
| `config.ts` | Loads `meow.json` + env; `MeowConfig` / `ResolvedAgentConfig`; `loadMeowConfig`, `resolveAgentConfig`, `settingsToConfig`/`configToSettings`, `writeMeowConfig`; defaults (tokens, compaction, notifications, lsp); `resolveOutputTokens` picks the per-answer output **reserve** (catalog/live/learned limit, hard cap, half-context guard, fallback `DEFAULT_MAX_OUTPUT_TOKENS`) — `maxContextTokens`/`maxOutputTokens` are optional overrides resolved by `LimitsService`. |
```

Thêm 2 row (sau row `compact.ts`):
```
| `limits.ts` | `LimitsService.resolveLimits` merges override → learned → live `/models` → catalog → 128k default into `{ context, output: number \| null }` (output null = omit `max_tokens`); `parseLiveModelsInfo`, `matchModel`, `classifyContextOverflowError`, `parseContextLimitFromError`; live fetch is background, cached per `baseUrl\|apiKey` with `LIVE_MODELS_TTL_MS`. |
| `learned-limits.ts` | `LearnedLimitsStore`: provider-verified caps persisted to `userData/learned-limits.json`, keyed `baseUrl\|model`; `recordMaxTokensLimit` / `recordContextOverflow` only ever tighten, never raise. |
```

- [ ] **Step 2: Cập nhật `src/renderer/src/components/settings/AGENTS.md`**

Sửa row `ContextTab.tsx` (16):
```
| `ContextTab.tsx` | Context/compaction settings: max steps, notifications, tool-output limits. Fields grouped into 4 sections (Limits / Compaction / Tool output / Notifications) with headers. Token limits are auto-resolved by the main process (no manual context/output fields). |
```

- [ ] **Step 3: Rà `src/main/AGENTS.md` + root**

Grep `maxContextTokens|maxOutputTokens|modelLimits|getModelConfig` trong `src/**/AGENTS.md` và `AGENTS.md`; cập nhật bất kỳ dòng nào còn mô tả việc cũ (context setting bắt buộc, catalog là nguồn duy nhất). Nếu root AGENTS.md nhắc "giới hạn lấy từ catalog", sửa thành "tự phân giải từ provider (learned/live/catalog)".

- [ ] **Step 4: Chạy full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck xanh, toàn bộ unit PASS.
Run: `npm run build && npm run e2e`
Expected: build xanh, 16 e2e test PASS. (Lưu ý: `tests/e2e/context-footer.spec.ts` seed `maxContextTokens` 200000/1100 trong meow.json — qua đường override nên KHÔNG cần đổi; nếu fail, kiểm tra lại override path ở `getContextInfo`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AGENTS.md src/main/AGENTS.md src/renderer/src/components/settings/AGENTS.md
git commit -m "docs(agent): sync AGENTS.md with provider-limits redesign"
```

---

## Ghi chú cho người thực thi

- **Thứ tự bắt buộc** đã được sắp theo dependency: Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Mỗi task đứng riêng và typecheck/test xanh ở commit riêng.
- **`npm test`** = `vitest run --passWithNoTests`; chạy 1 file test nhanh bằng `npx vitest run <file>`.
- **Không có tầng SDK `getModelConfig`** — đã xác minh không tồn tại trong `ai@^6.0.241`; đừng cố thêm. Precedence thực thi: overrides → learned → live `/models` → catalog (cap) → default 128k/output null.
- **Khoảng nghỉ 2 task** (Task 5 → Task 7): giữa chúng, `maxOutputTokensWire` chưa được manager truyền → `max_tokens` bị omit với mọi model. Đây là hành vi an toàn đúng định hướng thiết kế (omit khi chưa xác minh); Task 7 khôi phục gửi giá trị đã xác minh. Không "fix" khoảng nghỉ này bằng fallback `?? this.deps.maxOutputTokens` — nó sẽ phá ngữ nghĩa wire (khi output null phải omit, không phải gửi reserve).
- **Đừng đổi** chữ ký `resolveOutputTokens`, shape `ContextInfo`/`getContextInfo`, `compaction` settings, `maxSteps`/subagent, task tool, IPC contract — spec ngoài phạm vi.
- **Loop test hazard:** test compact-on-reject phải seed ≥ 2 lượt user (đã làm trong `makeOverflowHarness`) — seed 1 lượt khiến `selectHeadTail` trả head rỗng → rơi vào `shrink()` (hardTruncate, không có LLM compact call) và queue bị lệch. Test retry-không-tốn-step dùng `maxSteps: 2` + tool `read` và phân biệt compaction bằng `calls[i].tools.length === 0`.
- **Cả 2 nhánh reject** (error-part dòng 187-191 và catch 193-201 của `run()`) đều phải qua `tryRecoverFromReject`, và `persistPartial()` chỉ sau khi không recover được — persist trước sẽ nhân đôi text khi retry dựng lại transcript. **Bẫy control flow:** error-part nằm trong `for await` — `continue` ở đó đi tiếp vòng stream, không phải vòng `while`; phải dùng cờ `recover` + `break` + `if (recover) continue` sau try/catch (đã ghi đúng ở Task 5 Step 4). Chỉ nhánh catch mới `continue` trực tiếp.
- **ContextFooter (spec Section 8 step 8):** không cần sửa renderer riêng — `ContextFooter.tsx` đọc `limit`/`compactThreshold` từ `getContextInfo` (chỉnh ở Task 7) và không hiển thị output tokens, nên "limit thật" và nhãn "auto" (khi chưa xác minh) đã được thỏa mãn qua resolver. Đừng thêm field output vào footer trong task này.
- Khi gặp lỗi test do chạy song song file khác liên quan, hãy chạy lại file bị ảnh hưởng đơn lẻ trước khi kết luận.
