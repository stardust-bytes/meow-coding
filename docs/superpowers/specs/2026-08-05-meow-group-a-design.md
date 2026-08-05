# Meow Coding — Group A: Undo/Redo, Tool Truncation, Compaction nâng cao, Rename Title: Design Spec

Ngày: 2026-08-05 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Mang nhóm tính năng "nhanh, ít rủi ro" từ opencode sang meow-coding (desktop):

1. **Undo/Redo theo turn** + **snapshot history UI** — undo từng turn agent, redo, xem lịch sử snapshot.
2. **Tool output truncation service** — output tool quá ngưỡng ghi ra file, gửi head/tail preview cho model.
3. **Compaction auto-continue + prune** — sau compact tự tiếp tục turn; prune output tool cũ.
4. **Rename session title** (thủ công + heuristic cải thiện).

## 2. Tham chiếu opencode

- `session/revert.ts` — `revert({sessionID, messageID, partID?})` snapshot FS, revert patches, xoá messages ≥ target; `unrevert`.
- `snapshot/index.ts` — hidden git repo/project; `track/patch/restore/revert/diff`. TUI `messages_undo/redo`.
- `tool/truncate.ts` — ghi full output ra truncation dir, trả head/tail preview; config `tool_output.max_lines(2000)/max_bytes(51200)`; retention 7 ngày.
- `session/compaction.ts` — auto-continue sau compact; `compaction.prune` (PRUNE_PROTECT 40k, PRUNE_MINIMUM 20k, protected `["skill"]`).
- `Session.setTitle` + rename; `agent/prompt/title.txt` (LLM title, temp 0.5).

## 3. Quyết định thiết kế (bám sát opencode, desktop-first)

### 3.1 Undo/Redo + snapshot history
- **Snapshot hiện tại**: `SnapshotStore` (userData/snapshots.json) lưu `{agentId, files: Record<path, content>}` — chỉ 1 bản, overwrite mỗi bước.
- **Đổi thành history stack**: lưu list `SnapshotEntry[] { agentId, ts, files }`; khi undo, lấy entry cuối → restore files → pop; redo → undo-stack.
- **Phân biệt undo/revert**:
  - `revert` (tool cũ) — restore toàn bộ snapshot, giữ nguyên (giữ vì agent dùng được).
  - `undo` (mới, UI) — restore về trước turn gần nhất + **xoá transcript items** của turn đó khỏi session (giống opencode revert: xoá messages ≥ target).
- **UI**: PaneHeader thêm nút Undo/Redo cho native agent; ChatPanel hiển thị nút khi có thể undo.
- **IPC**: `chat:undo` / `chat:redo` (channel + AgentApi method + preload + main handler + ipc-contract test).
- **Session lưu**: `StoredSession` thêm `undoStack`/`redoStack` (list of snapshot references) hoặc snapshot đánh index theo sessionId.
- **Giới hạn**: giữ tối đa `MAX_SNAPSHOTS=50`/agent; snapshot chỉ lưu file đã thay đổi (đã đúng).

### 3.2 Tool output truncation service
- **Ngưỡng**: `TOOL_OUTPUT_MAX_BYTES = 51200` (giống opencode), `max_lines = 2000`.
- **Flow**: trong `toLlmMessages` (hoặc trước khi build messages), nếu tool output > ngưỡng:
  - Ghi toàn bộ ra `userData/truncation/<agentId>-<toolId>.txt`.
  - Gửi cho model: head (vài KB) + `\n[Output truncated to N bytes; full output at <path>]\n` + tail (vài KB).
- **Config**: `tool_output.maxBytes`/`maxLines` trong meow.json (mặc định opencode).
- **Retention**: dọn file cũ > 7 ngày khi app khởi động (mỗi agent? một lần toàn cục).

### 3.3 Compaction auto-continue + prune
- **Auto-continue**: sau khi `compactTranscript` thành công và còn bước, `run()` tiếp tục vòng lặp (đã có); thêm giới hạn `MAX_COMPACT_PER_RUN = 2` để tránh lặp vô hạn.
- **Prune**: `compaction.prune` (config bool, mặc định true) — khi transcript vượt ngưỡng `PRUNE_PROTECT=40000` tokens của tool output cũ (từ turn >= 2, không protected `skill`), xoá `output` của các tool call cũ (thay bằng marker `[Old tool result content cleared]`), giải phóng ≥ `PRUNE_MINIMUM=20000` tokens.
- **Áp dụng**: trong `maybeCompact`, trước khi quyết định gọi LLM compact.

### 3.4 Rename session title
- **UI**: SessionBar dropdown — mỗi row thêm nút rename (pencil); click → inline input, Enter lưu.
- **Main**: `SessionStore.setTitle` đã có; thêm IPC `session:rename`.
- **Heuristic title**: giữ nguyên (không LLM title cho đợt này — tránh thêm request; cân nhắc sau).

## 4. Phạm vi

- `src/main/agent/snapshot.ts` — history stack (undo/redo).
- `src/main/agent/session.ts` — thêm undo/redo state per session; `StoredSession` field mới (migration).
- `src/main/agent/loop.ts` — integration undo/redo event, compaction auto-continue + prune.
- `src/main/agent/message.ts` — tool truncation service.
- `src/main/agent/config.ts` — `tool_output` + `compaction.prune` config.
- `src/main/agent/truncation.ts` (mới) — ghi/đọc file truncation + retention cleanup.
- `src/main/meow-agent-manager.ts` + `src/main/index.ts` — IPC `chat:undo`, `chat:redo`, `session:rename`.
- `src/shared/{ipc,types}.ts` — channel + method + types.
- `src/preload/index.ts` — triển khai.
- `src/renderer/.../ChatPanel.tsx`, `SessionBar.tsx`, `PaneHeader.tsx` — UI undo/redo + rename.
- Tests: `session-store`, `snapshot`, `message` (truncation), `loop` (auto-continue/prune), `ipc-contract`, `meow-agent-manager`.

## 5. Xử lý lỗi

- Snapshot history rỗng → nút Undo disabled.
- Undo khi agent đang chạy → stop trước rồi undo (giống createSession/switchSession).
- File truncation không ghi được → fallback gửi full output (không lỗi).
- Prune không đủ token reclaimable → bỏ qua.

## 6. Kiểm thử & tiêu chí thành công

- Undo xoá đúng transcript items + restore files; redo khôi phục lại.
- Tool output > ngưỡng → model nhận head/tail + path, full file tồn tại.
- Auto-continue chạy tối đa N lần/turn; prune xoá output tool cũ, giữ `skill`.
- Rename title lưu qua `session:rename`.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e` pass.
