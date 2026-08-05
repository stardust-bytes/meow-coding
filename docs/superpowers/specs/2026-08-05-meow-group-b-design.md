# Meow Coding — Group B: Slash Commands, Cost/Stats, File Watcher: Design Spec

Ngày: 2026-08-05 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Mang nhóm tính năng "vừa, cần spec kỹ" từ opencode sang meow-coding (desktop):

1. **Slash commands + prompt templates** — `/init`, `/review`, custom commands, template variables.
2. **Cost/usage tracking + stats** — cost/token theo session/model, hiển thị UI.
3. **File watcher** — theo dõi file thay đổi trong project, cung cấp context cho native agent.

Theo quyết định brainstorm: **bám sát opencode**, bỏ các command thuần CLI/settings cho desktop
(`upgrade`, `uninstall`, `db`, `debug`, `serve`, `attach`, `acp`, `pr`, `generate`).

## 2. Tham chiếu opencode

- `command/index.ts` — `Command.Default.INIT/REVIEW`, MCP prompts→commands, skills→commands.
- `config/command.ts` — `command` block: `template/description/agent/model/variant/subtask`.
- `session/getUsage`, `cli/cmd/stats.ts` — cost/token.
- `core/src/filesystem/watcher.ts` — `@parcel/watcher`.

## 3. Quyết định thiết kế

### 3.1 Slash commands + prompt templates
- **Model data**: `Command { name, description, template, agent?, model? }`.
- **Store**: `userData/commands.json` (giống templates.json) + built-in `/init`, `/review`.
  Ngoài ra load từ `project/.meow/commands/*.md` (frontmatter name/description + body template).
- **Template variables**: `$1..$N` (slurp remainder), `$ARGUMENTS`, `@path` → expandReferences (đã có),
  `` !`cmd` `` → chạy shell lấy output.
- **Resolver**: `resolveCommandTemplate(template, args)` trong `src/main/agent/commands.ts` (mới).
- **UI**: ChatInput — gõ `/` mở autocomplete danh sách commands; chọn → điền template, replace `$1..$N`.
  Hiển thị mô tả command.
- **Thực thi**: command chạy như một user message (đã resolve template) qua `send` hiện tại. Nếu command
  có `subtask` (giống opencode) → bọc thành task tool; đợt này để đơn giản: mọi command resolve → send.
- **IPC**: `commands:list` (lấy built-in + user + project), `commands:save`, `commands:remove`.

### 3.2 Cost/usage tracking + stats
- **Nguồn giá**: `models.dev` `cost: { input, output, cache_read, cache_write }` (đã có trong catalog limits path).
- **Tính cost**: mỗi `done` event có `tokens` → `cost = input*price_input/1M + output*price_output/1M`.
  Lưu vào `StoredSession` field `usage` (cumulative per session) + per-turn vào log.
- **UI**:
  - StatusBar hoặc ChatPanel: sau mỗi turn hiển thị `$0.00 · tokens`.
  - Settings: mục nhỏ hiển thị tổng cost/tokens của provider (đọc từ sessions).
- **Lưu trữ**: `userData/sessions.json` field `usage: { input, output, cacheRead, cacheWrite, cost }`.
  `usageFor(agentId)` aggregate.
- **IPC**: `stats:get` → `{ totalCost, totalTokens, perModel, perSession }`.

### 3.3 File watcher
- **Implement**: dùng `fs.watch` (Node builtin, tránh native module cần rebuild như node-pty).
  Watch project root recursive; debounce 500ms.
- **Context**: mỗi turn native agent, đưa "recently changed files" vào system prompt (`@context` note)
  hoặc event `context:changed` → ChatPanel hiển thị badge "N files changed".
- **Giới hạn**: ignore `node_modules`, `.git`, `out`, `dist`; theo dõi các file text (extension allow-list).
- **Lifecycle**: bật khi workspace mở (cùng `startGitPoll`), tắt khi đóng/remove.
- **IPC**: event `context:changed` (payload `{ projectPath, files: string[] }`).

## 4. Phạm vi

- `src/main/agent/commands.ts` (mới) — CommandStore + resolver + built-ins.
- `src/main/command-store.ts` hoặc gộp vào commands.ts — userData/commands.json.
- `src/main/file-watcher.ts` (mới) — `fs.watch` wrapper.
- `src/main/agent/usage.ts` (mới) — cost calc.
- `src/main/agent/session.ts` — `usage` field + aggregate.
- `src/main/agent/loop.ts` — tính cost ở done event.
- `src/main/meow-agent-manager.ts` + `src/main/index.ts` — IPC `commands:list/save/remove`, `stats:get`, event `context:changed`.
- `src/shared/{ipc,types}.ts` — channel + method + types (`Command`, `UsageSummary`, `ContextChangedEvent`).
- `src/preload/index.ts`.
- `src/renderer/.../ChatInput.tsx`, `ChatPanel.tsx`, `SettingsDialog` (commands tab), `StatusBar`.
- Tests: `commands`, `usage`, `file-watcher`, `ipc-contract`, `session-store`.

## 5. Xử lý lỗi

- Command không tìm thấy → báo trong chat (error event).
- Template parse lỗi → giữ nguyên text, vẫn gửi.
- Không có cost cho model → cost = 0, hiển thị token thôi.
- `fs.watch` lỗi (quá nhiều file) → dừng watcher, không crash app.
- Shell trong template (`!cmd`) timeout 10s, lỗi → thay bằng error text.

## 6. Kiểm thử & tiêu chí thành công

- `/init` tạo/sửa AGENTS.md gợi ý; `/review` chạy review (git diff).
- Custom command resolve `$1..$N`/`$ARGUMENTS`/`@path`.
- Cost hiển thị đúng sau turn; `stats:get` aggregate đúng.
- Watcher phát event khi file thay đổi; ignore đúng dirs.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e` pass.
