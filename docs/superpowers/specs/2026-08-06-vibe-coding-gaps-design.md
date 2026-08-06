# Meow Coding — Vibe Coding Gaps (opencode + bigtech) : Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (feature list + design tổng, chưa code)

## 1. Mục tiêu

Xác định các gap khiến trải nghiệm "vibe coding" của meow-coding chưa tốt, đối chiếu với
[opencode](https://github.com/anomalyco/opencode) (repo mới nhất: `background/job`, `image`,
`worktree`, `share`, `acp`, `ide`) và các big tech (Cursor, Claude Code, Codex CLI, Jules, Copilot).

Đây là **design doc tổng** — phủ toàn bộ gap quan trọng, chia nhóm P0/P1/P2 kèm thiết kế từng tính năng,
đủ để tách thành các spec/plan triển khai riêng. Chưa implement gì trong phiên này.

## 2. Bối cảnh & hiện trạng

Meow Coding là **desktop multi-agent manager** (không phải CLI/TUI): Electron + React, PTY per agent,
native agent loop riêng (`src/main/agent/loop.ts`), IPC contract tập trung (`src/shared/ipc.ts`).

Đã có sẵn (từ các đợt port trước): agent loop + 17 tools, sessions + undo/redo + snapshot,
slash commands + template, MCP, LSP + diagnostics, compaction + truncation, stats/cost
(`getStats`), model catalog + variants, file watcher (`FileWatcher` + `ContextChangedEvent`),
@mention expansion phía main (`expandReferences`).

## 3. Gap analysis tổng

| # | Gap | Hiện trạng meow | Tham chiếu opencode | Nhóm |
|---|---|---|---|---|
| 1 | **Image/UI input** | `ChatMessage` text-only; `llm.ts` không có image parts; ChatInput không paste/drop | `src/image/image.ts`, tool output attachments | P0 |
| 2 | **Background + OS notify** | Chỉ `AlertService` idle-detect; chưa dùng Electron `Notification`; native agent vẫn gắn pane | `src/background/job.ts` | P0 |
| 3 | **@-file mention UI** | `expandReferences` chạy ở main nhưng không có autocomplete/chip | `@path`/`@agent` trong command template | P0 |
| 4 | **Live cost/token** | `getStats()` có nhưng render không dùng; loop chỉ emit usage per-step | `cli/cmd/stats.ts`, `Session.getUsage` | P1 |
| 5 | **File watcher → auto-context** | `ContextChangedEvent` emit nhưng render không consume (chết) | `@parcel/watcher` → auto-context | P1 |
| 6 | **Auto-fix loop** | loop có `maxSteps`, bash tool có timeout; chưa có vòng lặp test→sửa | code-mode/shell, Jules/Codex | P2 |
| 7 | **Session export/share** | `StoredSession` JSON store thuần; có `task` tool | `share/session.ts`, `share-next.ts` | P2 |

## 4. P0 — Vibe blockers (3 tính năng)

### 4.1 Image input + preview (dán ảnh vào chat)

**Integration points (đã xác minh):**
- `ChatMessage` (src/shared/types.ts) — hiện chỉ `{id, role, text, reasoning?, createdAt}`.
- `ChatInput.tsx` — không có paste/drop handler; có command menu pattern để tái dùng UI.
- `toLlmMessages` (src/main/agent/message.ts) — build user content dạng string `{role:'user', content: text}`.
- `sendChat` đi qua `Channels.ChatSend` → `meowAgent.send(agentId, text)`.

**Thiết kế:**
- `shared/types.ts`: thêm
  ```ts
  export interface ImageAttachment {
    id: string
    name: string
    mimeType: string
    dataUrl: string
    size: number
    width?: number
    height?: number
  }
  // ChatMessage thêm field optional:
  images?: ImageAttachment[]
  ```
- `ChatInput`: `onPaste` (clipboard → `item.getAsFile()` → `FileReader` → dataURL) + `onDrop`
  (kéo-thả file ảnh). Hiển thị **thumbnail chips** dưới textarea trước khi gửi, xóa được từng ảnh.
  Giới hạn: tối đa **4 ảnh / lần**, tối đa **5MB / ảnh** — quá giới hạn: từ chối + thông báo nhẹ.
- `ChatPanel`: render thumbnail trong user message; click → lightbox phóng to (component đơn giản).
- `AgentApi.sendChat(agentId, text, images?)` → `ChatSend` payload mở rộng (images optional).
- `toLlmMessages`: user message có ảnh → ai SDK content parts `[{type:'text', text}, {type:'image', image: dataUrl}]`.
- Model không hỗ trợ vision → main lọc ảnh + thông báo `[meow] Model không hỗ trợ ảnh.` (giữ text).
- Session store: lưu `images` vào transcript (field optional → không cần migration dữ liệu cũ).

**Out of scope:** compress/resize ảnh, chụp màn hình vùng chọn, agent gửi ảnh về (P2).

### 4.2 Background + OS notifications

**Integration points (đã xác minh):**
- `AlertService` (src/main/alert-service.ts) — idle detect, chưa emit Notification.
- `MeowAgentManager.pendingPrompts.set` (src/main/meow-agent-manager.ts ~591) — điểm agent đang chờ input.
- Electron `Notification` chưa được import ở main.
- Native agent loop chạy trong main process, **không phụ thuộc pane hiển thị** → nền hóa nhẹ được.

**Thiết kế (3 phần):**
- **a) OS Notification khi cần input:** tại `pendingPrompts.set` + permission ask (`decidePermission === 'ask'`)
  → `new Notification({title: '[meow] Cần bạn nhập', body: <agent> đang chờ ...}).show()`.
  Click notification → `win.show()` + focus + chuyển tới pane agent đó.
- **b) OS Notification khi hoàn thành:** agent turn kết thúc (`done` event) / session finish / agent exit
  → notify kèm tóm tắt ngắn (số turn, cost, status). **Chỉ notify khi window không focused**
  hoặc pane không visible (tránh spam).
- **c) Background mode per agent:** nút "chạy nền" trên PaneHeader → pane thu gọn thành **badge strip**
  (status + cost + thời gian chạy); agent vẫn chạy bình thường. Xong → notification + badge nhấp nháy;
  click badge → mở lại pane đầy đủ. App minimize không kill agent (Electron mặc định).

**Out of scope P0:** job-list thuần không-pane kiểu opencode `background/job.ts` (xem P1/P2 nếu cần).

### 4.3 @-file mention UI

**Integration points (đã xác minh):**
- `expandReferences` (src/main/agent/references.ts) — chạy ở `meow-agent-manager.ts:176`, regex `@([\w./\\-]+)`.
- `ChatInput` có command menu (dropdown) — tái dùng pattern cho file suggestions.
- File watcher đã có ignore node_modules/.git.

**Thiết kế:**
- Gõ `@` trong ChatInput → dropdown **file suggestions** (giống command menu): invoke mới
  `files:suggest(agentId, prefix)` → main glob, giới hạn **20 kết quả**, ignore node_modules/.git/out,
  trả relative path + icon theo loại file.
- Chọn → chèn `@path` vào text + **chip "attached"** dưới textarea.
- Cải tiến `expandReferences`: hỗ trợ prefix `./`, path tương đối; path có space → cú pháp `@"path with space"`
  (mở rộng regex).
- ChatPanel: user message chứa `@path` → render dạng mention chip/link (khi file tồn tại).

**Out of scope:** fuzzy search toàn workspace, đệ quy thư mục đầy đủ.

## 5. P1 — Context quality (2 tính năng)

### 5.1 Live cost/token

**Integration points (đã xác minh):**
- `getStats()` (src/main/meow-agent-manager.ts:469) — có `perSession/perModel/totalCost`.
- `StatusBar.tsx` — render workspace/git/running, chưa có cost.
- Loop emit `onUsage` per-step (đã có) + `done` event.

**Thiết kế:**
- **Live theo pane:** loop `onUsage` → emit `ChatEvent` mới `usage` → ChatPanel cập nhật chip cost/token
  của turn đang chạy (cạnh context bar đã có).
- **StatusBar:** thêm item cost session hiện tại + tổng workspace: `$0.42 · 128k tok` (format gọn, dùng
  `calcCost`/`getStats`).
- **SessionBar:** mỗi session hiển thị cost nhỏ bên cạnh title.
- Settings/Session list: view "Usage by session/model" dùng `perModel` + `perSession` đã có.
- Refresh: push qua event (không polling) — `done`/`usage` → render gọi lại `getStats()`.

**Out of scope:** chart phức tạp, cost theo ngày, cảnh báo ngân sách.

### 5.2 File watcher → auto-context

**Integration points (đã xác minh):**
- `FileWatcher` emit `ContextChangedEvent {projectPath, files}` → `onContextChanged` đã expose trong preload
  nhưng **render không subscribe** (chết).
- `expandReferences` — nơi file được đưa vào prompt.

**Thiết kế:**
- **Consume ở render:** App.tsx subscribe `onContextChanged` → state per-workspace "files changed since
  last send".
- **ChatPanel:** chip bar "📎 3 files changed" → click → dropdown list; **mặc định không auto-include**
  (tránh nhiễu context); user chọn "attach all" hoặc từng file → gửi kèm như @mention.
- **Main-side auto-context (optional, default off):** setting `autoContext {enabled, maxFiles}` — khi bật,
  meow tự chèn changed files vào system prompt của turn kế (dạng `[Changed files]\n...`), giới hạn 10 file
  + truncate.
- **Cải tiến watcher:** giữ debounce hiện tại; thêm lọc bằng `GitStatusService` dirty list (tránh file
  chưa track / không liên quan).

**Out of scope:** watch loại trừ tùy biến theo project; auto-attach mid-turn (chỉ đầu turn).

## 6. P2 — Loop + collaboration (2 tính năng)

### 6.1 Auto-fix loop (test/lint → sửa → lặp)

**Integration points (đã xác minh):**
- Loop có `maxSteps`, `done` reason, plan/build mode, permission decide.
- bash tool có `timeoutMs` (mặc định 120s).

**Thiết kế:**
- Setting mới: `autoFix {enabled, maxRounds, command}` (VD `npm test` / `npx tsc --noEmit`). Mặc định off.
- Cơ chế: sau khi agent trả lời "xong" (finish reason) trong **build mode** → nếu `autoFix.enabled` và còn
  round → meow **tự chạy command** ở main (spawn, 60s timeout, không qua agent) → exit ≠ 0 →
  nối `[auto-fix attempt N] <output>` vào prompt → agent sửa → lặp tối đa `maxRounds`.
- Vòng lặp **nằm ngoài** agent loop (điều phối ở `MeowAgentManager.send`) — tránh đụng `MAX_STEPS`/compaction,
  dễ tắt giữa chừng.
- Hiển thị: mỗi round là 1 message hệ thống trong transcript (tool-like card "auto-fix run #1 failed:
  12 errors"); user thấy được và có thể Stop.
- **Chỉ build mode**; plan mode không chạy.

**Out of scope:** tự cài dependencies; chọn lệnh tự động theo project (1 command cấu hình);
fix song song nhiều agent.

### 6.2 Session export / share context giữa agent

**Integration points (đã xác minh):**
- `StoredSession {id, agentId, projectPath, title, items, todos, usage}` — JSON store thuần.
- `task` tool (subagent) đã hoạt động.

**Thiết kế:**
- **Export:** menu trên SessionBar → export session ra file:
  - **Markdown** (`session.md`): transcript đẹp kèm tool calls tóm tắt + usage.
  - **JSON** (`session.json`): nguyên `StoredSession` — để import lại / chuyển máy.
- **Share giữa agent:** dialog "Send context to agent..." → chọn agent khác trong workspace → meow gửi bản
  tóm tắt (title + user messages + final answer mỗi turn, giới hạn 6k tokens) làm **user message đầu tiên**
  của session mới bên nhận, kèm note nguồn.
- **Import:** chọn `session.json` → tạo session mới với items đã có (validate schema + remap
  agentId/projectPath).

**Out of scope:** sync cloud; diff 2 session; export theo filter turn.

## 7. Quyết định chung (shared design)

| Chủ đề | Quyết định |
|---|---|
| **Config mới** | Thêm vào `MeowSettings`/`MeowConfig`: `autoFix {enabled, maxRounds, command}`, `autoContext {enabled, maxFiles}`, `notifications {needsInput, onDone}` — mặc định an toàn; normalize hàm riêng trong config.ts |
| **Migration** | Mọi field mới **optional** → JSON store / meow.json cũ đọc được; transcript thêm `images?` optional |
| **IPC** | Channel mới qua `Channels` (không hardcode): `files:suggest`, `session:export`, `session:import`, `session:share`, `stats:live` (event) |
| **Notify** | Chỉ hiện khi window không focused / pane không visible; prefix `[meow]` tiếng Việt (AGENTS.md); click → focus window + pane |
| **Image** | `ImageAttachment` dataUrl; ≤4 ảnh/lần; ≤5MB/ảnh; model không vision → lọc + thông báo |
| **@mention** | Cú pháp `@path` (space → `@"path"`); suggest 20 kết quả; ignore node_modules/.git; chip attach |
| **Test bắt buộc** | `npm run typecheck` + `npm test` pass; e2e nếu đụng IPC/UI chính (P0) |

## 8. Phân nhóm & thứ tự triển khai

| Phase | Tính năng | Ghi chú tách |
|---|---|---|
| P0 — Vibe blockers | 4.1 Image · 4.2 Background/notify · 4.3 @-mention | 3 pain point user chọn; độc lập, mỗi cái 1 spec riêng |
| P1 — Context quality | 5.1 Live cost · 5.2 Auto-context | Dùng chung hạ tầng event đã có |
| P2 — Loop + collaboration | 6.1 Auto-fix · 6.2 Export/share | Lớn nhất; sau khi loop/sessions ổn định |

Mỗi tính năng khi triển khai sẽ có spec + plan riêng theo workflow
(brainstorm → spec → plan → thực thi), bám các quyết định chung ở mục 7.

## 9. Rủi ro & tham chiếu opencode

- Image: model vision phụ thuộc provider; dataUrl làm transcript JSON nặng → giới hạn 5MB/ảnh + chỉ lưu
  trong session hiện tại.
- Notification: spam nếu không check focus → điều kiện "window not focused / pane not visible".
- @mention path có space: cú pháp `@"..."` làm thay đổi regex hiện tại → giữ backward-compatible
  `@path` không space.
- Auto-fix: vòng lặp vô hạn → `maxRounds` giới hạn cứng + user Stop.
- Share context: token limit 6k tóm tắt → không share full transcript giữa agent.
- Tham chiếu file opencode: `src/image/image.ts`, `src/background/job.ts`, `src/share/session.ts`,
  `src/tool/truncate.ts`, `cli/cmd/stats.ts`, `session/revert.ts`.
