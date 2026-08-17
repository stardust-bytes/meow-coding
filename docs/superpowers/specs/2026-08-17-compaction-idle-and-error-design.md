# Meow Coding — Compaction: Surface Failures + Auto-Compact When Idle — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user · Bước: sau systematic-debugging

## 1. Bối cảnh / Root cause

- Footer hiển thị "102% · compacting soon" chỉ là cảnh báo dựa trên usage của request cuối
  (`contextLevel` → danger) — KHÔNG kích hoạt compaction.
- Compaction thật (`maybeCompact`) chỉ chạy ở đầu step bên trong `run()` (loop.ts:79) — tức
  **chỉ khi có turn đang chạy**. Idle ở 102% → không bao giờ compact.
- `compactTranscript` nuốt mọi lỗi (`catch { return null }`) → **fail im lặng**, không badge,
  không error, treo 102% mãi.

## 2. Quyết định đã chốt với user

- **Phần 1 — Báo lỗi fail**: `compactTranscript` fail → emit event `compaction-failed`; ChatPanel
  hiện chip "Context compaction failed" (tint đỏ/amber) giống chip "Context compacted".
- **Phần 2 — Auto-compact khi idle**: tách lõi `maybeCompact` thành public
  `SessionRunner.compactIfOverThreshold()`; manager chạy timer 20s: với agent
  `!running && compaction.auto` → gọi method. Check rẻ `usedTokens >= limit - buffer` trước khi
  gọi LLM. Guard: lock `compacting` chống trùng turn; khoá tần suất 60s/agent tránh loop khi fail.

## 3. Thiết kế chi tiết

- `shared/types.ts`: ChatEvent thêm `| { type: 'compaction-failed'; agentId: string }`.
- `main/agent/loop.ts`:
  - Đổi `private maybeCompact` → `async compactIfOverThreshold(signal?): Promise<void>` (public),
    giữ logic hiện tại; khi `compactTranscript` trả null → `this.deps.onEvent({ type:
    'compaction-failed', agentId })`.
  - `run()` gọi `this.compactIfOverThreshold(signal)` ở đầu step (như cũ).
- `main/meow-agent-manager.ts`:
  - Track `lastUsageByAgent = Map<agentId, MessageTokens>` trong `onUsage`.
  - `private compacting = Set<agentId>()` + `lastCompactionAt = Map<agentId, number>`.
  - Timer: khởi tạo 1 interval 20s (khi có agent) — mỗi tick, với mỗi agent trong runners:
    - bỏ qua nếu `running.has || compacting.has` hoặc `now - lastCompactionAt < 60_000`
    - lấy `cfg.compaction.auto` + `maxContextTokens`; tính `usable = limit - buffer`
    - `usedTokens` từ `lastUsageByAgent` (total || input+output+cache) — nếu `< usable` skip
    - `compacting.add` → `await runner.compactIfOverThreshold()` → finally `delete` + set timestamp.
  - Interval clear khi app dispose/stop.
- `ChatPanel.tsx`: handle `compaction-failed` → push `{ kind: 'compaction', id, failed: true }`
  (mở rộng FeedItem) hoặc item riêng; render chip với class `chat-compacted failed` → text
  "Context compaction failed".
- `styles.css`: `.chat-compacted.failed` → color `--red`, các đường kẻ `--red` tint.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/shared/types.ts` | event `compaction-failed` |
| `src/main/agent/loop.ts` | public method + emit fail |
| `src/main/meow-agent-manager.ts` | timer idle + locks |
| `src/renderer/src/components/chat/ChatPanel.tsx` | handle fail → chip |
| `src/renderer/src/styles.css` | `.chat-compacted.failed` |

## 5. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS (unit: permission/compact logic không đổi; event type mới).
- Manual: để context vượt ngưỡng rồi idle 20-30s → thấy badge "Context compacted" (không cần
  gửi tin nhắn); tắt provider/network → thấy chip "Context compaction failed".

## 6. Out of scope

- Thay đổi thuật toán compaction (keepTokens/tailTurns).
- Persist chip lỗi qua reload.
