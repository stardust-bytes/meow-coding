# Context Usage Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm một block dưới chat input hiển thị `context <tokens> (<pct>%) · $<cost phiên>`, đổi màu khi sắp chạm ngưỡng auto-compact.

**Architecture:** Token usage thật của provider được gắn vào từng assistant message khi persist (nên còn sau reload), báo về renderer qua event `usage` mỗi step. Context limit + ngưỡng compact + cost phiên lấy qua một kênh IPC mới `agent:get-context`. Renderer render bằng component thuần trình bày `ContextFooter`, mọi logic tính toán nằm trong hàm thuần ở `src/shared/usage.ts` để test được không cần DOM.

**Tech Stack:** Electron + React 19 (renderer), TypeScript, Vitest (unit), AI SDK v5 (`streamText`), IPC qua `contextBridge`.

## Global Constraints

- Spec nguồn: `docs/superpowers/specs/2026-08-06-context-usage-footer-design.md`
- Không có testing-library trong repo → **không viết test render React**. Mọi logic phải nằm trong hàm thuần và được test ở `tests/unit/`.
- `ChatMessage.tokens` phải là **optional** — session cũ trên đĩa không có field này và phải đọc lên bình thường.
- Không đổi công thức tính cost hiện tại (`calcCost` chỉ nhận `input`/`output`) — task này chỉ đổi *thời điểm* cộng dồn, không đổi số tiền.
- Renderer import shared code qua alias `@shared/...` (xem `ChatPanel.tsx:2-3`).
- Chạy test: `npx vitest run <file>`. Typecheck: `npm run typecheck`.
- Commit sau mỗi task. Không dùng `--no-verify`.

---

### Task 1: Shared token helpers

**Files:**
- Create: `src/shared/usage.ts`
- Modify: `src/shared/types.ts` (thêm `MessageTokens`, `ContextInfo`, `ChatMessage.tokens`, ChatEvent `usage`)
- Test: `tests/unit/context-usage.test.ts`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces:
  - `interface MessageTokens { input: number; output: number; total: number; reasoning?: number; cacheRead?: number }`
  - `interface ContextInfo { limit: number | null; compactThreshold: number | null; sessionCost: number }`
  - `contextTokens(u: MessageTokens): number`
  - `contextPercent(tokens: number, limit: number | null): number | null`
  - `contextLevel(tokens: number, compactThreshold: number | null): 'normal' | 'warn' | 'danger'`
  - `ChatEvent` thêm nhánh `{ type: 'usage'; agentId: string; tokens: MessageTokens; sessionCost: number }`

- [x] **Step 1: Viết test thất bại**

Tạo `tests/unit/context-usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contextTokens, contextPercent, contextLevel } from '../../src/shared/usage'

describe('contextTokens', () => {
  it('uses total when the provider reports it', () => {
    expect(contextTokens({ input: 100, output: 20, total: 130 })).toBe(130)
  })

  it('falls back to input + output when total is missing', () => {
    expect(contextTokens({ input: 100, output: 20, total: 0 })).toBe(120)
  })

  it('ignores the breakdown fields in the sum', () => {
    // reasoning/cacheRead được lưu để sau này chỉnh công thức, không cộng thêm ở đây
    expect(contextTokens({ input: 100, output: 20, total: 130, reasoning: 8, cacheRead: 500 })).toBe(130)
  })
})

describe('contextPercent', () => {
  it('rounds the ratio against the limit', () => {
    expect(contextPercent(45231, 200000)).toBe(23)
  })

  it('returns null without a usable limit', () => {
    expect(contextPercent(1000, null)).toBeNull()
    expect(contextPercent(1000, 0)).toBeNull()
  })
})

describe('contextLevel', () => {
  const threshold = 180000

  it('is normal below 80% of the compact threshold', () => {
    expect(contextLevel(100000, threshold)).toBe('normal')
  })

  it('warns from 80% of the compact threshold', () => {
    expect(contextLevel(144000, threshold)).toBe('warn')
    expect(contextLevel(179999, threshold)).toBe('warn')
  })

  it('is danger at or above the compact threshold', () => {
    expect(contextLevel(180000, threshold)).toBe('danger')
    expect(contextLevel(195000, threshold)).toBe('danger')
  })

  it('stays normal when auto-compaction is off', () => {
    expect(contextLevel(999999, null)).toBe('normal')
    expect(contextLevel(999999, 0)).toBe('normal')
  })
})
```

- [x] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx vitest run tests/unit/context-usage.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/usage"`

- [x] **Step 3: Thêm type vào `src/shared/types.ts`**

Thêm ngay trên `export interface ChatMessage` (hiện ở dòng 67):

```ts
export interface MessageTokens {
  input: number
  output: number
  total: number
  reasoning?: number
  cacheRead?: number
}

export interface ContextInfo {
  limit: number | null
  compactThreshold: number | null
  sessionCost: number
}
```

Thêm field vào `ChatMessage` (giữ nguyên các field khác):

```ts
export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  reasoning?: string
  tokens?: MessageTokens
  createdAt: number
}
```

Thêm một nhánh vào union `ChatEvent`, đặt ngay dưới nhánh `compacted` (dòng 107):

```ts
  | { type: 'usage'; agentId: string; tokens: MessageTokens; sessionCost: number }
```

- [x] **Step 4: Viết implementation tối thiểu**

Tạo `src/shared/usage.ts`:

```ts
import type { MessageTokens } from './types'

// Mỗi provider quy ước totalTokens một kiểu (Anthropic tách cache read khỏi
// input_tokens, OpenAI gộp sẵn), nên ta tin totalTokens khi có và chỉ tự cộng
// khi provider không trả. Breakdown được lưu trong MessageTokens để sau này
// chỉnh công thức ở đúng một chỗ.
export function contextTokens(u: MessageTokens): number {
  return u.total > 0 ? u.total : u.input + u.output
}

export function contextPercent(tokens: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null
  return Math.round((tokens / limit) * 100)
}

export type ContextLevel = 'normal' | 'warn' | 'danger'

export function contextLevel(tokens: number, compactThreshold: number | null): ContextLevel {
  if (!compactThreshold || compactThreshold <= 0) return 'normal'
  if (tokens >= compactThreshold) return 'danger'
  if (tokens >= compactThreshold * 0.8) return 'warn'
  return 'normal'
}
```

- [x] **Step 5: Chạy test để xác nhận pass**

Run: `npx vitest run tests/unit/context-usage.test.ts`
Expected: PASS — 9 tests

- [x] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (field `tokens` là optional nên không chỗ nào vỡ)

- [x] **Step 7: Commit**

```bash
git add src/shared/usage.ts src/shared/types.ts tests/unit/context-usage.test.ts
git commit -m "feat(shared): context token helpers and MessageTokens type"
```

---

### Task 2: Lấy đủ breakdown token từ AI SDK

**Files:**
- Modify: `src/main/agent/llm.ts:9-18` (type `LlmStreamPart`), `src/main/agent/llm.ts:93-104` (map finish part)
- Test: `tests/unit/agent-llm.test.ts`

**Interfaces:**
- Consumes: `MessageTokens` từ Task 1
- Produces: `LlmStreamPart.tokens?: MessageTokens` — mọi consumer (`loop.ts`) nhận được `reasoning`/`cacheRead` khi provider có trả

- [x] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/unit/agent-llm.test.ts`, bên trong file (giữ nguyên import sẵn có, thêm import nếu thiếu):

```ts
import { describe, expect, it } from 'vitest'
import { toMessageTokens } from '../../src/main/agent/llm'

describe('toMessageTokens', () => {
  it('maps the full AI SDK usage breakdown', () => {
    expect(toMessageTokens({
      inputTokens: 100, outputTokens: 20, totalTokens: 130,
      reasoningTokens: 8, cachedInputTokens: 500
    })).toEqual({ input: 100, output: 20, total: 130, reasoning: 8, cacheRead: 500 })
  })

  it('defaults missing counters to 0 and leaves optional fields undefined', () => {
    expect(toMessageTokens({})).toEqual({ input: 0, output: 0, total: 0, reasoning: undefined, cacheRead: undefined })
  })

  it('returns undefined when the provider reports no usage', () => {
    expect(toMessageTokens(undefined)).toBeUndefined()
  })
})
```

- [x] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx vitest run tests/unit/agent-llm.test.ts`
Expected: FAIL — `toMessageTokens is not a function` (hoặc lỗi import)

- [x] **Step 3: Sửa `src/main/agent/llm.ts`**

Đổi import và type ở đầu file:

```ts
import type { MessageTokens } from '../../shared/types'
```

Đổi field `tokens` trong `LlmStreamPart` (dòng 17) từ `{ input: number; output: number; total: number }` thành:

```ts
  tokens?: MessageTokens
```

Thêm hàm export ngay dưới khai báo `type StreamProviderOptions` (dòng 33):

```ts
interface SdkUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export function toMessageTokens(usage: SdkUsage | undefined): MessageTokens | undefined {
  if (!usage) return undefined
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    total: usage.totalTokens ?? 0,
    reasoning: usage.reasoningTokens,
    cacheRead: usage.cachedInputTokens
  }
}
```

Thay khối `case 'finish'` (dòng 93-105) bằng:

```ts
          case 'finish':
            yield {
              kind: 'finish',
              finishReason: part.finishReason,
              tokens: toMessageTokens(part.totalUsage)
            }
            break
```

- [x] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run tests/unit/agent-llm.test.ts`
Expected: PASS

- [x] **Step 5: Chạy toàn bộ unit test + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: tất cả PASS, exit 0

- [x] **Step 6: Commit**

```bash
git add src/main/agent/llm.ts tests/unit/agent-llm.test.ts
git commit -m "feat(llm): map reasoning and cached input tokens from provider usage"
```

---

### Task 3: Gắn token vào message và báo usage mỗi step

**Files:**
- Modify: `src/main/agent/loop.ts:38` (kiểu `onUsage`), `:59` + `:121-127` (finish part), `:150-158` (appendMessage), `:169-178` (bỏ onUsage cuối run)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `MessageTokens` (Task 1), `LlmStreamPart.tokens` (Task 2)
- Produces:
  - `LoopDeps.onUsage?: (tokens: MessageTokens) => void` — **được gọi một lần cho mỗi step có usage**, không còn gọi một lần cho cả run
  - Assistant message được persist kèm `tokens` (khi provider có trả)

- [x] **Step 1: Viết test thất bại**

Thêm vào `tests/unit/agent-loop.test.ts`, bên trong `describe('SessionRunner', …)`:

```ts
  it('persists provider token usage on the assistant message', async () => {
    const h = makeHarness()
    h.llm.queue = [[
      { kind: 'text', text: 'hi' },
      { kind: 'finish', tokens: { input: 100, output: 20, total: 130, cacheRead: 500 } }
    ]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))

    const msg = h.items.find(i => i.kind === 'message')
    expect(msg?.kind === 'message' && msg.message.tokens).toEqual({
      input: 100, output: 20, total: 130, cacheRead: 500
    })
  })

  it('reports usage once per step, not once per run', async () => {
    const reported: number[] = []
    const h = makeHarness({
      tools: new Map([['read', stubTool('read')]]),
      onUsage: (t) => reported.push(t.total)
    })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} },
        { kind: 'finish', tokens: { input: 10, output: 1, total: 11 } }
      ],
      [
        { kind: 'text', text: 'done' },
        { kind: 'finish', tokens: { input: 20, output: 2, total: 22 } }
      ]
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(reported).toEqual([11, 22])
  })

  it('does not report usage when the provider omits it', async () => {
    const reported: unknown[] = []
    const h = makeHarness({ onUsage: (t) => reported.push(t) })
    h.llm.queue = [textParts('hi')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))

    expect(reported).toEqual([])
  })
```

- [x] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: FAIL — message không có `tokens`; `reported` là `[33]` (một lần cho cả run) thay vì `[11, 22]`

- [x] **Step 3: Sửa `src/main/agent/loop.ts`**

Thêm import type (dòng 2, thêm `MessageTokens` vào danh sách import từ `'../../shared/types'`):

```ts
import type { ChatEvent, ChatMessage, MessageTokens, PromptResponse, QuestionPrompt, TodoItem, ToolCallData } from '../../shared/types'
```

Sau khi sửa xong, `TokenUsage` có thể không còn được tham chiếu trong `loop.ts` (biến `tokens` đổi sang `MessageTokens`, `runUsage` khai báo inline). Nếu vậy, **xoá `TokenUsage` khỏi import** — để lại sẽ khiến `npm run typecheck` báo unused. Kiểm tra bằng: `grep -n "TokenUsage" src/main/agent/loop.ts`

Đổi khai báo `onUsage` trong `LoopDeps` (dòng 38):

```ts
  onUsage?: (tokens: MessageTokens) => void
```

Đổi kiểu biến `tokens` trong `run()` (dòng 73) từ `TokenUsage | undefined` thành:

```ts
      let tokens: MessageTokens | undefined
```

Thay khối `finish part` (dòng 121-127) bằng:

```ts
          } else if (part.kind === 'finish') {
            tokens = part.tokens
            if (part.tokens) {
              runUsage.input += part.tokens.input
              runUsage.output += part.tokens.output
              runUsage.total += part.tokens.total
              // Báo usage ngay mỗi step: nếu user bấm Stop hoặc gặp lỗi giữa
              // chừng, chi phí đã tiêu vẫn được ghi nhận.
              this.deps.onUsage?.(part.tokens)
            }
```

Thêm `tokens` vào assistant message được persist (dòng 150-158):

```ts
      if (textBuffer || calls.length > 0 || reasoningBuffer) {
        this.deps.appendMessage({
          id: randomUUID(),
          role: 'assistant',
          text: textBuffer,
          reasoning: reasoningBuffer || undefined,
          tokens,
          createdAt: Date.now()
        })
      }
```

Xoá hai lời gọi `this.deps.onUsage?.(runUsage)` ở nhánh kết thúc (dòng 171 và 176) — usage đã được báo mỗi step. Giữ nguyên `runUsage` và `computeCost?.(runUsage)` trong event `done`.

- [x] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: PASS — toàn bộ test cũ vẫn xanh, 3 test mới xanh

- [x] **Step 5: Commit**

```bash
git add src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(loop): persist token usage on messages and report usage per step"
```

---

### Task 4: Manager `getContextInfo` + kênh IPC + event `usage`

**Files:**
- Modify: `src/main/meow-agent-manager.ts` (thêm method `getContextInfo`, sửa callback `onUsage` ở dòng 600-610)
- Modify: `src/shared/ipc.ts` (Channels + `AgentApi`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts` (đăng ký handler)
- Test: `tests/unit/meow-agent-manager.test.ts`, `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `ContextInfo`, `MessageTokens`, ChatEvent `usage` (Task 1); `onUsage` per-step (Task 3)
- Produces:
  - `MeowAgentManager.getContextInfo(agentId: string): ContextInfo`
  - `Channels.AgentGetContext = 'agent:get-context'`
  - `AgentApi.getContextInfo(agentId: string): Promise<ContextInfo>`
  - Event `{ type: 'usage', agentId, tokens, sessionCost }` được emit mỗi step

- [x] **Step 1: Viết test thất bại**

Thêm vào `tests/unit/meow-agent-manager.test.ts`, trong `describe('MeowAgentManager', …)`:

```ts
  it('getContextInfo reports the config limit and the auto-compact threshold', async () => {
    const { manager } = await makeManager()
    const info = manager.getContextInfo('a1')
    // config mặc định: maxContextTokens 200000, compaction.auto true, buffer 20000
    expect(info.limit).toBe(200000)
    expect(info.compactThreshold).toBe(180000)
    expect(info.sessionCost).toBe(0)
  })

  it('getContextInfo returns nulls for an unknown agent', async () => {
    const { manager } = await makeManager()
    expect(manager.getContextInfo('nope')).toEqual({ limit: null, compactThreshold: null, sessionCost: 0 })
  })

  it('emits a usage event with the accumulated session cost', async () => {
    const { manager, events } = await makeManager({
      partsQueue: [[
        { kind: 'text', text: 'hi' },
        { kind: 'finish', tokens: { input: 1_000_000, output: 1_000_000, total: 2_000_000 } }
      ]]
    })
    await manager.send('a1', 'hello')
    const usage = events.find(e => e.type === 'usage')
    expect(usage).toBeDefined()
    expect(usage?.type === 'usage' && usage.tokens.total).toBe(2_000_000)
    // giá test: input 1 $/M, output 2 $/M → 1 + 2 = 3
    expect(usage?.type === 'usage' && usage.sessionCost).toBeCloseTo(3, 10)
  })
```

Thêm vào `tests/unit/ipc-contract.test.ts`:
- thêm `'getContextInfo'` vào mảng `required` (dòng 8-21), ngay sau `'getAgentModel'`
- thêm stub vào object `api` (sau `getAgentModel`, dòng 34):

```ts
      getContextInfo: async () => ({ limit: null, compactThreshold: null, sessionCost: 0 }),
```

- thêm assertion vào test `maps event channel names…` (cạnh dòng 120):

```ts
    expect(Channels.AgentGetContext).toBe('agent:get-context')
```

- [x] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/ipc-contract.test.ts`
Expected: FAIL — `manager.getContextInfo is not a function`, `Channels.AgentGetContext` là `undefined`

- [x] **Step 3: Thêm kênh IPC vào `src/shared/ipc.ts`**

Thêm vào object `Channels`, ngay sau `AgentGetModel` (dòng 19):

```ts
  AgentGetContext: 'agent:get-context',
```

Thêm `ContextInfo` vào danh sách import type ở dòng 1-5, và thêm method vào `AgentApi` ngay sau `getAgentModel` (dòng 89):

```ts
  getContextInfo(agentId: string): Promise<ContextInfo>
```

- [x] **Step 4: Implement `getContextInfo` trong `src/main/meow-agent-manager.ts`**

Thêm `ContextInfo` vào import type từ `'../shared/types'`. Thêm method ngay dưới `getAgentModel` (kết thúc ở dòng 348):

```ts
  getContextInfo(agentId: string): ContextInfo {
    const agent = this.agents.get(agentId)
    if (!agent) return { limit: null, compactThreshold: null, sessionCost: 0 }
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const limit = modelLimit?.context ?? cfg.maxContextTokens ?? null
    const compactThreshold = cfg.compaction.auto && limit ? limit - cfg.compaction.buffer : null
    return {
      limit,
      compactThreshold,
      sessionCost: this.deps.store.getUsage(this.activeSessionId(agentId)).cost
    }
  }
```

Đọc lại config mỗi lần gọi (không cache) vì user có thể đổi trong Settings.

- [x] **Step 5: Emit event `usage` trong callback `onUsage`**

Thay khối `onUsage` (dòng 600-610) bằng:

```ts
      onUsage: (tokens) => {
        const price = this.priceFor(resolved.provider, resolved.model)
        const sessionId = this.activeSessionId(agent.id)
        const usage: UsageSummary = {
          input: tokens.input,
          output: tokens.output,
          cacheRead: 0,
          cacheWrite: 0,
          cost: calcCost({ input: tokens.input, output: tokens.output }, price)
        }
        this.deps.store.addUsage(sessionId, usage)
        this.emit({
          type: 'usage',
          agentId: agent.id,
          tokens,
          sessionCost: this.deps.store.getUsage(sessionId).cost
        })
      }
```

Công thức cost giữ nguyên như cũ (chỉ `input`/`output`) — task này không đổi số tiền, chỉ đổi thời điểm cộng dồn.

- [x] **Step 6: Nối preload và main handler**

Trong `src/preload/index.ts`, thêm ngay sau `getAgentModel` (dòng 34):

```ts
  getContextInfo: (agentId: string) => ipcRenderer.invoke(Channels.AgentGetContext, agentId),
```

Trong `src/main/index.ts`, thêm ngay sau handler `AgentGetModel` (dòng 378):

```ts
  ipcMain.handle(Channels.AgentGetContext, (_e, agentId: string) => mainApp.meowAgent.getContextInfo(agentId))
```

- [x] **Step 7: Chạy test để xác nhận pass**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/ipc-contract.test.ts`
Expected: PASS

- [x] **Step 8: Chạy toàn bộ test + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: tất cả PASS, exit 0

- [x] **Step 9: Commit**

```bash
git add src/main/meow-agent-manager.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/meow-agent-manager.test.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(ipc): expose context limit, compact threshold and session cost"
```

---

### Task 5: Block `ContextFooter` dưới chat input

**Files:**
- Create: `src/renderer/src/components/chat/ContextFooter.tsx`
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` (state, `loadTranscript`, `resetView`, `applyEvent`, render; xoá khối `.chat-tokens` ở dòng 575-580)
- Modify: `src/renderer/src/styles.css` (thêm `.context-footer`; xoá `.chat-tokens` ở dòng 649-650)

**Interfaces:**
- Consumes: `contextTokens`, `contextPercent`, `contextLevel` (Task 1); `window.api.getContextInfo` (Task 4); event `usage` (Task 4); `ChatMessage.tokens` (Task 3)
- Produces: component `ContextFooter` (default export) với props `{ tokens: number | null; limit: number | null; compactThreshold: number | null; cost: number }`

- [x] **Step 1: Tạo component `ContextFooter.tsx`**

```tsx
import { memo } from 'react'
import { contextLevel, contextPercent } from '@shared/usage'

interface Props {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
}

export default memo(function ContextFooter({ tokens, limit, compactThreshold, cost }: Props) {
  if (tokens === null) {
    return <div className="context-footer"><span className="context-footer-label">context</span> —</div>
  }
  const pct = contextPercent(tokens, limit)
  const level = contextLevel(tokens, compactThreshold)
  return (
    <div className={`context-footer ${level}`}>
      <span className="context-footer-label">context</span>
      <span>{tokens.toLocaleString()}</span>
      {pct !== null && <span>({pct}%)</span>}
      {level === 'danger' && <span className="context-footer-note">· compacting soon</span>}
      {cost > 0 && <span className="context-footer-cost">· ${cost.toFixed(4)}</span>}
    </div>
  )
})
```

- [x] **Step 2: Thay state token cũ trong `ChatPanel.tsx`**

Thêm import (cạnh dòng 2-8):

```tsx
import { contextTokens } from '@shared/usage'
import ContextFooter from './ContextFooter'
```

Thay hai dòng state cũ (dòng 71-72):

```tsx
  const [contextUsed, setContextUsed] = useState<number | null>(null)
  const [sessionCost, setSessionCost] = useState(0)
  const [contextLimit, setContextLimit] = useState<number | null>(null)
  const [compactThreshold, setCompactThreshold] = useState<number | null>(null)
```

- [x] **Step 3: Thêm `loadContextInfo` và gọi ở các điểm cần**

Thêm callback ngay dưới `refreshVariants` (sau dòng 101):

```tsx
  const loadContextInfo = useCallback(() => {
    void window.api.getContextInfo(agentId).then(info => {
      setContextLimit(info.limit)
      setCompactThreshold(info.compactThreshold)
      setSessionCost(info.sessionCost)
    })
  }, [agentId])
```

Gọi nó cùng chỗ với `refreshVariants` — sửa hai effect ở dòng 103-112:

```tsx
  useEffect(() => { refreshVariants(); loadContextInfo() }, [refreshVariants, loadContextInfo])

  useEffect(() => {
    const onModelChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string }>).detail
      if (detail?.agentId === agentId) { refreshVariants(); loadContextInfo() }
    }
    window.addEventListener('meow:model-changed', onModelChanged)
    return () => window.removeEventListener('meow:model-changed', onModelChanged)
  }, [agentId, refreshVariants, loadContextInfo])
```

- [x] **Step 4: Khôi phục số context khi load transcript**

Sửa `loadTranscript` (dòng 120-128) — thêm phần dò message cuối có tokens:

```tsx
  const loadTranscript = useCallback(() => {
    void window.api.listChatTranscript(agentId).then(items => {
      setItems(items.map(it => it.kind === 'message'
        ? { kind: 'message', id: it.message.id, role: it.message.role, text: it.message.text, reasoning: it.message.reasoning }
        : { kind: 'tool', id: it.tool.id, call: { ...it.tool } }
      ))
      // Mức chiếm dụng context = token của assistant message cuối cùng có output,
      // giống cách opencode chọn (subagent-footer.tsx:35).
      let used: number | null = null
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.kind !== 'message') continue
        const t = it.message.tokens
        if (it.message.role === 'assistant' && t && t.output > 0) { used = contextTokens(t); break }
      }
      setContextUsed(used)
      shouldJumpToEnd.current = true
    })
  }, [agentId])
```

- [x] **Step 5: Xử lý event `usage` và dọn state cũ**

Trong `applyEvent`, thêm nhánh ngay trên nhánh `compacted` (dòng 271):

```tsx
    if (e.type === 'usage') {
      setContextUsed(contextTokens(e.tokens))
      setSessionCost(e.sessionCost)
      return
    }
```

Trong nhánh `done` (dòng 279-282), **xoá** hai dòng `if (e.tokens) setLastTokens(e.tokens)` và `if (e.cost !== undefined) setLastCost(e.cost)`.

Trong `resetView` (dòng 141-153), thay `setLastTokens(null)` / `setLastCost(0)` bằng:

```tsx
    setContextUsed(null)
    setSessionCost(0)
    loadContextInfo()
```

và thêm `loadContextInfo` vào mảng dependency của `resetView`.

- [x] **Step 6: Xoá khối token cũ trong feed và render footer**

Xoá nguyên khối ở dòng 575-580 (`{lastTokens && !running && (…)}`).

Thêm footer ngay sau `<ChatInput …/>` trong `.chat-composer` (sau dòng 731):

```tsx
        <ContextFooter
          tokens={contextUsed}
          limit={contextLimit}
          compactThreshold={compactThreshold}
          cost={sessionCost}
        />
```

- [x] **Step 7: CSS**

Xoá hai dòng `.chat-tokens` / `.chat-tokens-cost` (`styles.css:649-650`). Thêm ngay dưới khối `.chat-input-send` (sau dòng 463):

```css
.context-footer { display: flex; gap: 6px; align-items: center; padding: 4px 2px 0; color: var(--text-dim); font-size: var(--fs-sm); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.context-footer-label { color: var(--text-faint); }
.context-footer.warn { color: var(--yellow); }
.context-footer.danger { color: var(--red); }
.context-footer-cost { color: var(--green); }
.context-footer.warn .context-footer-cost, .context-footer.danger .context-footer-cost { color: inherit; }
```

- [x] **Step 8: Typecheck và chạy toàn bộ test**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0, tất cả test PASS. Nếu typecheck báo `lastTokens`/`lastCost` chưa dùng → còn sót tham chiếu, xoá nốt.

- [x] **Step 9: Kiểm tra tay trên app thật**

Thay vì kiểm tra tay (không có sẵn provider API key thật trong môi trường thực thi), đã viết
`tests/e2e/context-footer.spec.ts` — dựng một HTTP server giả lập endpoint streaming
OpenAI-compatible (`/chat/completions`, SSE) để chạy nguyên luồng thật IPC → manager →
loop → llm → renderer mà không cần API key thật. Test build lại `out/` (`npm run build`)
trước khi chạy vì Playwright `electron.launch({ args: ['.'] })` nạp `out/renderer` tĩnh,
không phải dev server.

Đã xác nhận qua 2 test (`npx playwright test tests/e2e/context-footer.spec.ts`, PASS):
1. Gửi tin nhắn → footer hiện `context 4,231 (2%)` ngay sau step đầu, không có class `warn`/`danger`
2. Đóng app (`app.close()`), mở lại cùng userData/session → footer vẫn hiện `4,231`, không phải `—`
3. Cấu hình `maxContextTokens`/`compaction.buffer` sao cho usage chạm đúng compactThreshold → footer có class `danger` và hiện `compacting soon`
4. Tạo session mới (`.session-new`) → footer về `—`

Không tự động hoá được vế "đổi `maxContextTokens` qua Settings UI" — thay bằng cách seed
thẳng giá trị đó vào `meow.json` trước khi mở app, vì mục tiêu là xác nhận logic màu/ngưỡng
đúng, không phải hành vi UI Settings (đã có ở nơi khác). Cờ **$cost luôn = 0** trong app thật:
`MeowAgentManager.deps.prices` không được set ở đâu trong `src/main/index.ts` (chỉ dùng
trong unit test) → `priceFor()` luôn `undefined` → `calcCost()` luôn trả `0` → đoạn
`{cost > 0 && …}` trong `ContextFooter` không bao giờ render trong app thật hiện nay. Đây là
gap có sẵn từ trước, nằm ngoài phạm vi plan này (plan chỉ đổi *thời điểm* cộng dồn cost, không
đổi cách tính) — ghi lại ở đây để không bị hiểu nhầm là lỗi của Task 5.

- [x] **Step 10: Commit**

```bash
git add src/renderer/src/components/chat/ContextFooter.tsx src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css
git commit -m "feat(renderer): context usage footer below the chat input"
```

---

## Ghi chú cho người thực hiện

- **Sau compaction footer về `—`** là hành vi đã thống nhất trong spec: transcript bị thay bằng `[marker, summary, ...tail]` nên không còn message nào mang `tokens`, và số sẽ đúng trở lại ngay ở step đầu của lượt sau. Đừng "sửa" bằng cách giữ giá trị cũ.
- **Không cộng `cacheRead` vào `contextTokens`**: Anthropic tách cache read khỏi `input_tokens` còn OpenAI gộp sẵn — cộng vô điều kiện sẽ đếm trùng ở OpenAI. Breakdown vẫn được lưu để chỉnh sau ở đúng một hàm.
- Task 3 đổi `onUsage` từ một-lần-mỗi-run sang một-lần-mỗi-step. Tổng cộng dồn không đổi; nếu thấy stats nhảy số, kiểm tra xem có còn sót lời gọi `onUsage?.(runUsage)` ở cuối `run()` không.
