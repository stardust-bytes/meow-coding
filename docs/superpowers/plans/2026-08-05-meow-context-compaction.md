# Meow Coding — Context Compaction (theo model opencode): Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay cơ chế char-based pruning (`maxContextChars`) bằng token-based compaction kiểu opencode:
khi transcript vượt context limit, gọi LLM tóm tắt head cũ thành summary, giữ tail gần đây nguyên vẹn,
truncate tool output 2,000 ký tự. **Xoá hẳn `maxContextChars` + `pruneTranscript`** (chỉ giữ
`maxContextTokens` làm fallback khi catalog không có limit cho model).

**Nguồn tham khảo:** `D:\GitHub\opencode-1.18.11` — `packages/opencode/src/session/{compaction,overflow}.ts`,
`packages/opencode/src/agent/prompt/compaction.txt`, `packages/core/src/session/compaction.ts`,
`packages/core/src/util/token.ts`.

**Phạm vi:** `src/main/agent/{token,compact,config,loop,message,session}.ts`,
`src/main/{models-catalog,meow-agent-manager}.ts`, `src/shared/types.ts`,
`src/renderer/src/components/chat/ChatPanel.tsx`, tests.

---

## 1. Token estimation (`src/main/agent/token.ts`, mới)

- `estimateTokens(text): number` = `Math.max(0, Math.round(text.length / 4))`.
- `estimateUsage(messages): number` = `estimateTokens(JSON.stringify(messages))`.

## 2. Catalog model limits (`src/main/models-catalog.ts`)

- `CatalogProvider.models` giữ `string[]` (không đổi contract hiện tại), thêm
  `limits: Record<string, { context?: number; output?: number }>`.
- `mapProviders` đọc `limit.context`/`limit.output` từ models.dev; merge snapshot + live.
- Helper `getModelLimit(providerId, modelId): { context?: number; output?: number } | undefined`.

## 3. Config (`src/main/agent/config.ts`)

- `MeowCompactionConfig { auto: boolean; buffer: number; keepTokens: number; tailTurns: number; toolOutputMaxChars: number }`.
- `MeowConfig` thêm `maxContextTokens: number` (mặc định 200_000) + `compaction: MeowCompactionConfig`.
- `DEFAULT_MEOW_CONFIG`: `compaction = { auto: true, buffer: 20_000, keepTokens: 8_000, tailTurns: 2, toolOutputMaxChars: 2_000 }`.
- `mergeDefaults`/`settingsToConfig` bỏ `maxContextChars`, merge `compaction` + `maxContextTokens`.

## 4. Compact module (`src/main/agent/compact.ts`)

- Bỏ `pruneTranscript` (cơ chế cũ bị thay thế hoàn toàn).
- `selectHeadTail(items, keepTokens, tailTurns)` → `{ head, tail }` (bỏ qua cặp compaction marker cũ,
  bỏ orphan tool ở đầu; tail = các turn gần đây trong budget token).
- `serializeItems(items): string` — text dạng `[User]: ...`, `[Tool result]: ...` (giống opencode serialize).
- `buildCompactionPrompt(previousSummary, headText): string` — template anchored summary (port opencode `SUMMARY_TEMPLATE` + buildPrompt).
- `COMPACTION_SYSTEM` — port `compaction.txt`.
- `compactTranscript(deps): Promise<string | null>` — gọi LLM stream (không tool, maxOutputTokens 4096),
  trả summary text hoặc null khi lỗi/abort/rỗng.

## 5. Loop (`src/main/agent/loop.ts`)

- `LoopDeps` thêm: `compaction?: MeowCompactionConfig`, `maxContextTokens?: number`,
  `replaceItems?: (items: TranscriptItem[]) => void`; **bỏ `maxContextChars`**.
- Trong `run()`, đầu mỗi step: `await this.maybeCompact(signal)`.
- `maybeCompact`: bỏ qua nếu `!auto || maxContextTokens<=0 || !replaceItems`; ước lượng
  `estimateUsage(toLlmMessages(items))`; nếu `< usable` return; ngược lại:
  `selectHeadTail` → `serializeItems(head)` → `buildCompactionPrompt(previousSummary, ...)` →
  `compactTranscript` → `replaceItems([marker, summary, ...tail])` → `onEvent({type:'compacted', summary})`.
- `buildMessages`: `toLlmMessages(items, { toolOutputMaxChars })` (không còn nhánh prune char).
- Giữ nguyên event `done`/`error`, maxSteps, permission logic.

## 6. Message render (`src/main/agent/message.ts`)

- `toLlmMessages(items, opts?: { toolOutputMaxChars?: number })`.
- Tool result: truncate output/error về `toolOutputMaxChars` (nếu có) + `\n[truncated]`.
- Item `summary` (nếu renderer gửi) → user `"What did we do so far?"` + assistant summary.

## 7. Session store (`src/main/agent/session.ts`)

- Thêm `replaceItems(id: string, items: ChatTranscriptItem[]): void` (set items + touch updatedAt).

## 8. Manager (`src/main/meow-agent-manager.ts`)

- `register()`: resolve `contextTokens` từ `catalog.getModelLimit(provider, model)?.context ??
  cfg.maxContextTokens`; pass `compaction: cfg.compaction`, `replaceItems`.
- `replaceItems` trỏ tới `store.replaceItems(activeSessionId(agentId), items)`.

## 9. Shared types (`src/shared/types.ts`)

- `ChatEvent` thêm `{ type: 'compacted'; agentId: string; summary: string }`.
- `CatalogModel.limit` (nếu dùng ở shared) — nếu chỉ dùng main thì để local.

## 10. Renderer (`ChatPanel.tsx`)

- `applyEvent`: case `compacted` → chèn notice `"Context compacted — earlier conversation summarized"` +
  reload transcript (`loadTranscript()`).

## 11. Tests

- Mới: `tests/unit/token.test.ts`.
- Mới/update: `agent-compact.test.ts` — `selectHeadTail`, `buildCompactionPrompt`, `compactTranscript` (stub LLM);
  **xoá block test `pruneTranscript`**.
- Update: `agent-config.test.ts` (compaction config + `maxContextTokens`), `agent-loop.test.ts`
  (compaction trigger + toolOutputMaxChars + compacted event; **bỏ test prune char**),
  `models-catalog.test.ts` (limits).
- Chạy: `npm run typecheck`, `npm test`. Nếu ảnh hưởng e2e: `npm run build && npm run e2e`.
