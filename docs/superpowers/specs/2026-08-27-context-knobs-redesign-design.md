# Context Knobs Redesign — Design Spec

Ngày: 2026-08-27 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Claude Code CLI gần như không cho cấu hình các knob context (buffer, keep-recent tokens, tail
turns, tool-output max chars/bytes/lines, max steps/turn): chúng là heuristic nội bộ, auto-compute
theo model. Meow-coding hiện **expose toàn bộ** trong `ContextTab.tsx` dưới dạng giá trị tuyệt đối
cố định (`buffer: 20000`, `keepTokens: 8000`…). Các con số này được tune cho 128k; với model 1M
chúng compact quá sớm (≈7% context) và phí window; với model lạ chúng không tự thích nghi.

Spec này tổ chức lại theo triết lý Claude Code — **auto-compute theo context window làm mặc định,
giữ override làm escape hatch** — nhưng giữ thận trọng đa-provider của meow (compact sớm hơn
Claude Code, buffer lớn hơn, vì không thể tin provider lạ sẽ reject lịch sự để compact-on-reject).

Ba thay đổi đồng thời:
1. **Auto-scale** `buffer`/`keepTokens`/`toolOutputMaxChars` theo ratio×context window (có floor).
2. **UI reorg**: Basic (maxSteps + auto-compact + compact window + MCP token) + Advanced collapse
   (compaction tuning) — để trống = auto, điền số = override.
3. **Knob MCP output** mới (`mcpOutputMaxTokens`, default 25000) — gap so với Claude Code
   `MAX_MCP_OUTPUT_TOKENS`, vì hiện `mcp/manager.ts` trả output MCP không có giới hạn riêng.

Ngoài phạm vi: thay đổi `maxSteps`/subagent budget, thay đổi IPC contract, thay đổi thuật toán
compaction (head/tail split giữ nguyên), thay đổi `prune`, thay đổi `LimitsService`.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Mô hình resolve | **Runtime** — `resolveCompactionSettings()` điền giá trị auto đầu mỗi run khi `contextLimit` đã biết (từ `LimitsService`); meow.json chỉ lưu override hoặc rỗng |
| Field config | `buffer`/`keepTokens`/`toolOutputMaxChars` thành **optional** (`number \| undefined`); `undefined` = auto |
| Ratio (làm cơ sở) | Giữ ratio ngầm của meow hiện tại (tuned 128k): `buffer` 15%, `keepTokens` 6%, `toolOutputMaxChars` 1.5% của context window |
| Floor tối thiểu | `buffer` ≥ 10000, `keepTokens` ≥ 4000, `toolOutputMaxChars` ≥ 1500 — bảo vệ model nhỏ (128k) |
| Guard keepTokens | `keepTokens = min(auto, usableContextTokens/2)` — tail không bao giờ to bằng cả window |
| `tailTurns` | Giữ nguyên, **không scale** (đếm turn, không phải token) |
| `maxBytes`/`maxLines` | KHÔNG auto-scale (giá trị tuyệt đối cho preview file `TruncationStore`), chỉ override, đặt Advanced |
| MCP output | `mcpOutput.maxTokens?` (token-based, default 25000) ngang hàng `toolOutput` trong `MeowConfig`/`MeowSettings` |
| MCP truncation | Khi output > `maxTokens` → giữ `maxTokens` token đầu + ghi full ra `TruncationStore` + trả preview có đường dẫn file |
| `contextLimit` chưa biết ngay | Dùng `DEFAULT_MAX_CONTEXT_TOKENS` (128k) tạm; run kế tự dùng số thật khi live `/models` resolve — không block run đầu |
| UI Basic | maxSteps + auto-compact toggle + `mcpOutputMaxTokens` (compact window tự suy ra = `limit − buffer − reserve`, không cần field riêng) |
| UI Advanced | collapse mặc định đóng: buffer, keepTokens, tailTurns, toolOutputMaxChars, maxBytes, maxLines — empty = auto, có placeholder hiển thị giá trị auto ≈ |
| Placeholder auto | Renderer nhận `resolvedContextTokens` (tái dùng channel ContextFooter) → hiển thị `auto ≈ <charsForTokens(ctx×ratio)>`; chỉ display, logic thật resolve ở main |
| Migration | KHÔNG migration chủ động — optional field tự xử lý: meow.json cũ có `buffer: 20000` → vẫn override 20000 (không đổi behavior); xoá field → auto |
| `DEFAULT_COMPACTION` | Đổi từ giá trị tuyệt đối thành `{ auto: true, tailTurns: 2, prune: true }` (bỏ 4 số); config fresh → toàn auto |
| Self-heal guard | Giữ `compactionTarget` floor `limit/2` hiện có; với auto-scale, `buffer+reserve ≤ 65% ctx` nên `buffer+reserve < ctx` luôn true |

## 3. Kiến trúc

```
LimitsService.resolveLimits()  →  contextLimit
        │
        ▼
resolveCompactionSettings(rawCompaction, contextLimit, outputReserve)
        │  override (field có giá trị) → giữ nguyên
        │  undefined → ratio×ctx, có floor, có keepTokens guard
        ▼
resolved compaction (buffer/keepTokens/toolOutputMaxChars/tooLoutputMaxChars đều có giá trị)
        │
        ├── loop.ts (cache this.compaction đầu run; compactIfOverThreshold/compact/
        │            forceCompact/hardTruncate/pruneToolOutputs nhận object đã resolve)
        └── renderer ContextTab (chỉ hiển thị: placeholder auto ≈ cho field rỗng)

McpManager.getTools()  →  mcpOutput.maxTokens ?? 25000
        │  estimateTokens(output) > maxTokens ?
        │     → truncate (giữ maxTokens đầu) + TruncationStore.writeFile + preview
        ▼
{ output: preview }  (hoặc { output: full } nếu nhỏ hơn limit)
```

### Component / file thay đổi

| Component | Vị trí | Thay đổi |
|---|---|---|
| `CompactionSettings` | `src/shared/types.ts` | `buffer?`, `keepTokens?`, `toolOutputMaxChars?` thành optional |
| `MeowSettings`/`MeowConfig` | `src/shared/types.ts`, `src/main/agent/config.ts` | thêm `mcpOutput?: { maxTokens?: number }` |
| `COMPACTION_RATIOS`/`FLOOR`/`resolveCompactionSettings` | `src/main/agent/compact.ts` (mới) | hàm resolve runtime + hằng số ratio/floor |
| `DEFAULT_COMPACTION` | `src/main/agent/config.ts` | bỏ 4 giá trị tuyệt đối, giữ `auto`/`tailTurns`/`prune` |
| `normalizeCompaction`/`normalizeMcpOutput` | `src/main/agent/config.ts` | bỏ `?? DEFAULT` cho optional fields; thêm normalize mcpOutput |
| `SessionRunner` | `src/main/agent/loop.ts` | resolve `this.compaction` 1 lần đầu run; mọi consumer dùng object đã resolve |
| `McpManager.getTools()` | `src/main/agent/mcp/manager.ts` | thêm truncat theo `mcpOutputMaxTokens` + ghi `TruncationStore` |
| `ContextTab.tsx` | `src/renderer/src/components/settings/ContextTab.tsx` | reorg Basic/Advanced, `numOrUndefined()`, placeholder auto, thêm `autoCompactWindow` + `mcpOutputMaxTokens` |
| `resolvedContextTokens` prop | renderer → ContextTab | tái dùng channel ContextFooter để truyền contextLimit |
| `configToSettings`/`settingsToConfig` | `src/main/agent/config.ts` | xử lý optional + `mcpOutput` |

## 4. Chi tiết

### 4.1. `resolveCompactionSettings` (mới trong `compact.ts`)

```ts
export const COMPACTION_RATIOS = {
  buffer: 0.15,
  keepTokens: 0.06,
  toolOutputMaxChars: 0.015,
} as const
const FLOOR = { buffer: 10000, keepTokens: 4000, toolOutputMaxChars: 1500 }

export interface ResolvedCompaction {
  auto: boolean
  buffer: number
  keepTokens: number
  tailTurns: number
  toolOutputMaxChars: number
  prune?: boolean
}

export function resolveCompactionSettings(
  raw: CompactionSettings,
  contextLimit: number,
  outputReserve = 0
): ResolvedCompaction {
  const pct = (r: number, floor: number) =>
    Math.max(floor, Math.round(contextLimit * r))
  const usable = Math.max(0, contextLimit - outputReserve)
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

- `contextLimit` ≤ 0 hoặc chưa biết → caller truyền `DEFAULT_MAX_CONTEXT_TOKENS` (128k).
- `keepTokens` guard đảm bảo tail ≤ nửa khoảng trống dùng được.

### 4.2. Loop wiring (`loop.ts`)

Hiện `SessionRunner` dùng `this.deps.compaction` trực tiếp. Đổi:

- Thêm field `private compaction: ResolvedCompaction`.
- Đầu run (chỗ `compactedThisRun = 0`), gọi
  `this.compaction = resolveCompactionSettings(this.deps.compaction, this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS, this.deps.maxOutputTokens ?? 0)`.
- `compactIfOverThreshold`/`compact`/`forceCompact`/`pruneToolOutputs`/`hardTruncate` nhận
  `this.compaction` thay `this.deps.compaction`. Signature hàm trong `compact.ts` giữ nguyên
  (vẫn nhận `CompactionSettings`-shape — `ResolvedCompaction` là superset compatible).
- `keepFullTurns` (message.ts) lấy `this.compaction.tailTurns`.

### 4.3. MCP output truncation (`mcp/manager.ts`)

`McpManager` cần `mcpOutput.maxTokens` + `TruncationStore` + `estimateTokens`. Thêm qua deps
(tương tự `projectPath`). Trong `run` wrapper:

```ts
run: async (input) => {
  const current = this.connections.get(serverName)
  if (!current) return { error: `MCP server "${serverName}" is not connected` }
  const res = await current.client.callTool({ name: tool.name, arguments: input })
  const text = /* ... hiện ... */
  if (res.isError) return { error: text || 'mcp tool error' }
  const maxTokens = this.deps.mcpOutputMaxTokens ?? 25000
  if (estimateTokens(text) <= maxTokens) return { output: text }
  // vượt limit: ghi full ra TruncationStore, trả head preview + đường dẫn file
  const preview = this.deps.truncationStore
    ? this.deps.truncationStore.truncate(agentId, toolId, text, { maxBytes: charsForTokens(maxTokens) })
    : text.slice(0, charsForTokens(maxTokens)) + '\n[MCP output truncated]'
  return { output: preview }
}
```

`agentId`/`toolId`: lấy từ context run (truyền qua closure khi `getTools(agentId)`).

### 4.4. UI (`ContextTab.tsx`)

- `numOrUndefined(value)`: rỗng/NaN → `undefined`; có số dương → số. Thay `num()` cho các field
  optional (buffer/keepTokens/toolOutputMaxChars/mcpOutputMaxTokens/autoCompactWindow).
- Basic section: `Max steps`, `Auto-compact` checkbox, `MCP output max tokens`.
  (Compact window không có field riêng — tự suy ra `limit − buffer − reserve`.)
- Advanced section (`<details>`/collapse, đóng mặc định): buffer, keepTokens, tailTurns,
  toolOutputMaxChars, maxBytes, maxLines. Mỗi field optional có `placeholder={auto ≈ ...}` khi
  `resolvedContextTokens` có.
- `maxBytes`/`maxLines` giữ `num()` (bắt buộc, không auto).
- `onChange` patch `undefined` khi rỗng → `normalizeCompaction` lưu thiếu field trong meow.json.

### 4.5. Backward compat

`loadMeowConfig` đọc meow.json cũ (có `buffer: 20000`) → `normalizeCompaction` trả `{ buffer: 20000,
keepTokens: 8000, ... }` (override, không đổi behavior). `resolveCompactionSettings` thấy field có
giá trị → giữ 20000 (thắng ratio). Muốn auto → user xoá input → `undefined` → meow.json thiếu
field → resolve theo ratio. Không cần script migration, không cần version flag.

## 5. Testing

Theo convention `tests/unit/agent-loop.test.ts` (model stub, không hit API):

1. **`resolveCompactionSettings`** (unit thuần): ratio đúng cho 128k/200k/1M; override thắng ratio;
   floor áp dụng khi context nhỏ; `keepTokens ≤ usable/2`; `contextLimit` ≤ 0 → fallback 128k.
2. **Loop compaction** (`agent-loop.test.ts` sửa): loop dùng auto khi config rỗng; override thắng;
   `contextLimit` thay đổi giữa run không crash (giống test learned-limits).
3. **MCP truncation** (`mcp/manager` test): output giả 60k token → truncat 25k + ghi
   `TruncationStore` + preview có đường dẫn; 5k token → trả nguyên.
4. **Migration**: `loadMeowConfig` với meow.json cũ (có `buffer: 20000`) → giữ 20000; meow.json
   thiếu compaction fields → toàn `undefined`.
5. **UI**: nếu repo có component render test — input rỗng → `onChange` patch `undefined`;
   placeholder nhận `resolvedContextTokens`. Không có thì verify thủ công.

## 6. Rủi ro

- **Ratio sai cho model lạ**: floor + guard `keepTokens` + `compact-on-reject`/`hardTruncate` hiện
  có là mạng an toàn. Auto chỉ là default; override luôn còn.
- **`contextLimit` chưa biết run đầu**: fallback 128k tạm, run kế tự sửa. Không block.
- **Placeholder stale khi model đổi**: placeholder chỉ display, resolve thật ở main mỗi run — không
  ảnh hưởng correctness nếu placeholder lạc.
- **MCP truncat mất thông tin**: full output vẫn còn trong `TruncationStore` file, model có đường
  dẫn để đọc lại (giống pattern `TruncationStore` hiện cho tool output thường).