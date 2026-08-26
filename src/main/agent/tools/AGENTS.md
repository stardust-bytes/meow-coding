# AGENTS.md — src/main/agent/tools

The tool registry for the native Meow agent. Each file exports a `ToolDefinition`
(`name`, `description`, `schema` (zod), `run`) — see `types.ts`. Tools are executed by
`SessionRunner` (`../loop.ts`) and permission-gated via `decidePermission` (`../permission.ts`).

## Key files

| File | Responsibility |
|---|---|
| `types.ts` | `ToolDefinition` interface + `ToolSchema` type — the contract every tool implements. |
| `registry.ts` | `createDefaultTools()` — the default tool map handed to `MeowAgentManager`. |
| `bash.ts` | Runs shell commands (Windows: wraps via git-bash fallback; kills process tree on timeout). |
| `edit.ts` | Line-based file edit (old_string/new_string) with safety checks. |
| `write.ts` | Write/overwrite a file. |
| `read.ts` | Read a file (size-capped). |
| `apply-patch.ts` | Apply unified diff via `../apply-patch.ts`. |
| `glob.ts` | Glob file listing. |
| `grep.ts` | Text search with regex. |
| `git.ts` | Git operations (status/diff/commit...). |
| `question.ts` | Ask the user a question (blocks on `prompt-request`). |
| `todowrite.ts` | Persist a todo list for the session (`todo-updated` events). |
| `task.ts` | Spawn a subagent (`createTaskTool`). Runs under a permission context derived from the parent (narrow-only), bubbles `ask` decisions to the parent UI, denies them when running in background, snapshots its edits under the parent's agent id, and reports `state="incomplete"` when it runs out of steps. |
| `revert.ts` | Revert files via snapshot store. |
| `skill.ts` | Load a skill into context. |
| `websearch.ts` / `webfetch.ts` | Web search / page fetch (need API keys). |
| `browser.ts` | Browser control via the Chrome bridge (navigate/click/read/...). |
| `office.ts` | Create/read/edit Office documents via the officecli CLI. |
| `lsp.ts` | LSP diagnostics for a file (via `../lsp/`). |
| `snapshot-util.ts` | Snapshot helpers for tools. |

## Conventions

- Each tool is a plain object matching `ToolDefinition`; `schema` is a zod type with a `.parse()`.
- Never spawn/kill processes directly from the renderer — only tools in this folder (main process) may do so.
- `bash` on Windows: prefer Git Bash (`gitBashPath`/`buildShellCommand`), fall back to `cmd.exe` — do not break that logic.
- Add new tools to `registry.ts` and to `DEFAULT_MEOW_CONFIG.permission` in `../config.ts`.
- Subagents never receive `todowrite`: their runner has no `setTodos` sink.
- A subagent may only be given tools that already exist in the map passed to `createTaskTool`; `task` is not in that map, so subagents cannot nest.
