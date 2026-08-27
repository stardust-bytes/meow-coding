# AGENTS.md — src/main

Electron main process. The only place allowed to spawn/kill processes. Owns PTY, stores, services, IPC
handlers and the app lifecycle.

## Key files

- `index.ts` — `MainApp` coordinates everything: setState, forwards `pty:data`/`agent:state`/
  `git:status` events to the renderer; `registerIpcHandlers`; window lifecycle; `before-quit` → `pty.stopAll()`.
- `meow-agent-manager.ts` — `MeowAgentManager`: orchestrates the agent chat loop, sessions, commands,
  permissions, subagents, MCP/user tools, stats, settings. The only place that orchestrates the native agent.
  In-flight permission/question prompts are stored (with their content) so a remounted chat panel can restore
  them via `getPendingPrompt` instead of leaving the agent waiting forever.
- `pty-manager.ts` — node-pty wrapper, emits `data`/`exit` events. `buildSpawnCommand` wraps non-`.exe`
  commands through `cmd.exe` on Windows (ConPTY cannot spawn `.cmd` shims directly). Uses `tree-kill`
  to kill the entire process tree on stop.
- `workspace-store.ts` / `template-manager.ts` — CRUD on `JsonStore<T>` (`userData/workspaces.json`,
  `userData/templates.json`). TemplateManager keeps default templates from being deleted.
- `json-store.ts` — `JsonStore<T>` interface + `createJsonStore` (in-memory cache, atomic temp+rename write, retries the rename on transient Windows locks then falls back to an in-place write, optional `debounceMs` batching with `flush()`, parse error → `[]` after parking the file as `.corrupt`).
- `default-templates.ts` — default templates: opencode, claude, aider.
- `log-manager.ts` — appends each agent's output to `userData/logs/<agentId>.log`.
- `system-logger.ts` — appends app-wide logs (main/render/agent, INFO/WARN/ERROR) to `userData/logs/<YYYY-MM-DD>-log.txt`, prunes files older than 7 days on startup.
- `git-status-service.ts` — `git status --porcelain=v2 -b` (5s timeout), parses branch + dirty count.
- `alert-service.ts` — emits `idle` after a threshold (default 5 minutes) and `exit` (based on exit code).
- `notification-service.ts` — native Electron `Notification` for events that need input/done.
- `file-suggest.ts` — file suggestions for `@`-mentions (deep search across the entire project tree, ignores
  node_modules/.git/out/dist).
- `file-watcher.ts` — recursively watches the project, filters text files, batches changes (debounce 500ms).
- `models-catalog.ts` / `model-variants.ts` — model provider catalog + variants (reasoning, pricing); `fetchLiveModelsInfo` syncs any OpenAI-compatible `/models` endpoint (used when connecting a provider or clicking "Sync models"). `meow-agent-manager.connectProvider` accepts a hand-typed `models[]` (the way to add an arbitrary OpenAI-compatible baseUrl + key), falling back to live `/models` → catalog → stored list.
- `terminal-shell.ts` — `resolveShell`: picks the default shell per platform.
- `updater.ts` — electron-updater wrapper, emits `UpdaterStatusEvent`.
- `window-chrome.ts` — `getWindowChromeOptions`: hides the title-bar on Windows/Linux; `applyTitleBarTheme` re-colors the Windows overlay (min/max/close) live when the app theme toggles dark/light.
- `vault.ts` — encrypted secret store (safeStorage) for provider API keys.
- `browser/` — BrowserBridge (local WS server + pairing) + Chrome launcher + snapshot format.

## Conventions

- Pure services (PtyManager, stores/services) do not import Electron UI — testable with Vitest.
- Agent state only changes via `MainApp.setState`; the renderer is only notified when a "visible" field
  changes (status/exitCode/alert).
- Events pushed to the renderer via `win.webContents.send(Channels.Event*)`; the payload must match the contract
  in `src/shared/ipc.ts`.
- Adding IPC: add a channel to `Channels` + a method to `AgentApi` (`src/shared/ipc.ts`), a handler in
  `registerIpcHandlers`, and the corresponding implementation in preload. Do not hardcode channel strings.
- On agent exit: insert a Vietnamese hint with the `[meow]` prefix if it exits with an error (code ≠ 0) and has no output.
- Avoid orphan processes: every stop path goes through `tree-kill`; verify after changing stop logic.

## Testing

- Unit: `tests/unit/` — one test file per module: pty-spawn-command, terminal-shell,
  window-chrome, updater, models-catalog, model-variants, notification-service, file-suggest,
  file-watcher, git-status-service, alert-service, json-store, log-manager, template-manager,
  workspace-store, meow-agent-manager, ipc-contract, ...
- Integration: `tests/integration/pty-manager.test.ts` (real spawn via ConPTY, uses fixture CLI),
  `agent-stream-overlap.test.ts`, `browser/bridge-flow.test.ts`.
- Run: `npm run typecheck`, `npm test`.