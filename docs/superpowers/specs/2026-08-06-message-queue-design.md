# Meow Coding — Message Queue (port từ opencode runtime.queue.ts) — Design

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

Port tính năng **serial prompt queue** từ opencode (`packages/opencode/src/cli/cmd/run/runtime.queue.ts`)
vào Meow Coding: user gõ message khi agent đang chạy → message được **xếp hàng** thay vì bị drop;
queue drain **tuần tự từng turn**; message chờ hiển thị trong chat feed, có thể **xóa/edit** trước khi
tới lượt.

## 2. Hiện trạng meow-coding

- `ChatInput.tsx`: textarea `disabled={running}` → user **không gõ được** khi agent đang chạy.
- `meow-agent-manager.ts` `send()`: `if (this.running.has(agentId)) return` → message bị **drop** khi running.

## 3. Thiết kế mới

### Luồng hoạt động

1. **Agent đang chạy** → ChatInput **bỏ `disabled={running}`**, vẫn gõ được.
2. Gõ + Enter → message **không drop**: nếu agent đang running → xếp hàng (tối đa **5**).
   Nếu không running → chạy ngay như hiện tại.
3. Feed hiện message user kèm badge **"qued"** + nút **×** (xóa) + click message để **edit**.
4. Turn hiện tại xong (`done`/`error`) → **tự động chạy message kế tiếp** trong queue, drain tuần tự.
5. **Stop** khi đang chạy → dừng turn hiện tại, **queue giữ nguyên**, turn kế tiếp chạy ngay (nếu có).

### Kiến trúc

#### Main — `meow-agent-manager.ts`
- Thêm `queues = new Map<string, QueuedMessage[]>()` (per-agent), `QueuedMessage = { id, text, images? }`.
- `send(agentId, text, images?)`:
  - Nếu `running.has(agentId)` → `queue.length < 5` thì push + emit `queue-updated`; ngược lại emit error "queue full".
  - Nếu không running → chạy như cũ (append + run), sau khi xong gọi `drainQueue(agentId)`.
- `drainQueue(agentId)`: nếu queue còn message và không running → shift + **gọi `runTurn` nội bộ** (tách riêng
  phần "append + run" khỏi `send`, tránh đệ quy vô hạn vì `send` tự gọi `drainQueue`). Sau `done`/`error`/`stop`
  → gọi `drainQueue` để chạy turn kế tiếp.
- `stop(agentId)`: abort turn hiện tại; **không xóa queue**; `drainQueue` chạy tiếp sau khi turn dừng.
- `removeQueued(agentId, id)`, `editQueued(agentId, id, text)` — xóa/sửa message chờ, emit `queue-updated`.

#### Shared — `types.ts` / `ipc.ts`
- `ChatEvent` thêm:
  ```ts
  | { type: 'queue-updated'; agentId: string; queue: QueuedMessage[] }
  ```
- `QueuedMessage { id: string; text: string; images?: ImageAttachment[] }` trong `types.ts`.
- `Channels`: `ChatQueueRemove: 'chat:queue-remove'`, `ChatQueueEdit: 'chat:queue-edit'`.
- `AgentApi`: `removeQueued(agentId, id)`, `editQueued(agentId, id, text)`.

#### Renderer — `ChatPanel.tsx` / `ChatInput.tsx`
- `ChatPanel`: state `queue: QueuedMessage[]`; `applyEvent` xử lý `queue-updated`; render message chờ
  (kiểu user message + badge `queued` + nút × + onClick edit). `send()` luôn gọi `sendChat` — main quyết
  queue hay chạy ngay. Khi edit: set text vào ChatInput (state `editTarget`).
- `ChatInput`: **bỏ `disabled={running}`**; Enter gửi luôn (main xử lý queue). Nút Stop vẫn hiện khi running.

## 4. Files đụng

- `src/shared/types.ts` — `QueuedMessage`, `ChatEvent.queue-updated`
- `src/shared/ipc.ts` — channels + AgentApi methods
- `src/main/meow-agent-manager.ts` — queue logic + drain
- `src/main/index.ts` — IPC handlers
- `src/preload/index.ts` — expose API
- `src/renderer/src/components/chat/ChatPanel.tsx` — queue UI + edit flow
- `src/renderer/src/components/chat/ChatInput.tsx` — bỏ disabled, nhận editTarget
- `src/renderer/src/styles.css` — badge `queued`
- Tests: `tests/unit/ipc-contract.test.ts`, `tests/unit/meow-agent-manager.test.ts` (queue), e2e

## 5. Giới hạn / quyết định

- Tối đa **5** message chờ (queue full → emit error, không tự xóa cũ).
- Stop **không xóa** queue (chạy tiếp turn kế).
- Lệnh `/new`, `/exit` (nếu có) — ngoài scope hiện tại (không port command đặc biệt; `/` command gửi như message bình thường).
- Không đổi luồng ảnh/vision, @mention.

## 6. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS (thêm test queue: push khi running, drain sau done, remove/edit, limit 5)
- `npm run build && npm run e2e` — PASS (smoke: gõ khi running → message hiện queued → sau done tự gửi)
- Manual: gõ 3 message khi agent chạy → cả 3 queued → chạy tuần tự; Stop → queue giữ, chạy tiếp; × xóa; click edit.
