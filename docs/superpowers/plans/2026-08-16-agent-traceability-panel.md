# Meow Coding — Agent Traceability Panel: Implementation Plan

Ngày: 2026-08-16 · Spec: `docs/superpowers/specs/2026-08-16-agent-traceability-panel-design.md`

## Mục tiêu

Triển khai màn hình trace (ledger theo turn + timeline + inspector + subagent tree) cho agent native,
trace thô cho agent PTY, event log JSONL per-session, và sửa attribution subagent (bỏ hardcode `'sub'`).

## Nguyên tắc

- TDD: viết test trước mỗi task.
- Commit sau mỗi task hoàn thành (message tiếng Anh).
- Chạy `npm run typecheck` + `npm test` sau mỗi task.
- Chỉ main process ghi file; renderer qua `window.api`; channel dùng `Channels`.

---

## File map

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `src/shared/types.ts` | sửa | Thêm `TraceEvent` union + `TraceSummary` |
| `src/shared/ipc.ts` | sửa | Thêm `Channels.TraceList/Read/Delete/EventTrace` + `AgentApi` methods |
| `src/main/agent/trace-store.ts` | **tạo mới** | `TraceStore`: JSONL append/read/delete/list |
| `src/main/agent/task.ts` | sửa | `agentId` thật (`sub-<type>-<id>`) + `parentTaskId` + `turn` |
| `src/main/agent/loop.ts` | sửa | `LoopDeps.turn`, emit `turn` trong `ChatEvent` |
| `src/main/meow-agent-manager.ts` | sửa | Ghi trace khi emit event; sửa `deleteSession`/`removeAgent` xóa trace file |
| `src/main/index.ts` | sửa | `TraceStore` khởi tạo, IPC handlers, PTY `pty-run` trace, forward `EventTrace` |
| `src/preload/index.ts` | sửa | Expose `traceList/read/delete/onTraceEvent` |
| `src/renderer/src/components/Pane.tsx` | sửa | Tab Chat ↔ Trace state |
| `src/renderer/src/components/PaneHeader.tsx` | sửa | Render tab switch khi `native` |
| `src/renderer/src/components/trace/TracePanel.tsx` | **tạo mới** | Container trace |
| `src/renderer/src/components/trace/TraceLedger.tsx` | **tạo mới** | Ledger theo turn, fold, search |
| `src/renderer/src/components/trace/TraceTimeline.tsx` | **tạo mới** | Overview dải ngang |
| `src/renderer/src/components/trace/TraceInspector.tsx` | **tạo mới** | Chi tiết event |
| `src/renderer/src/components/trace/SubagentTree.tsx` | **tạo mới** | Cây cha-con + drill-down |
| `tests/unit/agent-trace-store.test.ts` | **tạo mới** | Unit test trace store |
| `tests/unit/agent-task.test.ts` | sửa | Test attribution subagent |
| `tests/integration/pty-manager.test.ts` | sửa | Test `pty-run` trace |

---

## Task 1 — Types + IPC contract (shared)

**Mục tiêu:** định nghĩa `TraceEvent` + thêm channel/method.

**Sửa `src/shared/types.ts`:**
- Thêm `TraceEvent` union (theo spec mục 4.1 — 10 loại event, tất cả mang `seq/ts/agentId/sessionId`).
- Thêm `TraceSummary { sessionId: string; eventCount: number; firstTs: number; lastTs: number }`.

**Sửa `src/shared/ipc.ts`:**
- `Channels`: `TraceList: 'trace:list'`, `TraceRead: 'trace:read'`, `TraceDelete: 'trace:delete'`, `EventTrace: 'trace:event'`.
- `AgentApi`: `traceList(agentId): Promise<TraceSummary[]>`, `traceRead(sessionId): Promise<TraceEvent[]>`, `traceDelete(sessionId): Promise<void>`, `onTraceEvent(cb): () => void`.
- `TraceEvent` type re-export từ `types.ts`.

**Test:** `ipc-contract` test hiện có sẽ bắt method mới (chạy `npm test` thấy fail → đây là TDD red). Cập nhật test contract nếu cần.

**Commit:** `feat(shared): add trace event types and IPC channels`

---

## Task 2 — TraceStore (main)

**Tạo `src/main/agent/trace-store.ts`:**
- `class TraceStore`:
  - `constructor(private dir: string)` — `mkdirSync(dir, { recursive: true })` khi khởi tạo.
  - `append(sessionId, event: Omit<TraceEvent,'seq'|'ts'>): void` — tự gán `seq` (đọc dòng cuối file +1, hoặc in-memory counter per session), `ts: Date.now()`, `JSON.stringify` + `\n` append.
  - `read(sessionId): TraceEvent[]` — đọc file, parse từng dòng, dòng lỗi bỏ qua + `console.warn`.
  - `delete(sessionId): void` — `rmSync` file nếu tồn tại.
  - `listForAgent(agentId): TraceSummary[]` — scan dir `*.jsonl`, đọc header/footer cho summary (đọc toàn file là đủ vì event nhỏ).
- Dùng `node:fs` `appendFileSync`/`readFileSync`/`existsSync`/`rmSync`.

**Test `tests/unit/agent-trace-store.test.ts`:**
1. `append` 2 events → file có 2 dòng JSONL, `seq` 1,2, `ts` tăng.
2. `read` trả đúng thứ tự, bỏ qua dòng corrupt (chèn dòng `{invalid` giữa).
3. `delete` → file mất, `read` → `[]`.
4. `listForAgent` trả summary đúng eventCount/firstTs/lastTs.

**Commit:** `feat(agent): add JSONL trace store with seq/ts`

---

## Task 3 — Attribution subagent (task.ts)

**Sửa `src/main/agent/tools/task.ts`:**
- Trong `runSubagent`, thay `agentId: 'sub'` → `agentId: \`sub-${input.subagent_type}-${id}\``.
- Truyền `turn` từ `ctx` (thêm `turn?: number` vào `ToolContext` — set trong loop.ts).
- Khi subagent emit qua `ctx.emitSubagent`, thêm `parentTaskId` (taskId của parent — truyền từ `task` tool options).
- `SubagentToolEvent` thêm field `parentTaskId?: string`.

**Sửa `src/main/agent/tools/types.ts`:** `ToolContext.turn?: number`, `SubagentToolEvent.parentTaskId?: string`.

**Sửa `src/main/agent/loop.ts`:**
- `LoopDeps` thêm `turn?: number`.
- Khi tạo `ToolContext`, truyền `turn: this.deps.turn`.
- `emitSubagent` thêm `parentTaskId: e.parentTaskId`.

**Test `tests/unit/agent-task.test.ts`:** assert `agentId` = `sub-<type>-<id>` (không còn `'sub'`), `parentTaskId` được truyền.

**Commit:** `fix(agent): attribute subagent events with real id and parent task`

---

## Task 4 — Ghi trace từ MeowAgentManager

**Sửa `src/main/meow-agent-manager.ts`:**
- `MeowAgentManagerDeps` thêm `trace?: TraceStore`.
- Trong `setOnEvent` callback: sau khi gọi `cb(e)`, gọi `this.deps.trace?.append(sessionId, normalizeChatEvent(e))` với `sessionId` = active session của `e.agentId`.
- Helper `normalizeChatEvent(e: ChatEvent): Omit<TraceEvent,'seq'|'ts'>` — map `text-delta`→`message`, `tool-start/result`→`tool-start/result` (kèm `durationMs` đo từ `tool-start`→`tool-result` qua Map callId→ts), `turn-started`→`turn-started`, `subagent-event`→`subagent`, `compacted`→`compaction`, `error`/`done`/`usage` tương ứng.
- **Turn counter:** thêm `turnCounters: Map<agentId, number>`; increment khi `turn-started`; truyền `turn` vào `SessionRunner` khi tạo (ở `startTurn`).
- `deleteSession` + `removeAgent`: gọi `this.deps.trace?.delete(sessionId)` (deleteSession) và `trace.delete` cho mọi session của agent (removeAgent).

**Test:** `tests/unit/agent-trace-store.test.ts` mở rộng hoặc test mới `tests/unit/agent-trace-manager.test.ts` — mock `MeowAgentManager` emit `ChatEvent` → assert `trace.append` được gọi với event đúng `agentId`/`turn`/`seq` tăng.

**Commit:** `feat(agent): write trace events from manager with turn counter`

---

## Task 5 — IPC handlers + preload + PTY trace

**Sửa `src/main/index.ts`:**
- Khởi tạo `traces = new TraceStore(path.join(app.getPath('userData'), 'traces'))`.
- Truyền `trace: traces` vào `MeowAgentManager` deps.
- `registerIpcHandlers` thêm:
  - `Channels.TraceList` → `traces.listForAgent(agentId)`
  - `Channels.TraceRead` → `traces.read(sessionId)`
  - `Channels.TraceDelete` → `traces.delete(sessionId)`
- PTY trace: trong `onPtyData`/`onTerminalExit` hook sẵn có, thêm ghi `pty-run` event — cần sessionId của agent PTY; nếu không có sessionId, dùng `agentId` làm key file. Ghi `{ type:'pty-run', startTs, endTs, exitCode, durationMs, logPath }`.
- Forward `EventTrace`: trong `setOnEvent` (nơi gửi `EventChat`), cũng `win?.webContents.send(Channels.EventTrace, normalizedEvent)`.

**Sửa `src/preload/index.ts`:** thêm `traceList`, `traceRead`, `traceDelete`, `onTraceEvent` → subscribe `Channels.EventTrace`.

**Test:** integration test cho `pty-run` — mở rộng `tests/integration/pty-manager.test.ts` (hoặc test handler qua mock).

**Commit:** `feat(ipc): add trace list/read/delete + pty-run tracing`

---

## Task 6 — Renderer: tab Chat ↔ Trace

**Sửa `src/renderer/src/components/Pane.tsx`:**
- Thêm state `tab: 'chat' | 'trace'` (local).
- Nếu `native`: render 2 tab; nội dung = `tab === 'chat' ? <ChatPanel/> : <TracePanel agentId={id}/>`.
- Nếu PTY: chỉ 1 tab "Terminal" (Trace chỉ mở qua menu, xem sau).

**Sửa `src/renderer/src/components/PaneHeader.tsx`:**
- Thêm prop `activeTab`, `onTabChange` — khi `native`, render 2 nút "Chat" / "Trace" cạnh name.
- Style: CSS vars sẵn (`--bg-hover`, `--accent`), tab active có underline/border-bottom.

**Test:** không unit test UI (không có setup) — verify qua typecheck + e2e nếu có.

**Commit:** `feat(ui): add chat/trace tab switch in native pane`

---

## Task 7 — Renderer: TracePanel + ledger + timeline + inspector + subagent tree

**Tạo `src/renderer/src/components/trace/TracePanel.tsx`:**
- Container: nhận `agentId`; load `traceRead(sessionId)` (lấy session hiện tại qua `window.api.listSessions(agentId)` + latest) + subscribe `onTraceEvent`.
- Build turn structure từ `TraceEvent[]`: group theo `turn`, tách `compaction` thành "Between turns".
- Giữ `selected` event id + `folded` set (per turn).
- Scroll behavior: auto-follow bottom trừ khi user scroll lên.

**Tạo `TraceLedger.tsx`:**
- Render turn headers (`Turn N · time · steps · tokens`) + rows (assistant/tool/subagent/compaction).
- Virtual hóa nhẹ: chỉ render ~50 row + overscan, nút "Load more" khi cần.
- Fold: mặc định collapse tool input dài (`>200 chars`), click mở.
- Search: filter theo text.

**Tạo `TraceTimeline.tsx`:**
- Overview: dải ngang theo `ts` — mỗi turn 1 block; assistant block tách TTFT/decode (nếu có `ttftMs`/`decodeMs`).
- Hover 500ms → tooltip hiện clock + duration.
- Click block → scroll ledger tới turn đó.

**Tạo `TraceInspector.tsx`:**
- Render bên phải khi `selected` — token usage, duration, Input (JSON tool input), Output (tool output/error), Timing (ts, ttftMs, decodeMs), cost.
- Nút đóng (Esc).

**Tạo `SubagentTree.tsx`:**
- Từ `TraceEvent[]`, lọc `subagent` events, dựng cây theo `parentTaskId` (gốc = agent cha).
- Click node → expand/collapse; nút "open transcript" → đọc trace của subagent đó (agentId `sub-<type>-<id>` — nhưng trace store keyed theo sessionId; subagent dùng chung sessionId của cha, lọc theo agentId).

**Style:** CSS vars sẵn; thêm `src/renderer/src/styles.css` block `.trace-*` (dark theme).

**Test:** không unit test UI; typecheck pass.

**Commit:** `feat(ui): trace panel with ledger timeline inspector subagent tree`

---

## Task 8 — Xóa trace khi xóa session + polish

**Sửa `src/main/meow-agent-manager.ts`:** đã làm trong Task 4 — verify.
**Sửa renderer:** khi `SessionBar` đổi session → TracePanel reload (`sessionId` prop từ Pane → pass vào TracePanel; thay đổi → re-read).

**Polish:**
- Empty state "No trace yet" khi `[]`.
- Escape đóng inspector.
- Ẩn Trace tab nếu agent PTY (chỉ native).

**Commit:** `feat(ui): reload trace on session switch, empty state, esc close`

---

## Task 9 — E2E (Playwright) — nếu cần

**Tạo `tests/e2e/trace-panel.spec.ts`** (nếu e2e setup cho phép):
- Mở app → native agent → click Trace tab → thấy ledger.
- Gửi 1 prompt → thấy turn mới + tool call.
- Click tool row → inspector hiện input/output.

**Commit:** `test(e2e): trace panel smoke`

---

## Verification

Chạy cuối cùng:
- `npm run typecheck` pass
- `npm test` pass
- `npm run build` (nếu e2e)
- `npm run e2e` (nếu ảnh hưởng)

## Rủi ro & lưu ý

- `trace-store` đọc/ghi file đồng bộ (appendFileSync) — tần suất event thấp, OK cho desktop; không cần async.
- Subagent trace dùng chung sessionId của cha → `TraceEvent.agentId` phân biệt; UI lọc theo agentId.
- PTY không có sessionId → dùng `agentId` làm file key cho `pty-run`.
- Không thay đổi `sessions.json` schema — tránh migration.
