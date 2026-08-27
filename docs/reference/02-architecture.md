# 02 — Architecture

## 2.1 Process topology

Meow Coding is three Electron processes plus two optional companions that connect over WebSocket.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Electron app                                                               │
│                                                                            │
│  ┌──────────────┐   contextBridge    ┌──────────────┐   ipcMain.handle     │
│  │  renderer    │ ─────window.api──▶ │   preload    │ ─────invoke──────▶   │
│  │  (React 19)  │ ◀── callbacks ──── │ (AgentApi)   │ ◀── webContents ──   │
│  └──────────────┘                    └──────────────┘        .send         │
│         ▲                                                        │         │
│         │                                            ┌───────────▼───────┐ │
│         │                                            │       main        │ │
│         │                                            │  MainApp          │ │
│         │                                            │  ├ PtyManager     │ │
│         │                                            │  ├ MeowAgentMgr   │ │
│         │                                            │  ├ stores/services│ │
│         │                                            │  ├ BrowserBridge  │ │
│         │                                            │  ├ ConnectionsMgr │ │
│         │                                            │  └ RemoteManager  │ │
│         │                                            └───────────────────┘ │
└─────────┼──────────────────────────────────────────────────┬───────┬───────┘
          │ (separate BrowserWindows: GitViewer, FileViewer)  │       │
                                                    ws://127.0.0.1  wss://relay
                                                             │       │
                                          ┌──────────────────▼──┐ ┌──▼──────────┐
                                          │ Chrome MV3 extension│ │ relay server│
                                          │ (real user profile) │ │  (server/)  │
                                          └─────────────────────┘ └─────────────┘
```

Security posture of the main window (`src/main/index.ts` `createWindow`):

```ts
webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
```

`ipcRenderer` is **never** exposed to the window. The renderer only ever sees the exact method set
declared by `AgentApi`. External URLs (`http`, `https`, `mailto`) are opened in the OS browser and
in-window navigation to them is prevented.

## 2.2 Layer responsibilities

| Layer | Directory | Owns | Must not |
|---|---|---|---|
| Main | `src/main` | Process spawning/killing, all disk I/O, all network to providers, all stores, IPC handlers, app lifecycle | — |
| Preload | `src/preload` | `contextBridge.exposeInMainWorld('api', …)`; one method per `AgentApi` entry; `subscribe` helper returning an unsubscribe fn | Import Node libs other than `electron`; expose `ipcRenderer` |
| Renderer | `src/renderer` | React UI, local UI state, xterm hosting | Import `electron` or `node:*`; touch the filesystem |
| Shared | `src/shared` | Pure JSON-serializable types, `Channels`, `AgentApi`, pure helpers | Import Node/Electron; pull in external dependencies (it is compiled into all three builds *and* the tests) |

The alias `@shared` → `src/shared` is configured in `electron.vite.config.ts`, `vitest.config.ts`
and the tsconfigs.

## 2.3 Main-process module map

### Coordination

| File | Role |
|---|---|
| `index.ts` | `MainApp` — the composition root. Constructs every store/service, wires PTY and chat events to the renderer, registers all IPC handlers, manages the window/tray/quit lifecycle. |
| `meow-agent-manager.ts` | `MeowAgentManager` — orchestrates the native agent: registration, sessions, turns, the message queue, permissions prompts, subagent wiring, MCP/user tools, settings, stats, trace. **The only place that orchestrates the native agent.** |

### Process & terminal

| File | Role |
|---|---|
| `pty-manager.ts` | node-pty wrapper. Emits `data` / `exit`. `buildSpawnCommand` wraps non-`.exe` commands through `cmd.exe` on Windows. `stop()` uses `tree-kill` with a 3s force-kill fallback. |
| `terminal-shell.ts` | `resolveShell()` — `cmd.exe` on Windows, `$SHELL || /bin/bash` elsewhere. |
| `log-manager.ts` | Appends PTY output to `userData/logs/<agentId>.log`. |
| `alert-service.ts` | Idle timer (default 5 min) → `idle` event; `onExit` → `exit` event. |
| `notification-service.ts` | Native `Notification`, only fired while the window is unfocused. |
| `tray-manager.ts` | System tray icon, show/hide window, Exit. |

### Stores

| File | Backing file | Notes |
|---|---|---|
| `json-store.ts` | — | `createJsonStore<T>()`: in-memory cache is authoritative, atomic temp+rename write with retry on Windows lock errors then in-place fallback, optional `debounceMs` batching with `flush()`, corrupt files parked as `*.corrupt`. |
| `workspace-store.ts` | `workspaces.json` | Workspaces + their agents. |
| `template-manager.ts` | `templates.json` | Templates; defaults cannot be deleted. |
| `agent/session.ts` | `sessions.json` (debounce 250ms) | Sessions with transcript, todos, usage. Normalized once then cached. |
| `agent/snapshot.ts` | `snapshots.json` | Per-turn before/after file contents for undo/redo, capped at 50 turns. |
| `agent/saved-permissions.ts` | `permissions.json` | "Always allow" decisions per (project, tool). |
| `agent/learned-limits.ts` | `learned-limits.json` (debounce 500ms) | Provider-verified context/output caps keyed `baseUrl\|model`; only ever tighten. |
| `agent/trace-store.ts` | `traces/` | Per-session structured event log, buffered and flushed async. |
| `agent/truncation.ts` | `truncation/` | Full text of truncated tool outputs, so a preview can point at a file. Cleaned up after 7 days. |
| `agent/commands.ts` `CommandStore` | `commands.json` | User slash commands (built-ins are in code). |
| `connections/connection-store.ts` | `connections/index.json` | Metadata-only account index (never secrets). |
| `vault.ts` | `connections/vault.json` | `safeStorage`-encrypted secrets keyed by ref. |
| `remote/remote-settings.ts` | `remote.json` | Remote-control enabled flag, relay URL, device id, session token. |
| `models-catalog.ts` | `models.json` + bundled `models-snapshot.json` | models.dev catalog cache with offline fallback. |
| `artifact-store.ts` | in-memory only | Per-project artifact list, one entry per (path, agentId), newest first. |

### Git and files

| File | Role |
|---|---|
| `git-status-service.ts` | `git status --porcelain=v2 -b` with a 5s timeout → `{ branch, dirtyCount }`. Polled every 5s for the active project. |
| `git-service.ts` | The richer git surface: branches, create/checkout, stash/pop, discard, status detail, diff, commits, commit diff, compare, blame, file history. |
| `git-viewer.ts` | Opens the Git viewer in its own `BrowserWindow`. |
| `file-viewer.ts` | Text/binary detection, content read, open in a viewer window or hand off to the system app. |
| `dir-lister.ts` | `listDir`, `shouldIgnore`, `isPathInside` (path-escape guard used by the `dir:list` handler). |
| `file-suggest.ts` | `@`-mention completion: deep basename search, or path drill-down when the prefix contains `/`. Max 20 results. |
| `file-watcher.ts` | Recursive `fs.watch` on the project, text extensions only, 500ms debounce, plus an `(mtime, size)` baseline so attribute-only touches are not reported as edits. |

### Windowing

| File | Role |
|---|---|
| `window-chrome.ts` | `getWindowChromeOptions(platform)` (frameless/hidden title bar on Windows & Linux) and `applyTitleBarTheme` to recolor the Windows overlay live. |
| `updater.ts` | electron-updater wrapper emitting `UpdaterStatusEvent`; refuses to run for portable/AppImage/unpackaged builds. |

## 2.4 The native agent package (`src/main/agent`)

| File | Responsibility |
|---|---|
| `loop.ts` | `SessionRunner` — the turn loop. See [03](03-agent-runtime.md). |
| `llm.ts` | `LlmClient` + `createLlm(provider, apiKey, baseUrl, retry)`; retry classification, `withRetry`, `abortableSleep`, `reduceBudgetForMaxTokensError`, Anthropic cache breakpoints, DeepSeek usage conversion. |
| `message.ts` | `toLlmMessages` — turns transcript items into AI-SDK `ModelMessage[]`, applying tool-output caps except on the recent tail; `toToolDefinition`; `normalizeToolInput`. |
| `config.ts` | `meow.json` load/normalize/write, `MeowConfig` ↔ `MeowSettings` conversion, `resolveAgentConfig`, `resolveApiKey`, `resolveOutputTokens`, and every default constant. |
| `limits.ts` | `LimitsService.resolveLimits` (override → learned → live `/models` → catalog → 128k), `classifyContextOverflowError`, `parseContextLimitFromError`. |
| `learned-limits.ts` | Persisted, monotonically tightening caps learned from provider rejections. |
| `compact.ts` | `usableContextTokens`, `resolveCompactionSettings`, `pruneToolOutputs`, `selectHeadTail`, `buildCompactionPrompt`, `compactTranscript`, `fitHeadToBudget`, `hardTruncate`. |
| `token.ts` | `estimateTokens`, `estimateUsage`, `charsForTokens` (inline image data URLs charged a flat cost). |
| `usage.ts` | `calcCost`, `EMPTY_USAGE`, `ModelPrice`. |
| `permission.ts` | `decide` / `decidePermission`, `PLAN_RULES`, `isWriteBashCommand`, `matchPattern`, `deriveSubagentContext`. |
| `subagent-roles.ts` | `BUILTIN_ROLES` + discovery of `.meow/agents/*.md` and `userData/agents/*.md`. |
| `commands.ts` | Built-in commands, `CommandStore`, `projectCommands`, `resolveCommandTemplate`, `resolveShell` (backtick interpolation, 10s timeout). |
| `references.ts` | `referenceHints` — resolves `@path` mentions against cwd walking up to the git root. |
| `instructions.ts` | `loadInstructions`, `globalInstructionFiles`, `instructionFilesForFile`, `instructionsText`. |
| `skill.ts` | `parseFrontmatter`, `loadSkills`, `collectSkills`, `skillListText`. |
| `plugin.ts` | `loadUserTools` — dynamic `import()` of `*.js`/`*.cjs` from `userData/tools`, each default-exporting `{ name, description, schema, run }`. |
| `apply-patch.ts` | Unified-diff parser and applier. |
| `session.ts` / `snapshot.ts` / `truncation.ts` / `trace-store.ts` / `saved-permissions.ts` | Stores listed above. |
| `tools/` | Tool implementations + `registry.ts`. See [04](04-tool-catalog.md). |
| `mcp/manager.ts` | MCP client manager. See [08](08-integrations.md). |
| `lsp/` | `manager.ts`, `client.ts`, `servers.ts`. See [08](08-integrations.md). |

## 2.5 Data flow: a PTY agent

```
renderer: xterm onData
   → window.api.writeInput(agentId, data)          [Channels.PtyInput]
   → PtyManager.write()  (CRLF normalized on Windows)
   → child process stdin

child process stdout
   → PtyManager 'data'
   → MainApp: LogManager.append + AlertService.onOutput + setState({status:'running'})
   → win.webContents.send(Channels.EventPtyData)
   → renderer: term.write(data)   (buffered in App.buffersRef if xterm not mounted yet)
```

Exit path: `PtyManager 'exit'` → if exit code ≠ 0 and no log exists, a Vietnamese `[meow]` hint is
appended and pushed as PTY data → `AlertService.onExit` → `setState` to `exited` or `error` → a
`pty-run` trace event is written when tracing is enabled.

## 2.6 Data flow: a native agent chat turn

```
renderer: ChatPanel send
   → window.api.sendChat(agentId, text, images)     [Channels.ChatSend]
   → MeowAgentManager.send()
        │ turn already running? → enqueueMessage() (max 5) and return
        └ else runTurn()
             ├ await the previous turn's promise (a killed tool may still be settling)
             ├ append the user message to the active session
             ├ emit 'user-message'
             ├ ensure a SessionRunner is registered for the agent
             ├ new AbortController; emit 'turn-started'; snapshots.beginTurn()
             ├ SessionRunner.run(signal)  ── streams ChatEvents ──▶
             └ finally: snapshots.commitTurn(), clear running/controller, resolve pending prompts
   → MeowAgentManager.emit → MainApp.setOnEvent callback
        ├ maps 'turn-started'/'done'/'error' onto AgentState
        ├ RemoteManager.handleAgentEvent(event)
        └ win.webContents.send(Channels.EventChat, event)
   → renderer: ChatPanel.onChatEvent → rAF-batched feed update
```

Every user-visible agent behavior is expressed as a `ChatEvent` (see
[05 — IPC contract](05-ipc-contract.md#54-chatevent)). The renderer never computes agent state; it
renders events.

## 2.7 Data flow: settings

```
renderer SettingsDialog
   → window.api.getSettings()                 [Channels.SettingsGet]
   → MeowAgentManager.getSettings() = configToSettings(loadMeowConfig(userData/meow.json))
   … user edits a draft via patch() …
   → window.api.saveSettings(draft)           [Channels.SettingsSave]
   → writeSettings(): settingsToConfig(draft, current) → writeMeowConfig()
   → reload(): stop all runners, syncTools() (MCP reconnect + user tools), refreshModelLimits(),
               re-register every agent
   → returns the normalized settings back to the UI
```

Provider connect/disconnect uses `writeSettingsAndReload`, which writes synchronously but does
**not** await `reload()` — MCP reconnection can take up to 60s per server and would otherwise block
the modal from closing.

## 2.8 Startup sequence (`app.whenReady`)

1. Bail out if this is a secondary instance (single-instance lock).
2. `truncationCleanup()` — drop truncation files older than 7 days.
3. Start the `BrowserBridge` on `127.0.0.1:3927` and subscribe status → renderer.
4. Subscribe remote status → renderer.
5. `ConnectionsManager.init()` — if Codex accounts exist, start the cliproxy sidecar and refresh tokens.
6. `ensureExtensionInstalled()` — copy the built Chrome extension into `userData/browser-extension`.
7. If tracing is disabled, delete `userData/traces` so nothing lingers.
8. `registerIpcHandlers()`, `createWindow()`, `TrayManager.create()`.
9. After 1.5s, an automatic update check (packaged builds only).

## 2.9 Shutdown sequence (`before-quit`)

The first `before-quit` is **preventDefault**ed and a cleanup chain runs, then `app.exit(0)`:

```
stopGitPoll()
 → MeowAgentManager.dispose()   (stop idle-compact timer, abort all turns + background subagents,
                                 flush sessions, close MCP, dispose LSP)
 → TraceStore.flushAll()
 → ConnectionsManager.dispose() (stop the cliproxy sidecar, remove its runtime dir)
 → BrowserBridge.close()
 → RemoteManager.dispose()
 → TrayManager.dispose()
 → PtyManager.stopAll()         (tree-kill every process tree)
 → app.exit(0)
```

Closing the window does **not** quit while a tray exists — it hides to tray so agents keep running.

## 2.10 Invariants

1. **Only main spawns or kills processes.** The renderer has no path to `child_process`.
2. **Channel strings are never hardcoded** outside `src/shared/ipc.ts`; use `Channels`.
3. **`src/shared` stays dependency-free and Node-free.**
4. **Agent state changes only via `MainApp.setState`,** and the renderer is notified only when a
   *visible* field changed (`status`, `exitCode`, `alert`) to avoid event storms.
5. **No orphan processes.** Every stop path goes through `tree-kill`; the PTY stop has a 3s
   force-kill fallback that synthesizes an exit event so callers never hang.
6. **Transcript items are the single source of truth** for what the LLM sees; prompts are rebuilt
   from them on every step (`message.ts`), never accumulated separately.
7. **Secrets live only in the vault.** Settings, indexes and IPC payloads carry `keyRef`s or masked
   values.
