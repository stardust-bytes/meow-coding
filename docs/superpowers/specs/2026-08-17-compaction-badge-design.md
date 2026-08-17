# Meow Coding — Compaction Badge in Chat Feed — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user · Bước: sau brainstorm

## 1. Mục tiêu

Hiển thị rõ khi session Meow native được compact: một chip "Context compacted" giữa feed, đặt giữa
marker "What did we do so far?" và summary, để user nhận biết context cũ đã được tóm tắt.

## 2. Quyết định đã chốt với user

- **Kiểu**: chip centered giữa feed (approach A) — dải mỏng, chữ mono nhỏ "— Context compacted —".
- **Thời điểm**: khi render — chip xuất hiện ngay trước summary (sau marker user "What did we do
  so far?"). ChatPanel đã có handler event `compacted` (dòng 382) — dùng để thêm item.
- Không đổi IPC / transcript / logic main.

## 3. Thiết kế chi tiết

- `ChatPanel.tsx`:
  - `FeedItem` thêm variant `{ kind: 'compaction'; id: string }`.
  - Handler `compacted`: push item compaction vào `items` (không reload transcript — reload sẽ mất
    chip vì item không nằm trong transcript).
  - Render: `if (item.kind === 'compaction') return <div className="chat-compacted">— Context compacted —</div>`.
  - Lưu ý: `loadTranscript` không tạo item compaction (chỉ render tạm trong phiên); khi reload
    transcript chip biến mất — chấp nhận vì event compacted vẫn tới mỗi lần compact.
- `styles.css`:
  - `.chat-compacted`: centered, mono `--fs-sm`, color `--text-faint`, uppercase letter-spacing,
    flex row với 2 đường kẻ 2 bên (── Context compacted ──), margin 6px 0.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/components/chat/ChatPanel.tsx` | FeedItem variant + push on compacted + render chip |
| `src/renderer/src/styles.css` | `.chat-compacted` style |

Không đổi IPC / contract / logic main / class name hiện có.

## 5. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- Manual: kích hoạt compact (context đầy) → chip xuất hiện giữa marker và summary.

## 6. Out of scope

- Persist chip qua reload (không lưu vào transcript).
- Đếm số lần compact (approach B).
