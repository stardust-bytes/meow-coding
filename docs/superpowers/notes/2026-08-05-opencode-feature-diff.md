# Meow Coding — Feature Diff với opencode 1.18.11 (ghi chú)

Ngày: 2026-08-05 · Nguồn: `D:\GitHub\opencode-1.18.11` vs `D:\GitHub\meow-coding`

Đây là ghi chú toàn bộ những tính năng opencode có mà meow-coding chưa có (hoặc có ở mức khác),
được thu thập từ exploration 2 codebase. Dùng làm tài liệu tham chiếu cho các phiên brainstorm/spec sau.

---

## 1. Đã có ở meow (tương đương opencode)

- Compaction token-based + overflow detection + tool output truncation (2k).
- Subagent (task), revert/snapshot, permission ask/allow/deny + always, plan mode.
- AGENTS.md/CLAUDE.md (global + project walk-up), skills, MCP (stdio/http), user tools plugin.
- Model catalog models.dev + variant (effort), todowrite, question, sessions, settings UI, git status.

## 2. Nhóm GIÁ TRỊ CAO — chưa có, nên mang sang (candidate brainstorm)

| # | Feature | Tham chiếu opencode | Meow hiện tại |
|---|---|---|---|
| 1 | Slash commands + prompt templates (`/init`, `/review`, custom, `$1..$N`, `@path`, `` !`cmd` ``, MCP prompts/skills thành commands) | `command/index.ts`, `command/template/*`, `config/command.ts` | Không có gì |
| 2 | Undo/redo + snapshot history UI (revert/unrevert theo message) | `session/revert.ts`, TUI `messages_undo/redo` | Chỉ revert tool toàn bộ, không undo từng message |
| 3 | Cost/usage tracking + stats (cost/token theo model/ngày/project) | `Session.getUsage`, `cli/cmd/stats.ts` | Chỉ raw token mỗi turn |
| 4 | LSP tools + diagnostics (goToDefinition/findReferences/hover; diagnostics trong write/edit/apply_patch) | `tool/lsp.ts`, `lsp/language.ts` (38 servers) | Không có |
| 5 | File watcher / auto-context | `@parcel/watcher` → `Watcher.Event.Updated` | Không có |
| 6 | Tool output truncation service (ghi full ra dir, gửi head/tail preview, config `tool_output.max_lines/max_bytes`) | `tool/truncate.ts` | Cắt cứng trong `toLlmMessages` |
| 7 | Session title qua LLM + rename | `agent/prompt/title.txt`, `Session.setTitle` | Auto-title heuristic, không rename |
| 8 | Compaction auto-continue + prune (xoá output tool cũ) | `session/compaction.ts` | Compact nhưng không auto-continue/prune |

## 3. Nhóm GIÁ TRỊ TRUNG BÌNH — tuỳ phạm vi

- Export/Import session (`cli/cmd/export.ts`/`import.ts`, sanitize).
- `/review` + git integration nâng cao (`git/index.ts`, `command/template/review.txt`, `opencode pr`).
- `opencode run`/`serve`/`web`/`attach`/`acp` (CLI headless; `serve` mở đường làm web).
- Themes + keybinding remap (`tui.json`, `theme_list`).
- Tool output semaphore lock + fuzzy edit (9 replacers) + apply_patch move/delete.
- Formatting tự động khi edit (`format/formatter.ts`).
- `references` block (named git repos), `instructions` globs + remote URL, proximity AGENTS.md khi read.
- MCP resources + MCP OAuth (`list_mcp_resources`, RFC 7591).
- Per-session model/variant.
- Stash prompt, queued prompts, history navigation.

## 4. Nhóm KHÔNG PHÙ HỢP — bỏ qua

- TUI/CLI nặng (`opencode run` interactive, vim keymap, mini TUI, upgrade/uninstall/db/debug CLI).
- Telemetry OpenTelemetry, MDM managed config, autoshare cloud.

---

## Chi tiết tham chiếu từng feature (kèm file opencode)

### Slash commands
- `packages/opencode/src/command/index.ts` — `Command.Default.INIT/REVIEW`, MCP prompts → commands, skills → commands.
- `packages/opencode/src/config/command.ts` — `command` block: `template/description/agent/model/variant/subtask`.
- `packages/core/src/v1/config/command.ts` — schema.
- Template variables: `$1..$N`, `$ARGUMENTS`, `@path`/`@agent`, `` !`cmd` ``.
- Execution: `SessionPrompt.command` — resolves template, optional subtask, overrides, hooks.

### Undo/redo + snapshot
- `packages/opencode/src/session/revert.ts` — `revert({sessionID, messageID, partID})` snapshot FS, revert patches, xoá messages ≥ target, `unrevert`.
- `packages/opencode/src/snapshot/index.ts` — hidden git repo per project, `track/patch/restore/revert/diff`.
- TUI keybinds `messages_undo`/`messages_redo`.

### Cost/stats
- `packages/opencode/src/session/session.ts` `getUsage` — input/output/reasoning/cache tokens, cost per 1M (tiers).
- `packages/opencode/src/cli/cmd/stats.ts` — aggregate sessions/messages/cost/tokens, tool histogram, per-model, cost/day.

### LSP + diagnostics
- `packages/opencode/src/tool/lsp.ts` — operations goToDefinition/findReferences/hover/documentSymbol/workspaceSymbol/goToImplementation/prepareCallHierarchy/incoming/outgoingCalls.
- `packages/opencode/src/lsp/language.ts` — builtin server list (38).
- Diagnostics nhúng trong write/edit/apply_patch outputs.

### File watcher
- `packages/core/src/filesystem/watcher.ts` — `@parcel/watcher`, per-OS backends.
- TUI `app_toggle_file_context`.

### Tool output truncation service
- `packages/opencode/src/tool/truncate.ts` — write full output to truncation dir, return head/tail preview, 7-day retention.
- Config `tool_output.max_lines`(2000)/`max_bytes`(51200).

### Title LLM + rename
- `packages/opencode/src/agent/prompt/title.txt` — hidden `title` agent, temp 0.5, small_model fallback.
- `Session.setTitle` + rename UI.

### Compaction nâng cao
- `packages/opencode/src/session/compaction.ts` — auto-continue sau compact, `compaction.prune` xoá output tool cũ (PRUNE_PROTECT 40k, PRUNE_MINIMUM 20k, protected `["skill"]`).
