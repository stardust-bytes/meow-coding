# Meow Coding — Trace không lag: Implementation Plan

Ngày: 2026-08-17 · Spec: `docs/superpowers/specs/2026-08-17-trace-no-lag-design.md`

## Tổng quan

App bị lag/đứng do trace ghi **đồng bộ** (`appendFileSync` từng event) trên main process và gửi
**live IPC** từng event sang renderer dù không ai mở tab trace. Plan này:

1. Đổi `TraceStore` sang ghi **async theo lô** (buffer per-session + write chain giữ thứ tự).
2. **Bỏ hẳn** live `onTrace` send trong `index.ts`.
3. `read()` await flush trước khi đọc → không race.
4. Tab Trace bỏ subscription live; reload khi agent kết thúc (`done`/`error`).

## File Structure

| File | Vai trò |
|---|---|
| `src/main/agent/trace-store.ts` | Buffer + flush async, write chain, `read` async, `flushAll` |
| `src/main/index.ts` | Bỏ `onTrace` send; `flushAll` trước khi quit |
| `src/main/meow-agent-manager.ts` | Flush nhanh khi `done`/`error` (để trace kịp bền) |
| `src/renderer/src/components/trace/TracePanel.tsx` | Bỏ live subscription/batching; reload khi agent xong |
| `tests/unit/agent-trace-store.test.ts` | Cập nhật cho async read/flush |
| `tests/unit/agent-trace-manager.test.ts` | Fake trace thêm `flush` |

**Giữ nguyên:** format JSONL, `seq` monotonic, channel `EventTrace`/`onTraceEvent` trong contract
(preload vẫn expose, chỉ UI không dùng — không phá API), logic gộp delta trong `writeTrace`.

---

## Task 1 — `TraceStore` async buffered

File: `src/main/agent/trace-store.ts`

- Import `appendFile` từ `node:fs/promises` (giữ `appendFileSync`/`readFileSync` cho việc seed/đọc).
- Thêm state:

```ts
private buffers = new Map<string, TraceEvent[]>()
private writeChains = new Map<string, Promise<void>>()
private timers = new Map<string, NodeJS.Timeout>()
```

Hằng số: `const FLUSH_INTERVAL_MS = 1000`, `const FLUSH_BATCH = 64`.

- `nextSeq(sessionId)` — giữ nguyên logic seed **1 lần mỗi session mỗi tiến trình** (đọc tail file,
  lấy seq hợp lệ cuối; bỏ qua line hỏng). Không thay đổi hành vi so với hiện tại (chỉ là chi phí
  1 lần, không phải mỗi event). Không dùng `this.read()` (đã async) — tự đọc sync trong hàm này.

- `append(sessionId, event): TraceEvent` — **đồng bộ**:
  1. `const seq = this.nextSeq(sessionId)`, dựng `full = { ...event, seq, ts: Date.now() }`.
  2. Push vào `buffers` (tạo mảng nếu chưa có).
  3. Nếu `buf.length >= FLUSH_BATCH` → `void this.flush(sessionId)`.
  4. Ngược lại nếu chưa có timer cho session → đặt `setTimeout(FLUSH_INTERVAL_MS)` gọi
     `void this.flush(sessionId)`; `t.unref?.()`.
  5. Trả `full`.

- `flush(sessionId): Promise<void>`:
  1. Nếu có buffer → lấy ra, xóa khỏi `buffers`, nối `lines = buf.map(e => JSON.stringify(e) + '\n').join('')`.
  2. `const prev = this.writeChains.get(sessionId) ?? Promise.resolve()`
  3. `const next = prev.then(() => appendFile(this.filePath(sessionId), lines))`
  4. Lưu `next.catch(err => console.warn('[trace] flush failed', err))` vào write chain (nuốt lỗi để
     chuỗi không đứt).
  5. Clear timer nếu có.
  6. Trả `this.writeChains.get(sessionId) ?? Promise.resolve()`.

- `flushAll(): Promise<void>` — flush mọi session trong `buffers`/`writeChains`, await tuần tự.

- `async read(sessionId): Promise<TraceEvent[]>` — `await this.flush(sessionId)` rồi đọc file như cũ
  (giữ logic skip corrupt line).

- `delete(sessionId): void` — vẫn đồng bộ: clear timer, xóa buffer, xóa seq, rồi **chain** việc xóa
  file lên write chain (`prev.then(() => rmSync(file, { force: true }))`) để không đè lên write đang bay:
  ```ts
  const prev = this.writeChains.get(sessionId) ?? Promise.resolve()
  this.writeChains.delete(sessionId)
  prev.then(() => rmSync(this.filePath(sessionId), { force: true })).catch(() => {})
  ```

- `async listForAgent(agentId): Promise<TraceSummary[]>` — đổi thành async, dùng `await this.read(...)`.

## Task 2 — Main: bỏ live IPC + flush khi quit

File: `src/main/index.ts`

- Xóa `onTrace: (e) => win?.webContents.send(Channels.EventTrace, e)` khỏi `new MeowAgentManager(...)`
  (chỉ còn `trace: this.traces`). Bỏ import `Channels.EventTrace` nếu không còn dùng `Channels` ở chỗ khác
  (kiểm tra trước khi xóa import — `Channels` dùng rất nhiều trong file, đừng xóa nhầm).
- Trong `app.on('before-quit', ...)` chain, thêm flush sau `mainApp.meowAgent.dispose()`:
  ```ts
  void mainApp.meowAgent.dispose()
    .then(() => mainApp.traces.flushAll())
    .then(() => mainApp.browserBridge.close())
    .then(() => mainApp.pty.stopAll().finally(() => app.exit(0)))
  ```

## Task 3 — Manager: flush nhanh khi run kết thúc

File: `src/main/meow-agent-manager.ts`

- Trong `writeTrace`, ở case `'done'` và `'error'` (sau `emitTrace(...)`), thêm:
  ```ts
  this.deps.trace?.flush(sessionId)
  ```
  (fire-and-forget; `flush` trả Promise nhưng không cần await — write chain giữ thứ tự.)

## Task 4 — TracePanel: bỏ live, reload khi agent xong

File: `src/renderer/src/components/trace/TracePanel.tsx`

- Xóa: `pendingRef`, `flushTimerRef`, `flushPending`, `scheduleFlush`, và effect subscription
  `onTraceEvent` + effect dọn `flushTimerRef`/`pendingRef` khi unmount.
- Tách logic load trong effect mount thành `const reload = useCallback(...)` (không reset events,
  không clear selected; giữ nguyên merge bySeq + sort). Effect mount đổi thành:
  ```ts
  useEffect(() => {
    setEvents([])
    setSelected(null)
    return reload()
  }, [reload])
  ```
  (mount vẫn reset + load; `reload` trả hàm huỷ `cancelled` như cũ.)
- Thêm effect lắng nghe kết thúc agent:
  ```ts
  useEffect(() => {
    return window.api.onChatEvent(e => {
      if ((e.type === 'done' || e.type === 'error') && e.agentId === agentId) reload()
    })
  }, [agentId, reload])
  ```
- `reload` dùng `window.api.traceRead(sid)` như cũ — không cần delay vì `read` đã await flush trong
  main. Giữ nguyên `buildBlocks`/search/fold/select/subtree.

## Task 5 — Cập nhật unit tests

File: `tests/unit/agent-trace-store.test.ts`

- Test "appends JSONL lines..." — sau 2 lần `append`, **chưa chắc file tồn tại** (buffer chưa flush):
  thêm `await store.flush('s1')` trước khi assert file/lines.
- Test "reads events in order and skips corrupt lines" — `store.read('s1')` giờ là async: `const events = await store.read('s1')`. Lưu ý line corrupt được append thẳng bằng `appendFileSync` **sau** flush đầu — vẫn hợp lệ vì `read` chỉ đọc file.
- Thêm test mới:
  - "buffers appends and flushes in order": append 3 events, `await store.flush('s1')`, đọc file → đúng thứ tự seq 1,2,3.
  - "read awaits pending flush": append 1 event (chưa flush), `await store.read('s1')` → thấy event đó (không cần đợi timer).
  - "flushAll writes everything": append vào 2 session, `await store.flushAll()`, cả 2 file đều có nội dung.

File: `tests/unit/agent-trace-manager.test.ts`

- Fake trace trong `makeTrace()` thêm `flush: async () => {}` (và giữ `append`/`delete`). Cần vì
  manager gọi `trace?.flush` ở case `done` (test hiện có emit `done`).

## Task 6 — Verify

- `npm run typecheck`
- `npm test`
- Nếu đụng e2e (TracePanel smoke test có tồn tại): `npm run build && npm run e2e`.

## Checklist trước khi hoàn thành

- [ ] Không còn `appendFileSync` trong hot path của `append()`.
- [ ] Không còn `webContents.send(Channels.EventTrace, ...)` trong main.
- [ ] TracePanel không còn subscription `onTraceEvent`.
- [ ] `read` async — mọi caller đã await (IPC handler trả Promise là OK).
- [ ] `npm run typecheck` + `npm test` pass.
