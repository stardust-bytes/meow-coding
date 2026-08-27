# 04 — Tool Catalog

Every callable the native Meow agent can invoke. Implementations live in
`src/main/agent/tools/`; the default map is assembled by `createDefaultTools()` in `registry.ts`.

## 4.1 The tool contract

```ts
// src/main/agent/tools/types.ts
export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema          // a zod type (has .parse()) or a raw JSON-schema object
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}

export interface ToolRunResult {
  output?: string
  error?: string
  background?: boolean
}
```

`ToolContext` is documented in [03 — Tool execution](03-agent-runtime.md#35-tool-execution-sessionrunnerexecutecall).

### Where tools come from

The runner's tool map is assembled in this order (later entries overwrite earlier ones):

```
createDefaultTools()                       built-ins (see below)
  + loadUserTools(userData/tools)          user JS modules
  + mcp.getTools()                         MCP server tools
  → then per-agent overrides in register():
      task    (built fresh per agent, wired to that agent's permissions/snapshots)
      revert
      lsp     (only when meow.json lsp.enabled)
```

### Adding a tool — checklist

1. Implement it in `src/main/agent/tools/<name>.ts` exporting a `ToolDefinition`.
2. Register it in `registry.ts` (`createDefaultTools`).
3. Add a default permission in `DEFAULT_MEOW_CONFIG.permission` (`src/main/agent/config.ts`).
   Without one, the tool falls through to `ask`.
4. Add a unit test under `tests/unit/agent-tools-*.test.ts`.
5. Update `src/main/agent/tools/AGENTS.md`.

## 4.2 Built-in tools

Default permission column is from `DEFAULT_MEOW_CONFIG.permission`; users can override any of these
in Settings → Permissions.

| Tool | Default | Purpose |
|---|---|---|
| `read` | allow | Read a text file |
| `write` | allow | Create/overwrite a file |
| `edit` | allow | Exact-match string replace |
| `apply-patch` | allow | Apply a unified diff |
| `glob` | allow | Find files by glob |
| `grep` | allow | Regex search file contents |
| `todowrite` | allow | Maintain the session todo list |
| `task` | allow | Dispatch a subagent |
| `revert` | allow | Restore all files changed this session |
| `skill` | allow | Load a skill into context |
| `question` | allow | Ask the user an interactive question |
| `browser_*` | allow | Drive the paired Chrome profile |
| `bash` | **ask** | Run a shell command |
| `office` | **ask** | Run OfficeCLI on `.docx`/`.xlsx`/`.pptx` |
| `git` | (unset → ask) | Run a git command |
| `webfetch` | (unset → ask) | Fetch a URL as markdown |
| `websearch` | (unset → ask) | Tavily web search |
| `lsp` | (unset → ask) | Language-server queries for a file |

### `read`

`{ file_path: string, offset?: number (0-based line), limit?: number }`

Resolves relative paths against the agent cwd. Returns at most **2000 lines** and **20 000
characters**; a header line reports the visible range. Calls `ctx.onFileRead(full)` and appends any
returned `<system-reminder>` block with nearby `AGENTS.md`/`CLAUDE.md` content.

### `write`

`{ file_path: string, content: string }`

Snapshots the previous content (for undo), creates parent directories, writes, records an artifact
(`create` if the file did not exist, else `edit`), and appends LSP diagnostics when available.

### `edit`

`{ file_path: string, old_string: string, new_string: string }`

`old_string` must match **exactly once** — zero matches and multiple matches are both errors
(`make it unique`). Same snapshot/artifact/diagnostics behavior as `write`.

### `apply-patch`

`{ patch: string }` — a unified diff with `---`/`+++` headers and `@@` hunks. Parsed and applied by
`src/main/agent/apply-patch.ts`.

### `glob`

`{ pattern: string }` — relative to the agent cwd, ignores `**/node_modules/**` and `**/.git/**`,
no dotfiles, max **200** results (a `... (N more)` suffix reports the remainder).

### `grep`

`{ pattern: string (regex), path?: string, include?: string[] }`

Candidate files from `include` (default `**/*`), ignoring `node_modules`/`.git`. Scans at most
**500 files**, skips files over **1MB**, returns at most **200** hits as `relpath:line: text`
(each line trimmed to 160 chars).

### `bash`

`{ command: string, timeoutMs?: number (default 120 000) }`

Shell selection (`buildShellCommand`):

| Platform | Shell |
|---|---|
| Windows + Git Bash found | `bash.exe -lc "cd -- \"$1\"; <command>" opencode <cwd>` — unix commands and shell-script skills work |
| Windows without Git Bash | `cmd.exe /d /s /c "<command>"` with `windowsVerbatimArguments` so embedded quotes survive |
| POSIX | `sh -c "<command>"` |

Git Bash discovery order: `MEOW_GIT_BASH_PATH` env → `<git dir>/../bin/bash.exe` resolved from
`PATH` → `%SystemDrive%\Program Files[ (x86)]\Git\bin\bash.exe`.

Output: `stdout` plus `\n[stderr]\n<stderr>` when present, capped at 1MB per stream. Non-zero exit
becomes an error containing the output. A missing cwd falls back to the home directory with a
`[meow]` note.

**Kill behavior**: timeout and user-abort both go through `killAfterGrace`, which on Windows waits
until 600ms after spawn before `tree-kill`. Git Bash re-execs itself once, so a `taskkill /t`
snapshot taken too early can miss the innermost command. This is a heuristic, not a guarantee — a
heavy `~/.bash_profile` can push tree formation past the window.

### `git`

`{ args: string }` — the argument string is tokenized (quote-aware) and passed to `git` via
`execFile` (no shell). 60s timeout, 4MB buffer, `tree-kill` on abort. A missing cwd falls back to
the home directory.

### `question`

`{ question: string, header?: string, options?: [{label, description?}], multiple?: boolean, custom?: boolean }`

Emits a `prompt-request` with `kind: 'question'` and blocks until the user answers. Returns
`User answered: <answer>`; an empty/cancelled answer is an error. The system prompt explicitly tells
the agent to use this instead of writing questions as plain text.

### `todowrite`

`{ todos: [{ content, status: 'pending'|'in_progress'|'completed'|'cancelled', priority?: 'high'|'medium'|'low' }] }`

Writes to the session's todo list and emits `todo-updated`. Its description is a full usage policy
ported from opencode (use for 3+ step work, exactly one `in_progress`, update in real time, never
mark complete on intent). **Subagents never receive this tool** — their runner has no `setTodos` sink.

### `task`

`{ description: string, prompt: string, subagent_type?: string (default 'research'), task_id?: string, background?: boolean }`

See [03 — Subagents](03-agent-runtime.md#311-subagents-the-task-tool). Multiple `task` calls in one
message run in parallel (they are auto-approved, and the loop runs auto-approved calls concurrently).

### `revert`

`{}` — rewrites every file recorded in this agent's snapshot store back to its original content.
Returns `reverted N file(s)`.

### `skill`

`{ name: string }` — returns the skill body plus a "Skill directory" hint so the agent can read
supporting `scripts/` or `references/` files. Unknown names return the available list.

### `webfetch`

`{ url: string, maxChars?: number (default 8000) }` — `http(s)` only, 15s timeout, follows
redirects, `user-agent: meow-coding/0.1`. HTML is converted to markdown with Turndown (fenced code
blocks); blank runs are collapsed; the result is truncated with `...(truncated)`.

### `websearch`

`{ query: string }` — Tavily API. Requires the **`TAVILY_API_KEY` environment variable**; without
it the tool returns a Vietnamese `[meow]`-style error explaining that.

### `lsp`

`{ operation: 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol', file_path: string }`

Only registered when `meow.json` has `lsp.enabled: true` and an `LspManager` is available.

### `office`

`{ args: string[], timeoutMs?: number (default 120 000) }`

Spawns the OfficeCLI binary with the given argv (no shell). `--json` is appended automatically.
`OFFICECLI_SKIP_UPDATE=1` is set. The binary is resolved (and downloaded + verified on first use) by
`src/main/officecli/binary-manager.ts`; a failure returns actionable install instructions.

Examples: `["create","report.docx"]`,
`["add","deck.pptx","/","--type","slide","--prop","title=Q4"]`.

## 4.3 Browser tools (`browser_*`)

Registered only when the browser bridge and launcher are wired in (`createDefaultTools({ browser })`).
All default to `allow` via the `browser_*` wildcard rule. They require a paired Chrome extension —
see [08 — Browser bridge](08-integrations.md#83-chrome-browser-bridge).

| Tool | Input | Behavior |
|---|---|---|
| `browser_start` | `{}` | Ensure the bridge is connected. If unpaired, opens Chrome, shows install steps, and waits for pairing. Returns bridge status. |
| `browser_navigate` | `{ url, ... }` | Opens the URL in a **new background tab** of an existing window, grouped under "Meow". Never hijacks an existing tab. Returns a `tabId`. |
| `browser_open_tab` | `{ url, ... }` | Same, and never opens a new Chrome window unless none are open; does not focus Chrome. |
| `browser_click` | `{ ref? , selector?, x?, y? }` | Click by snapshot ref (preferred), CSS selector, or viewport coordinates. |
| `browser_type` | `{ ref?, selector?, text, ... }` | Type into an input/textarea/select. |
| `browser_select` | `{ ref?, selector?, value }` | Select an option in a `<select>`. |
| `browser_scroll` | `{ direction?: up\|down\|top\|bottom, selector? }` | Scroll or bring an element into view. |
| `browser_read` | `{ tabId?, mode? }` | Snapshot the page into a Playwright-MCP-style structure file: one indented line per element as `role "name" [ref]`. Refs feed the other tools. |
| `browser_list_tabs` | `{}` | id, title, url, active, window and tab-group info. |
| `browser_switch_tab` | `{ tabId }` | Activate a tab without focusing the Chrome window. |
| `browser_close_tab` | `{ tabId }` | Close a tab. |
| `browser_console` | `{ limit? ≤200 }` | Recent console logs. |
| `browser_network` | `{ limit? ≤200 }` | Recent network requests (method, url, status). |
| `browser_wait_for` | `{ selector, timeoutMs? }` | Poll until a CSS selector exists. |

Commands time out after 30s at the bridge level. When the bridge is not paired, every command
returns `browser not connected — run browser_start first`.

## 4.4 MCP tools

`McpManager.getTools()` converts each connected server's tools into `ToolDefinition`s. Names come
from the server, so permission rules for them must be added explicitly (they otherwise fall through
to `ask`). Output exceeding `mcpOutput.maxTokens` (default 25 000) is replaced by a head/tail
preview plus the path of the full output on disk. See
[08 — MCP](08-integrations.md#81-mcp-model-context-protocol).

## 4.5 User tools

`loadUserTools(['<userData>/tools'])` dynamically imports every `*.js` / `*.cjs` file in the
directory. Each must default-export:

```js
export default {
  name: 'my-tool',            // optional; defaults to the file basename
  description: 'What it does',
  schema: { type: 'object', properties: { /* JSON Schema */ } },
  async run(input, ctx) {
    return { output: 'result' }   // or { error: '...' }
  }
}
```

Load failures are logged (`[meow] failed to load user tool "<file>"`) and skipped — one bad module
never blocks the others. User tools are loaded during `syncTools()`, i.e. on `init`, `reload` and
`reconnectMcp`.

## 4.6 Behavioral notes that matter when editing tools

- **Only main-process code may spawn or kill processes.** Never add a tool that shells out from the
  renderer.
- **Snapshot before mutating.** Any tool that changes a file must call `snapshotFile(ctx, path)`
  (`snapshot-util.ts`) *before* writing, or undo/revert will silently lose that file.
- **Record artifacts.** `recordArtifact(ctx, path, 'create'|'edit')` is what populates the
  right-panel Artifacts list for native-agent edits.
- **Respect `ctx.signal`.** Long-running tools must abort on it, and must kill their process tree —
  not just the direct child.
- **Return errors, do not throw.** The loop catches throws into `call.error`, but a returned
  `{ error }` produces a cleaner transcript entry.
- **Keep outputs bounded.** The truncation layer will cap what reaches the model, but an unbounded
  string still costs memory and disk.
