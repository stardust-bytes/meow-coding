# Meow Coding — Context Compaction (theo model opencode): Design Spec

Ngày: 2026-08-05 · Trạng thái: chờ duyệt

## 1. Bối cảnh & vấn đề

Project hiện tại (trước khi đổi) dùng `maxContextChars` (mặc định 200,000 ký tự) + `pruneTranscript`:
khi transcript vượt budget **theo ký tự**, nó âm thầm drop item cũ và chèn user message
`"[Earlier conversation was truncated to fit the context window.]"`.

Tham khảo source opencode `D:\GitHub\opencode-1.18.11` (`packages/opencode/src/session/compaction.ts`,
`packages/opencode/src/session/overflow.ts`, `packages/core/src/session/compaction.ts`,
`packages/core/src/util/token.ts`, `packages/opencode/src/agent/prompt/compaction.txt`):

**opencode KHÔNG dùng maxContext kiểu char.** Nó dùng:

- **Token estimation**: `estimate(text) = round(len / 4)` (`packages/core/src/util/token.ts`).
- **Model context limit**: đọc từ models.dev (`model.limit.context`, `model.limit.input`).
- **Overflow detection** (`overflow.ts`):
  - `usable = model.limit.input - reserved`, trong đó
    `reserved = min(COMPACTION_BUFFER=20_000, maxOutputTokens)`.
  - `isOverflow` khi `tokens.total >= usable`.
- **Compaction (LLM-based)** (`compaction.ts`):
  - Khi overflow → chọn **head** (đoạn cũ cần tóm tắt) + **tail** (turn gần đây giữ nguyên),
    tail mặc định 2 turn, budget `preserve_recent_tokens = clamp(0.25*usable, 2_000, 8_000)`.
  - Gọi LLM với **compaction prompt** có cấu trúc anchored summary template, cập nhật
    `previousSummary` nếu đã có.
  - Kết quả: summary mới được lưu thành message `summary: true`; tail giữ nguyên verbatim.
  - Khi render lại cho model: compaction user message hiển thị là `"What did we do so far?"`
    rồi summary assistant message đi sau (`message-v2.ts` L228-233).
- **Tool output truncation**: `TOOL_OUTPUT_MAX_CHARS = 2_000`, tool result bị cắt
  `[truncated]` khi gửi lên model (`message-v2.ts` L52, `compaction.ts` L30).
- **Config** (`compaction` block): `auto`, `buffer`, `keep.tokens`, `tail_turns`, `reserved`, `prune`.

## 2. Mục tiêu

Cập nhật Meow để **bỏ char-based pruning làm cơ chế chính**, thay bằng **token-based compaction
kiểu opencode**:

1. **Token estimation** thay vì char count: `estimateTokens(text) = round(len / 4)`.
2. **Model context limit**: nguồn chính từ models.dev catalog (`limit.context`, `limit.output`);
   fallback sang config `maxContextTokens` (mặc định 200_000 token).
3. **Overflow detection** trong `SessionRunner.run()`: ước lượng token của request
   (system + messages + tools) so với `contextTokens - buffer`.
4. **Compaction** khi overflow:
   - Chọn head (cũ) + tail (gần đây, giữ nguyên).
   - Gọi LLM với compaction prompt (anchored summary template).
   - Thay transcript bằng `[summaryMessage, ...tail]` qua `SessionStore.replaceItems`.
   - Phát event `compacted` để renderer hiển thị + reload.
5. **Tool output truncation** `toolOutputMaxChars = 2_000` khi convert sang model messages.
6. **Xoá hẳn `maxContextChars` + `pruneTranscript`**: cơ chế cũ bị thay thế hoàn toàn; config cũ
   thừa field sẽ bị bỏ qua. Chỉ giữ `maxContextTokens` làm fallback khi catalog không có limit.

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Đơn vị đo | Token (`round(len/4)`), giống opencode `Token.estimate` |
| Nguồn context limit | `ModelsCatalog` lưu `limit.context`/`limit.output` từ models.dev (snapshot nếu có); fallback `cfg.maxContextTokens` |
| Kích hoạt | Trước mỗi request trong `run()`: nếu `estimate >= usable` → compact |
| Compaction | LLM gọi với compaction prompt; không dùng tool; `maxOutputTokens = 4096` |
| Tail | Giữ `tailTurns` (mặc định 2) turn cuối trong budget `keepTokens` (mặc định 8_000) |
| Biểu diễn summary | User message `"What did we do so far?"` + assistant message chứa summary (giống opencode) |
| Overflow sau turn | Dùng `tokens.total` từ `finish` part để báo overflow cho turn kế (chỉ ước lượng khi thiếu usage) |
| Fallback an toàn | `maxContextTokens` khi catalog không có limit; compaction thất bại → giữ nguyên transcript (không bẻ gãy turn) |
| Config mới | `compaction: { auto, buffer, keepTokens, tailTurns, toolOutputMaxChars }` + `maxContextTokens` |
| Legacy | Bỏ `maxContextChars` hoàn toàn (field cũ trong meow.json bị bỏ qua) |

## 4. Kiến trúc / luồng dữ liệu

```
SessionRunner.run()
  └─ for each step:
       ├─ await maybeCompact()          # token-based overflow detection
       │    └─ compactTranscript(): select head/tail → LLM summary → replaceItems
       ├─ buildMessages()               # toLlmMessages với toolOutputMaxChars
       └─ stream + execute tools
```

Thay đổi file:

- `src/main/agent/token.ts` (mới) — `estimateTokens`, `estimateUsage`.
- `src/main/agent/compact.ts` — `selectHeadTail`, `serializeItems`, `buildCompactionPrompt`,
  `COMPACTION_SYSTEM`, `compactTranscript`; **xoá `pruneTranscript`**.
- `src/main/agent/config.ts` — `MeowCompactionConfig`, `maxContextTokens`, merge/settings.
- `src/main/agent/loop.ts` — `LoopDeps` thêm `compaction`, `contextTokens`, `replaceItems`,
  `onEvent` event `compacted`; gọi `maybeCompact`; toolOutputMaxChars.
- `src/main/agent/message.ts` — `toLlmMessages(items, opts)` truncate tool output + render summary.
- `src/main/agent/session.ts` — thêm `replaceItems(id, items)`.
- `src/main/models-catalog.ts` — giữ `limit` từ models.dev trong `CatalogModel`.
- `src/main/meow-agent-manager.ts` — resolve context limit, pass `compaction`, `replaceItems`.
- `src/shared/types.ts` — event `compacted`; `CatalogModel.limit`.
- `src/renderer/.../ChatPanel.tsx` — xử lý event `compacted` (hiển thị notice + reload transcript).

## 5. Xử lý lỗi

- Compaction LLM call lỗi / trả về rỗng → giữ nguyên transcript (không bẻ gãy turn).
- Không có provider/API key → không compact, không lỗi (giữ transcript nguyên).
- `signal.aborted` trong lúc compact → dừng, trả về transcript cũ.
- `contextTokens <= 0` (model unknown, offline snapshot không có limit) → dùng `maxContextTokens`.

## 6. Kiểm thử

- Unit mới: `token.ts`, `compact.ts` (selectHeadTail, buildCompactionPrompt, compactTranscript với stub LLM).
- Cập nhật: `agent-config.test.ts` (config mới + legacy clamp), `agent-loop.test.ts`
  (compaction trigger, toolOutputMaxChars, event compacted), `models-catalog.test.ts` (limit mapping).
- Giữ `agent-message.test.ts` (toLlmMessages vẫn backward-compatible khi không truyền opts).
- Bắt buộc: `npm run typecheck`, `npm test`.

## 7. Tiêu chí thành công

- `maxContextChars`/`pruneTranscript` bị xoá khỏi codebase; overflow dùng token estimate.
- Khi transcript vượt budget, model nhận summary thay vì mất context im lặng; tail giữ nguyên.
- `maxContextTokens` làm fallback khi catalog không có limit cho model.
- `npm run typecheck` + `npm test` pass.
