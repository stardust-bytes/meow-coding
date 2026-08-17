# Meow Coding — Trace không lag (async trace store + bỏ live IPC): Design Spec

Ngày: 2026-08-17 · Trạng thái: chờ duyệt

## 1. Mục tiêu

App bị **đứng/lag thậm chí khi không mở trace panel**, do pipeline trace ghi/gửi đồng bộ trên main
process. Mục tiêu:

1. Giữ trace đầy đủ để **xem lại sau** (chat xong mới cần).
2. **Bỏ live update** trên tab Trace — chỉ load lại khi agent kết thúc chạy (nút Stop ẩn).
3. Trace không bao giờ block main process: ghi **async theo lô**, không gửi IPC từng sự kiện.

## 2. Vấn đề hiện tại (đã xác minh trong code)

| Vấn đề | Nguyên nhân gốc |
|---|---|
| App đứng dù không mở trace | `TraceStore.append()` dùng `appendFileSync` mỗi sự kiện — chặn event loop của main (PTY/IPC) |
| Gửi IPC thừa | `index.ts:86` `onTrace: (e) => win.webContents.send(EventTrace, e)` — serialize + gửi mọi event (cả tool output MB) kể cả khi không ai mở tab trace |
| Đọc nặng lần đầu | `nextSeq()` lần đầu đọc + parse cả file đồng bộ |
| Render jank | TracePanel flush 100ms sort toàn bộ events (phụ, vì lag chính ở main) |

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Ghi file | `append()` chỉ push vào **buffer per-session** (RAM) + trả event đầy đủ; flush async `appendFile` hàng đợi tuần tự giữ thứ tự |
| Thời điểm flush | Đủ ngưỡng (VD 64 events hoặc ~256KB) / timer 1–2s / khi run kết thúc / khi app quit (`flushAll`) |
| Live IPC | **Bỏ hẳn** `onTrace` send từng event. Tab Trace đọc từ file |
| Đọc đúng hạn | `read(sessionId)` **await flush(sessionId) trước khi đọc file** → luôn thấy dữ liệu mới nhất, hết race |
| UI refresh | TracePanel bỏ subscription `onTraceEvent` + batching 100ms; load khi mở tab + reload khi `onChatEvent` có `type === 'done' \| 'error'` trùng `agentId` |
| Giữ nguyên | Logic gộp delta thành 1 message (`writeTrace`), `seq` monotonic, search/fold/select, subagent tree, compaction rows |

## 4. Thay đổi chi tiết

### 4.1 `src/main/agent/trace-store.ts`

- Thêm `private buffers = new Map<string, TraceEvent[]>()`, `private writeChain = new Map<string, Promise<void>>()`.
- `append(sessionId, ev)`: `seq` như cũ; push `{...ev, seq, ts}` vào buffer; trả event; lên lịch flush (nếu chưa có timer / vượt ngưỡng thì flush ngay).
- `flush(sessionId)`: lấy buffer, `const chain = (chain cũ ?? resolved).then(() => appendFile(...))`, xóa buffer. Trả về promise của mắt xích mới.
- `flushAll()`: flush mọi session; gọi từ `MainApp` trước khi quit.
- `read(sessionId)`: `await this.flush(sessionId)` rồi đọc file như cũ.
- `nextSeq()` không còn phải đọc file đồng bộ trong append thường — seed chỉ khi buffer trống và chưa seed (đọc file 1 lần, async).

### 4.2 `src/main/index.ts`

- Bỏ `onTrace` (không còn `webContents.send(EventTrace)`).
- Trước khi quit: `await mainApp.traces.flushAll()`.
- Giữ `traceRead` IPC — vẫn đọc từ file sau khi flush.

### 4.3 `src/main/meow-agent-manager.ts`

- `writeTrace` giữ nguyên logic (gộp delta, tool-start/result, subagent, compaction...) — chỉ là ghi qua buffer async thay vì sync + send.

### 4.4 `src/renderer/src/components/trace/TracePanel.tsx`

- Bỏ `pendingRef`/`flushTimerRef`/`scheduleFlush`/`onTraceEvent` subscription.
- Thêm `useEffect` lắng nghe `window.api.onChatEvent`: khi `type === 'done' | 'error'` và `agentId` trùng → reload trace hiện tại.
- Reload = `traceRead(sid)` như hiện có (không cần delay vì read đã await flush).
- (Tùy chọn) nút refresh tay.

## 5. Ảnh hưởng

- Không đổi format JSONL / `seq` / IPC contract (chỉ **bỏ dùng** `EventTrace`, không xóa channel để tránh phá API cũ — có thể xóa sau ở PR riêng nếu muốn).
- Rủi ro: mất ≤ vài giây trace cuối nếu app crash giữa chừng (chấp nhận được).

## 6. Kiểm thử

- Unit: buffer giữ thứ tự; `read` sau `append` không cần chờ timer; `flushAll` ghi hết; append sau flush ghi tiếp đúng thứ tự.
- `npm run typecheck`, `npm test` pass.
- E2E nếu ảnh hưởng: `npm run build && npm run e2e`.
