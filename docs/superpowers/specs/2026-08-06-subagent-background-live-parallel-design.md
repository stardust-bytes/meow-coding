# Meow Coding — Subagent: Background + Live Stream + Parallel — Design

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

3 nâng cấp cho subagent (đối chiếu opencode):

1. **Background subagent** — `task` tool nhận `background=true`, chạy async, trả về ngay; khi xong
   cập nhật UI trong app (không notify OS).
2. **Live stream view** — click card subagent → popup hiển thị stream chi tiết (text + tool + reasoning).
3. **Parallel nâng cao** — loop chạy song tool-call, tách nhóm cần permission.

## 2. Hiện trạng

- `task.ts`: foreground subagent (3 type, task_id resume), emit `subagent-event` (start/delta/tool/done).
- `loop.ts` L169-176: `Promise.all` song song khi **không** tool nào cần `ask`; nếu có → tuần tự hết.
- `ChatPanel`: card subagent tóm tắt (state + tools + text), stream delta append vào text.

## 3. Thiết kế

### 3a. Background subagent — `src/main/agent/tools/task.ts` + manager

- `task` tool thêm `background?: boolean`.
- `background=true`:
  - Tạo subagent runner, chạy **async** (không await) — fire-and-forget trong main.
  - Tool trả về ngay: `{ output: 'Subagent <id> running in background.', background: true }`.
  - Subagent emit `subagent-event` như thường → card live cập nhật.
  - Khi xong (`done`/`error`): main append kết quả vào **main transcript** (assistant message chứa
    báo cáo subagent) + emit `subagent-event { sub: 'done', state, result }` → card update.
- Theo dõi background jobs: `MeowAgentManager` thêm `Map<taskId, {agentId, promise}>` — khi promise
  resolve → append result. Dọn khi agent remove/dispose.

### 3b. Live stream view — `ChatPanel.tsx` + Modal

- Card subagent trong feed: giữ tóm tắt; **click card** → mở popup live stream (dùng `Modal` sẵn có,
  width lớn ~640px).
- Popup hiển thị (live, auto-scroll):
  - Text stream (delta), tool calls đang chạy, reasoning (nếu có), state.
  - Nguồn: cùng `subagent-event` — render cần giữ `FeedItem` subagent mở rộng field
    `reasoning?`, `result?`.
- Đóng popup không hủy subagent (chỉ đóng view).

### 3c. Parallel nâng cao — `loop.ts`

- Tách 2 nhóm tool-call trong 1 turn:
  - Nhóm **không cần permission** (`allow`/`deny`) → `Promise.all` song song.
  - Nhóm **cần `ask`** → chạy **tuần tự** (tránh 2 popup cùng lúc), sau nhóm song song.
- Thứ tự: nhóm permission trước (hoặc sau) — chọn: chạy nhóm không-permission song song trước, rồi
  tuần tự nhóm ask. (Quyết định khi implement — mục tiêu an toàn UX + tốc độ.)

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/main/agent/tools/task.ts` | `background` param + async runner + result callback |
| `src/main/meow-agent-manager.ts` | track background jobs, append result vào transcript, dọn khi remove |
| `src/main/agent/loop.ts` | parallel nâng cao (tách nhóm permission) |
| `src/shared/types.ts` | `subagent-event` thêm `reasoning?`, `result?`, `background?` |
| `src/renderer/src/components/chat/ChatPanel.tsx` | card click → popup live stream; giữ state chi tiết |
| `src/renderer/src/styles.css` | style popup live stream |

## 5. Không đổi

- 3 subagent type hiện có, `task_id` resume, permission của tool subagent.
- Không notify OS khi background xong (chỉ UI).

## 6. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS (thêm test: task background trả về ngay + append khi xong; loop parallel nhóm permission)
- `npm run build && npm run e2e` — PASS
- Manual: gọi task background → card live → popup stream → khi xong result vào feed.

## 7. Out of scope

- Background job list thuần (opencode `background/job.ts` full) — chỉ background subagent.
- OS notification khi background xong.
