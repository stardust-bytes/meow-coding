# Meow Coding — Group A: Undo/Redo, Tool Truncation, Compaction nâng cao, Rename Title: Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhóm A — undo/redo theo turn + snapshot history, tool output truncation service, compaction
auto-continue + prune, rename session title.

**Trạng thái:** ✅ Đã thực thi (typecheck, 264 unit/integration tests, 6 e2e pass).

---

## 1. Snapshot history (`src/main/agent/snapshot.ts`)

- `SnapshotStore` hiện lưu `{agentId, files}` (1 bản). Đổi thành:
  - `snapshots(agentId): SnapshotEntry[]` — history stack (mỗi entry `{ agentId, ts, files }`).
  - `push(agentId, files)` — thêm vào cuối, giữ tối đa `MAX_SNAPSHOTS = 50`.
  - `pop(agentId)` — lấy & xoá entry cuối (cho undo).
  - `restoreLatest(agentId)` — restore file của entry cuối (không xoá).
  - `clear(agentId)` — giữ.
- **Migration**: entry cũ dạng `{agentId, files}` → wrap thành 1 phần tử history khi load.

## 2. Session undo/redo state (`src/main/agent/session.ts`)

- `StoredSession` thêm `undoStack: number[]` / `redoStack: number[]` (chỉ mục snapshot index? Đơn giản:
  undo/redo xử lý ngay trong manager với snapshot store, không cần field riêng — snapshot store đã có agentId).
- Migration: thêm field mặc định `[]` trong `normalize()`.

## 3. Undo/Redo logic (`src/main/meow-agent-manager.ts`)

- `undo(agentId)`:
  - stop turn đang chạy (như createSession).
  - `entry = snapshots.pop(agentId)`; nếu rỗng → return false.
  - restore files từ entry.
  - Xoá transcript items của turn gần nhất khỏi session: tìm turn (user message) cuối → cắt items từ đó.
  - Push entry vào redo stack (local map).
  - Emit `done`/`state`? Renderer reload transcript.
- `redo(agentId)`: ngược lại — restore entry từ redo, re-append? Đơn giản: redo = snapshot lại trạng thái hiện tại + restore entry undo.
- Giữ trong manager: `private redoStack = Map<agentId, SnapshotEntry[]>`.

## 4. Tool truncation service (`src/main/agent/truncation.ts`, mới)

- `TRUNCATION_DIR = userData/truncation`.
- `truncateOutput(agentId, toolId, text, opts): { preview, path }` — ghi full ra file, trả head+tail preview
  (`maxBytes`/`maxLines` default từ config, mặc định 51200/2000), marker `[Output truncated to N bytes; full at <path>]`.
- `cleanup(days = 7)` — xoá file cũ, chạy khi app khởi động.
- Áp dụng trong `message.ts toLlmMessages` (thay chỗ cắt cứng hiện tại bằng service; giữ `truncateToolOutput` làm fallback).

## 5. Compaction auto-continue + prune (`src/main/agent/loop.ts`, `compact.ts`)

- `loop.ts`:
  - Đếm `compactCount`/run, giới hạn `MAX_COMPACT_PER_RUN = 2`; sau compact vẫn `continue` vòng lặp.
  - `maybeCompact` gọi `pruneToolOutputs(items)` trước khi decide LLM compact.
- `compact.ts`: thêm `pruneToolOutputs(items, cfg)` — tool output cũ (turn >= 2, không phải `skill`) vượt
  `PRUNE_PROTECT = 40000` tokens → xoá `output` thay `[Old tool result content cleared]`; chỉ áp dụng nếu
  reclaimable >= `PRUNE_MINIMUM = 20000`.
- Config: `compaction.prune` (bool, default true) trong `MeowCompactionConfig` (+ normalize + settings).

## 6. Rename session (`src/shared`, manager, renderer)

- IPC: `SessionRename: 'session:rename'`, `AgentApi.renameSession(agentId, sessionId, title)`.
- Manager: `renameSession` → `store.setTitle(sessionId, title)` (đã có), trả `SessionSummary`.
- Preload + main handler + ipc-contract test.
- Renderer `SessionBar.tsx`: thêm nút rename (✎) mỗi row → inline input, Enter lưu.

## 7. Renderer undo/redo UI

- `PaneHeader.tsx`: nút Undo/Redo cho native agent (disabled khi rỗng).
- `ChatPanel.tsx`: gọi `window.api.undoChat(agentId)`/`redoChat` rồi `loadTranscript()`.
- IPC: `ChatUndo: 'chat:undo'`, `ChatRedo: 'chat:redo'` → `undoChat(agentId)`/`redoChat(agentId): Promise<boolean>`.

## 8. Tests

- `snapshot.test.ts` — push/pop/restoreLatest/limit 50/migration.
- `session-store.test.ts` — normalize với field mới.
- `message.test.ts` — truncation service.
- `loop.test.ts` — auto-continue giới hạn, prune.
- `ipc-contract.test.ts` — 3 channel/method mới.
- `meow-agent-manager.test.ts` — undo/redo xoá transcript, rename.
- e2e: giữ nguyên hoặc thêm rename smoke.

## 9. Verify

- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
