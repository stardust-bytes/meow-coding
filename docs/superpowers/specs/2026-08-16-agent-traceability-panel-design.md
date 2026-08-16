# Meow Coding — Agent Traceability Panel: Design Spec

Ngày: 2026-08-16 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Thêm **màn hình trace** cho agent — theo dõi toàn bộ hoạt động của agent theo **turn**, kèm **timeline
thời gian thực**, **inspector chi tiết** (token/duration/input/output/timing/cost) và **cây subagent**
cha-con có drill-down. Mô phỏng màn hình **Trajectory** của deepseek-harness
(`packages/client/ui-trajectory`) nhưng đơn giản hoá cho app desktop.

Đồng thời sửa lỗ hổng attribution (traceability) hiện có:

1. Subagent dùng hardcode `agentId: 'sub'` trong `task.ts` → mọi subagent mất định danh thật, trace
   không thể gán đúng gốc.
2. Subagent transcript **chỉ in-memory**, sau khi done chỉ giữ text cuối → không drill-down được.
3. Agent PTY (opencode/Claude Code) không có trace chi tiết — chỉ terminal output.

## 2. Vấn đề hiện tại

| Vấn đề | Nguyên nhân gốc |
|---|---|
| Không có màn hình trace | `ChatEvent` có gần đủ event nhưng không persist theo turn/timeline, không có inspector |
| Subagent mất định danh | `task.ts` hardcode `agentId: 'sub'` — mọi subagent gộp về 1 cái tên |
| Subagent không drill-down | Transcript subagent chỉ in-memory trong `task.ts`, sau done chỉ giữ text cuối |
| PTY không trace | Chỉ có `logs/<agentId>.log` thô, không có metadata run (start/end/duration/exitCode) |
| Không replay được | `sessions.json` thiếu timestamp/turn/duration/token theo từng bước |

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Data model | **Event log riêng** `userData/traces/<sessionId>.jsonl` (JSONL append-only) — tách khỏi `sessions.json`; transcript giữ vai trò chat, trace log là nguồn sự thật cho màn hình trace |
| Live + replay | `trace:read` load lịch sử + subscription realtime (dedupe bằng `seq`) |
| Subagent tree | Dựng từ `parentTaskId` trong trace log; drill-down mở transcript subagent từ log |
| Attribution | Mọi event mang `agentId` thật (`sub-<type>-<id>` thay `'sub'`) + `parentTaskId` |
| UI | Tab **Chat ↔ Trace** trong pane native; PTY chỉ timeline thô |
| Retention | 1 file per session; xóa khi xóa session |

## 4. Data model

### 4.1 Trace event (JSONL, 1 event / dòng)

```ts
type TraceEvent =
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'turn-started'; turn: number }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'message'; turn: number; role: 'assistant'; text?: string; reasoning?: string
      tokens?: MessageTokens; ttftMs?: number; decodeMs?: number; durationMs?: number }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'tool-start'; turn: number; callId: string; tool: string; input: Record<string, unknown> }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'tool-result'; turn: number; callId: string; tool: string
      output?: string; error?: string; durationMs: number; cost?: number }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'subagent'; turn: number; taskId: string; parentTaskId?: string
      subagentType?: string; state: 'running' | 'completed' | 'cancelled' | 'error'
      text?: string; result?: string; tools: string[] }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'compaction'; turn: number; summary: string }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'error'; message: string }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'done'; reason: string; tokens?: TokenUsage; cost?: number }
  | { seq: number; ts: number; agentId: string; sessionId: string
      type: 'pty-run'; startTs: number; endTs?: number; exitCode?: number
      durationMs?: number; logPath: string }
```

### 4.2 Attribution (traceable)

- Mỗi event mang `agentId` **thật**:
  - Agent cha: `agent.id`
  - Subagent: `sub-<subagentType>-<taskId>` (sửa hardcode `'sub'` trong `task.ts`)
- Subagent có `parentTaskId` → cây cha-con dựng được từ log.
- `turn` counter dùng chung cho agent cha và subagent của nó (deepseek style: subtool nằm trong turn
  của cha). **Sở hữu turn counter:** `MeowAgentManager` (native) duy trì `turnCounter` cho từng session,
  increment khi `turn-started`; subagent (qua `task.ts`) đọc turn hiện tại từ parent context thay vì
  tự đếm. `SessionRunner` (loop.ts) hiện chưa có turn field — thêm `turn: number` vào `LoopDeps`,
  truyền từ manager. Agent PTY không dùng turn (chỉ `pty-run`).
- `seq` tăng dần trong session → UI dedupe live vs replay.

## 5. Kiến trúc & luồng dữ liệu

### 5.1 Main process

```
src/main/agent/trace-store.ts  ← TRACE_STORE (mới, ~120 dòng)
 - TraceStore: ghi JSONL append (appendFileSync, per session file)
 - append(sessionId, event), read(sessionId) → TraceEvent[]
 - listSessions() cho UI chọn; delete(sessionId) khi xóa session
```

### 5.2 Luồng

1. `MeowAgentManager` (native) — sau mỗi `onEvent` hiện có, gọi
   `traceStore.append(sessionId, normalize(e))`; sửa `task.ts` truyền `agentId` thật
   (`sub-<type>-<id>`) + `parentTaskId`, ghi thẳng vào trace store khi subagent emit.
2. Agent PTY — `index.ts` hook sẵn `pty:data`/`exit` → ghi `pty-run` event
   (start/end/exitCode/duration).
3. **IPC mới** trong `Channels` + `AgentApi` + preload + handler:
   - `trace:list` (agentId) → danh sách session có trace
   - `trace:read` (sessionId) → `TraceEvent[]`
   - `trace:live` — push realtime qua `webContents.send(Channels.EventTrace, e)`
   - `trace:delete` (sessionId) khi xóa session
4. **Renderer** — `TracePanel.tsx` (tab trong pane native) nhận:
   - live events qua subscription
   - `trace:read` khi mở lại session cũ

### 5.3 Security/quy ước (theo AGENTS.md)

- Chỉ main ghi file; render chỉ qua `window.api`.
- Channel string chỉ dùng `Channels`, không hardcode.
- Không expose `ipcRenderer`.
- PTY chỉ ghi `pty-run` metadata, **không** ghi terminal text (tránh trùng với `logs/<agentId>.log`).

## 6. UI design

### 6.1 Vị trí

Native agent pane: **tab Chat ↔ Trace** ở header (thêm state local trong `Pane`). PTY agent: Trace tab
hiện **chỉ timeline thô** (`pty-run` + link mở log).

### 6.2 Bố cục `TracePanel.tsx`

```
┌────────────────┐
│ Overview: timeline thời gian thực từng turn │ ← dải ngang: blocks theo turn, assistant tách TTFT/decode
├────────────────┤
│ Toolbar: [search] [fold all] [turn filter]   │
├────────────────┤
│ Event ledger (theo turn):                    │
│ ▸ Turn 1 (12:01:03 · 4 steps · 1.2k tok)    │
│   ─ assistant: "Đọc file..."                │
│   ─ tool: bash "ls" (32ms) ✓                │
│   ─ tool: write "x.ts" (18ms) ✓ [12 tok]   │
│   ─ subagent ▸ research (task abc)          │
│       └ (drill-down mở transcript subagent) │
│ ▸ Between turns: compaction "..."           │
└────────────────┘
Inspector (bên phải, khi chọn 1 event):
 Token usage · duration · Input · Output · Timing · cost
```

### 6.3 Thành phần React

- `TracePanel.tsx` — container, subscription live + load lịch sử
- `TraceLedger.tsx` — virtual hóa nhẹ (chỉ render ~50 row đầu + mở rộng), fold theo turn
- `TraceTimeline.tsx` — overview dải ngang, hover tooltip
- `TraceInspector.tsx` — chi tiết event khi chọn
- `SubagentTree.tsx` — cây cha-con từ `parentTaskId`, drill-down mở inspector/sub-transcript

### 6.4 Hành vi

- Live: scroll theo bottom, nhưng nếu user đã scroll lên → không nhảy (giữ chỗ đọc)
- Replay: load `trace:read(sessionId)` → render y hệt
- Fold: mặc định fold tool input dài, mở khi click; compaction nằm "Between turns"
- Keyboard: Enter mở/fold, Esc đóng inspector
- Style: CSS vars sẵn của app (`--bg-*`, `--accent`), dark theme; không thêm thư viện

## 7. Xử lý lỗi & cạnh biên

| Tình huống | Xử lý |
|---|---|
| File trace corrupt | `read()` parse từng dòng, dòng lỗi bỏ qua + `console.warn`; không crash UI |
| Session bị xóa | `trace:delete(sessionId)` — xóa luôn file trace (không orphan) |
| Mở tab trace giữa chừng khi agent đang chạy | `trace:read` load lịch sử + subscription từ hiện tại (dedupe bằng `seq`) |
| Subagent event tới sau khi parent đã done | Vẫn ghi — cây dựng bằng `parentTaskId`, thứ tự không quan trọng |
| File log PTY quá lớn | Chỉ ghi metadata, không ghi terminal text |
| Đồng bộ live vs replay | `seq` tăng dần → UI dedupe |
| Session chưa có trace | Trả `[]` + UI empty state "No trace yet" |
| `trace:read` cho agent PTY | Trả về `pty-run` events thô |

## 8. Kiểm thử

### 8.1 Unit tests (`tests/unit/agent-trace-store.test.ts`)

1. `append` → file JSONL đúng format, nhiều dòng
2. `read` → đúng thứ tự, bỏ qua dòng corrupt
3. `delete` → xóa file, `read` → `[]`
4. `seq` tăng dần, dedupe

### 8.2 Unit tests attribution (sửa bug subagent)

5. `task.ts` truyền `agentId` = `sub-<type>-<id>` (không còn hardcode `'sub'`)
6. Event subagent có `parentTaskId` → dựng cây đúng (cha-con)

### 8.3 Integration tests

7. `agent-trace-store` ghi khi `MeowAgentManager` emit event (mock LLM)
8. PTY `pty-run` event được ghi khi pty start/exit (mở rộng `pty-manager.test.ts`)

### 8.4 E2E (Playwright) — nếu cần

9. Mở pane native → tab Trace → thấy ledger, fold/unfold, inspector

## 9. Bắt buộc trước khi hoàn thành (theo AGENTS.md)

- `npm run typecheck` pass
- `npm test` pass
- Nếu ảnh hưởng e2e: `npm run build && npm run e2e`

## 10. Tiêu chí thành công

- [ ] Native agent: mở tab Trace thấy ledger theo turn + timeline overview + inspector đầy đủ
  (token/duration/input/output/timing/cost)
- [ ] Live streaming cập nhật realtime, replay session cũ từ `traces/` y hệt
- [ ] Subagent tree dựng từ `parentTaskId`, drill-down xem transcript subagent
- [ ] PTY agent: timeline thô `pty-run` + link mở log
- [ ] Attribution: không còn hardcode `'sub'`, mọi event mang agentId thật
- [ ] Toàn bộ test + typecheck pass
