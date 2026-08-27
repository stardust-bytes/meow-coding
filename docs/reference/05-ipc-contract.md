# 05 — IPC Contract

The single contract between main, preload and renderer lives in `src/shared/ipc.ts`
(`Channels` + `AgentApi` + event payload interfaces) and `src/shared/types.ts` (data models).

## 5.1 Rules

1. **Never hardcode a channel string.** Import `Channels` from `@shared/ipc`.
2. Changing the contract requires updating **four** places in sync:
   - `src/shared/ipc.ts` — the channel and the `AgentApi` signature
   - `src/main/index.ts` — the `ipcMain.handle(...)` in `registerIpcHandlers()`
   - `src/preload/index.ts` — the `ipcRenderer.invoke(...)` implementation
   - `tests/unit/ipc-contract.test.ts` — the guard test that asserts every method exists and every
     channel string matches
3. The renderer's `window.api` type comes from the same `AgentApi` (declared in
   `src/renderer/src/env.d.ts`), so it stays in sync automatically.
4. Push events use the `subscribe` helper in preload, which returns an **unsubscribe function** the
   renderer must call on teardown:

```ts
function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
```

5. Payloads must be JSON-serializable — no classes, no functions, no Node/Electron objects.

## 5.2 Request/response channels

`Channels.<Key>` → `'<channel string>'` → `AgentApi` method.

### Workspaces & projects

| Key | Channel | Method |
|---|---|---|
| `WorkspaceList` | `workspace:list` | `listWorkspaces(): WorkspaceSummary[]` |
| `WorkspaceAdd` | `workspace:add` | `addWorkspace(projectPath, name): WorkspaceRuntime \| null` — auto-creates a native `meow` agent when the workspace has none |
| `WorkspaceRemove` | `workspace:remove` | `removeWorkspace(projectPath)` — removes agents, kills PTYs, clears state/alerts/logs |
| `WorkspaceOpen` | `workspace:open` | `openWorkspace(projectPath): WorkspaceRuntime` |
| `ProjectOpenInEditor` | `project:open-in-editor` | `openInEditor(projectPath)` — launches `code <path>` |
| `ProjectOpenFolder` | `project:open-folder` | `openFolder(projectPath)` — `shell.openPath` |
| `PickFolder` | `dialog:pick-folder` | `pickFolder(): string \| null` |

### Files & directories

| Key | Channel | Method |
|---|---|---|
| `FileOpen` | `file:open` | `openFile(payload: FileViewerPayload)` — text → viewer window, binary → system app, unknown extension → probed |
| `FileViewerGetContent` | `file-viewer:get-content` | `getFileContent(path): FileContentResult` |
| `FileViewerOpenInEditor` | `file-viewer:open-in-editor` | `openFileInEditor(path)` |
| `FileViewerShowInFolder` | `file-viewer:show-in-folder` | `showFileInFolder(path)` |
| `DirList` | `dir:list` | `listDir(absPath): DirEntry[]` — **rejects paths outside the active project** |
| `FilesSuggest` | `files:suggest` | `suggestFiles(agentId, prefix): FileSuggestion[]` |
| `ArtifactsList` | `artifacts:list` | `listArtifacts(projectPath): ArtifactEntry[]` |
| `ArtifactsClear` | `artifacts:clear` | `clearArtifacts(projectPath)` |

### Git

| Key | Channel | Method |
|---|---|---|
| `GitOpenViewer` | `git:open-viewer` | `gitOpenViewer(projectPath)` |
| `GitGetBranches` | `git:get-branches` | `gitGetBranches(projectPath): GitBranch[]` |
| `GitCreateBranch` | `git:create-branch` | `gitCreateBranch(projectPath, name, base): GitActionResult` |
| `GitCheckout` | `git:checkout` | `gitCheckout(projectPath, branch): GitActionResult` |
| `GitStash` / `GitStashPop` | `git:stash` / `git:stash-pop` | `gitStash` / `gitStashPop` |
| `GitDiscard` | `git:discard` | `gitDiscard(projectPath): GitActionResult` |
| `GitStatusDetail` | `git:status-detail` | `gitGetStatusDetail(projectPath): GitStatusDetail \| null` |
| `GitGetDiff` | `git:get-diff` | `gitGetDiff(projectPath, file?, staged?): string` |
| `GitGetCommits` | `git:get-commits` | `gitGetCommits(projectPath, file?, count?): GitCommit[]` |
| `GitGetCommitDiff` | `git:get-commit-diff` | `gitGetCommitDiff(projectPath, sha): GitDiffResult` |
| `GitCompareCommits` | `git:compare-commits` | `gitCompareCommits(projectPath, a, b): GitDiffResult` |
| `GitGetBlame` | `git:get-blame` | `gitGetBlame(projectPath, file): GitBlameLine[]` |
| `GitGetFileHistory` | `git:get-file-history` | `gitGetFileHistory(projectPath, file): GitCommit[]` |

### Agents & PTY

| Key | Channel | Method |
|---|---|---|
| `AgentAdd` | `agent:add` | `addAgent(projectPath, input: NewAgentInput): WorkspaceRuntime` |
| `AgentRemove` | `agent:remove` | `removeAgent(projectPath, agentId)` |
| `AgentSetMode` | `agent:set-mode` | `setAgentMode(agentId, 'build' \| 'plan')` |
| `AgentSetVariant` | `agent:set-variant` | `setAgentVariant(agentId, variant \| null)` |
| `AgentGetVariants` | `agent:get-variants` | `getAgentVariants(agentId): string[]` |
| `AgentSetModel` | `agent:set-model` | `setAgentModel(agentId, model: ModelRef)` |
| `AgentGetModel` | `agent:get-model` | `getAgentModel(agentId): ModelRef \| null` |
| `AgentGetContext` | `agent:get-context` | `getContextInfo(agentId): ContextInfo` |
| `AgentSetBackground` | `agent:set-background` | `setAgentBackground(agentId, background)` |
| `PtyStart` / `PtyStop` / `PtyRestart` | `pty:start` / `pty:stop` / `pty:restart` | `startAgent` / `stopAgent` / `restartAgent` |
| `PtyInput` | `pty:input` | `writeInput(agentId, data)` |
| `PtyInject` | `pty:inject` | `injectPrompt(agentId, text)` — writes `text + '\n'` |
| `PtyResize` | `pty:resize` | `resizePty(agentId, cols, rows)` |
| `LogPath` / `LogOpen` | `log:path` / `log:open` | `getLogPath` / `openLog` |
| `TerminalOpen` / `TerminalClose` | `terminal:open` / `terminal:close` | `openTerminal(cwd): TerminalInfo` / `closeTerminal(id)` |

### Chat & sessions

| Key | Channel | Method |
|---|---|---|
| `ChatSend` | `chat:send` | `sendChat(agentId, text, images?)` |
| `ChatStop` | `chat:stop` | `stopChat(agentId)` → `stopAndDrain` (aborts the turn, keeps the queue, starts the next queued message) |
| `ChatRunCommand` | `chat:run-command` | `runCommand(agentId, name, args)` |
| `ChatUndo` / `ChatRedo` | `chat:undo` / `chat:redo` | `undoChat` / `redoChat` → `boolean` |
| `ChatNewSession` | `chat:new-session` | `newChatSession(agentId): SessionSummary` |
| `ChatListMessages` | `chat:list-messages` | `listChatMessages(agentId): ChatMessage[]` |
| `ChatListTranscript` | `chat:list-transcript` | `listChatTranscript(agentId): ChatTranscriptItem[]` |
| `ChatGetTodos` | `chat:get-todos` | `getChatTodos(agentId): TodoItem[]` |
| `ChatIsRunning` | `chat:is-running` | `isChatRunning(agentId): boolean` |
| `ChatGetPendingPrompt` | `chat:get-pending-prompt` | `getPendingPrompt(agentId): PendingPromptInfo \| null` — returns the in-flight permission/question prompt so a remounted chat panel can restore it |
| `ChatRespondPrompt` | `chat:respond-prompt` | `respondPrompt(agentId, promptId, resp: PromptResponse)` |
| `ChatQueueRemove` / `ChatQueueEdit` | `chat:queue-remove` / `chat:queue-edit` | `removeQueued` / `editQueued` |
| `SessionList` / `SessionCreate` / `SessionSwitch` / `SessionDelete` / `SessionRename` | `session:*` | `listSessions` / `createSession` / `switchSession` / `deleteSession` / `renameSession` |
| `TraceList` / `TraceRead` / `TraceDelete` | `trace:*` | `traceList(agentId)` / `traceRead(sessionId)` / `traceDelete(sessionId)` |

### Providers, connections, settings

| Key | Channel | Method |
|---|---|---|
| `ProviderModels` | `provider:models` | `getProviderModels(): ModelRef[]` |
| `ProviderFetchModels` | `provider:fetch-models` | `fetchProviderModels(providerId): string[]` |
| `ProviderCatalog` | `provider:catalog` | `listProviderCatalog(): CatalogProviderSummary[]` |
| `ProviderConnect` | `provider:connect` | `connectProvider(providerId, apiKey, baseUrl?, models?, providerType?): MeowSettings` |
| `ProviderDisconnect` | `provider:disconnect` | `disconnectProvider(providerId): MeowSettings` |
| `ConnectionList` | `connections:list` | `listConnections(): ConnectionAccount[]` |
| `ConnectionConnectCodex` | `connections:connect-codex` | `connectCodex(): ConnectionAccount` |
| `ConnectionDisconnect` | `connections:disconnect` | `disconnectConnection(accountId): ConnectionAccount[]` |
| `ConnectionSetActive` | `connections:set-active` | `setActiveConnection(accountId): ConnectionAccount[]` |
| `ConnectionGetModels` | `connections:get-models` | `getConnectionModels(): ModelRef[]` |
| `SettingsGet` / `SettingsSave` | `settings:get` / `settings:save` | `getSettings()` / `saveSettings(settings)` |
| `CommandList` / `CommandSave` / `CommandRemove` | `commands:*` | `listCommands(projectPath)` / `saveCommand(command)` / `removeCommand(name)` |
| `TemplateList` / `TemplateSave` / `TemplateRemove` | `template:*` | `listTemplates` / `saveTemplate` / `removeTemplate` |
| `StatsGet` | `stats:get` | `getStats(): StatsSummary` |
| `McpStatus` / `McpReconnect` | `mcp:status` / `mcp:reconnect` | `getMcpStatus()` / `reconnectMcp()` |

> The connection channels are served by `connectionBackend`, which is
> `E2EConnectionFixtures` when `MEOW_E2E_MOCK_CONNECTIONS=1`, otherwise the real
> `ConnectionsManager`. `disconnect` and `setActive` validate that `accountId` is a non-empty string.

### Browser bridge & remote control

| Key | Channel | Method |
|---|---|---|
| `BrowserGetStatus` | `browser:get-status` | `getBrowserStatus(): BrowserStatusInfo` |
| `BrowserPair` | `browser:pair` | `pairBrowser(): PairingInfo` |
| `BrowserOpenInstallGuide` | `browser:open-install-guide` | `openBrowserInstallGuide()` |
| `BrowserOpenExtensionFolder` | `browser:open-extension-folder` | `openBrowserExtensionFolder()` |
| `BrowserOpenChromeExtensions` | `browser:open-chrome-extensions` | `openBrowserChromeExtensions()` |
| `BrowserGetConsoleLogs` / `BrowserGetNetworkLogs` | `browser:get-*-logs` | `getBrowserConsoleLogs(limit?)` / `getBrowserNetworkLogs(limit?)` |
| `RemoteGetStatus` | `remote:get-status` | `getRemoteStatus(): RemoteStatus` |
| `RemoteSetEnabled` | `remote:set-enabled` | `setRemoteEnabled(enabled)` |
| `RemoteSetRelayUrl` | `remote:set-relay-url` | `setRemoteRelayUrl(url)` |
| `RemoteStartPairing` | `remote:start-pairing` | `startRemotePairing(): { code, expiresAt } \| null` |
| `RemoteRevokeToken` | `remote:revoke-token` | `revokeRemoteToken()` |

### App & window

| Key | Channel | Method |
|---|---|---|
| `AppQuit` / `AppVersion` | `app:quit` / `app:version` | `quit()` / `getAppVersion()` |
| `UpdaterCheck` / `UpdaterInstall` | `updater:check` / `updater:install` | `checkForUpdates()` / `installUpdate()` |
| `WindowMinimize` / `WindowToggleMaximize` / `WindowClose` / `WindowIsMaximized` | `window:*` | `minimizeWindow` / `toggleMaximizeWindow` / `closeWindow` / `isWindowMaximized` |
| `WindowSetTheme` | `window:set-theme` | `setTitleBarTheme('dark' \| 'light')` |

Window handlers resolve their target via `BrowserWindow.fromWebContents(e.sender)`, so the same
calls work from the Git viewer and File viewer popup windows.

`AgentApi` also carries one non-function property: **`platform: string`** (`process.platform`,
captured in preload).

## 5.3 Push events (main → renderer)

| Key | Channel | Payload | Subscribe method |
|---|---|---|---|
| `EventPtyData` | `pty:data` | `PtyDataEvent { agentId, data }` | `onPtyData` |
| `EventTerminalExit` | `terminal:exit` | `TerminalExitEvent { id, exitCode }` | `onTerminalExit` |
| `EventAgentState` | `agent:state` | `AgentStateEvent { agentId, state }` | `onAgentState` |
| `EventAgentConfig` | `agent:config-changed` | `AgentConfigEvent { agentId, config }` | `onAgentConfig` |
| `EventAgentBackground` | `agent:background` | `{ agentId, background }` | `onAgentBackground` |
| `EventGitStatus` | `git:status` | `GitStatusEvent { projectPath, git }` | `onGitStatus` |
| `EventContextChanged` | `context:changed` | `ContextChangedEvent { projectPath, files }` | `onContextChanged` |
| `EventChat` | `chat:event` | `ChatEvent` | `onChatEvent` |
| `EventTrace` | `trace:event` | `TraceEvent` | `onTraceEvent` |
| `EventArtifactsChanged` | `artifacts:changed` | `ArtifactsChangedEvent { projectPath, artifacts }` | `onArtifactsChanged` |
| `EventBrowserStatus` | `browser:status` | `BrowserStatusInfo` | `onBrowserStatus` |
| `EventBrowserOpenInstallGuide` | `browser:install-guide` | `BrowserInstallGuideEvent { extensionDir }` | `onBrowserOpenInstallGuide` |
| `EventRemoteStatus` | `remote:status` | `RemoteStatus` | `onRemoteStatus` |
| `EventUpdaterStatus` | `updater:status` | `UpdaterStatusEvent` | `onUpdaterStatus` |
| `EventWindowMaximizedChange` | `window:maximized-change` | `{ maximized }` | `onWindowMaximizedChange` |

`EventAgentState` is emitted only when `status`, `exitCode`, or `alert` actually changed —
`lastOutputAt` alone never triggers a send (it changes on every byte of PTY output).

## 5.4 `ChatEvent`

The full agent-behavior stream. Every variant carries `agentId`.

| `type` | Payload | Meaning |
|---|---|---|
| `turn-started` | — | A turn began; the UI clears transient state and shows the stop button |
| `user-message` | `message: ChatMessage` | A user message was appended (direct send or steered) |
| `text-delta` | `delta: string` | Streamed assistant text |
| `reasoning-delta` | `delta: string` | Streamed reasoning text |
| `tool-start` | `call: ToolCallData` | A tool call was requested (`permission: 'pending'`) |
| `tool-result` | `call: ToolCallData` | The tool finished; `output` / `error` / final `permission` are set |
| `prompt-request` | `promptId`, `kind: 'permission' \| 'question'`, `call?`, `question?`, `options?`, `multiple?`, `custom?`, `taskId?`, `subagentType?` | The agent is blocked awaiting the user; answer with `respondPrompt` |
| `usage` | `tokens: MessageTokens`, `sessionCost`, `sessionTokens { input, output }` | Per-step usage. `sessionTokens.input` includes cache read/write to match provider dashboards |
| `todo-updated` | `todos: TodoItem[]` | The todo list changed |
| `queue-updated` | `queue: QueuedMessage[]` | The pending-message queue changed |
| `message-removed` | `messageId` | A queued/injected message was deleted |
| `compaction-start` | — | Compaction began (transient UI line only) |
| `compacted` | `summary: string` | Compaction succeeded; the transcript was replaced |
| `compaction-failed` | — | The summarization call failed; hard truncation was used |
| `retry` | `attempt`, `maxAttempts`, `delayMs` | An LLM request will be retried (transient UI line only) |
| `subagent-event` | `taskId`, `parentTaskId?`, `sub: 'start' \| 'delta' \| 'tool' \| 'done'`, `subagentType?`, `text?`, `tool?`, `reasoning?`, `background?`, `result?`, `state?` | Subagent progress |
| `session-created` | — | A new session was created (e.g. by `/new`) |
| `done` | `reason: string`, `tokens?`, `cost?` | Turn finished. `reason` ∈ `complete` \| `stopped` \| `max-steps` \| `length` |
| `error` | `message: string` | Turn aborted with an error |

**Transient events** (`compaction-start`, `compaction-failed`, `retry`) exist only in renderer feed
state — they are never written to the transcript, so they disappear on reload. That is intentional.

## 5.5 Key data types

Full definitions in `src/shared/types.ts`. The ones most often needed:

```ts
type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
type AgentKind   = 'pty' | 'native'
type AgentMode   = 'build' | 'plan'
type AlertLevel  = 'normal' | 'attention' | 'error'

interface AgentConfig { id; name; templateId; cwd; kind?; mode?; variant?; model?; accountId?; background? }
interface AgentState  { agentId; status: AgentStatus; exitCode: number|null; lastOutputAt: number|null; alert: AlertLevel }
interface Workspace   { projectPath; name; agents: AgentConfig[] }
interface WorkspaceRuntime { workspace: Workspace; agents: AgentState[]; git: GitStatus|null }

interface ChatMessage { id; role: 'user'|'assistant'; text; displayText?; reasoning?; tokens?; images?; createdAt }
interface ToolCallData { id; tool; input; output?; error?; permission: 'pending'|'allowed'|'denied' }
type ChatTranscriptItem = { kind:'message'; message: ChatMessage } | { kind:'tool'; tool: ToolCallData }

interface MessageTokens { input; output; total; reasoning?; cacheRead?; cacheWrite? }
interface ContextInfo   { limit: number|null; compactThreshold: number|null; sessionCost: number }
interface PromptResponse{ allow: boolean; text?: string; always?: boolean }

interface ModelRef { provider; model; accountId?; accountLabel?; variants?: string[] }
interface ConnectionAccount { id; provider: 'codex'; email?; displayName; active; createdAt;
                              lastUsedAt?; status: 'ready'|'refreshing'|'expired'|'error'; error? }

interface ArtifactEntry { id; path; absPath; kind: 'create'|'edit'; agentId; agentName; ts }
interface TerminalInfo  { id: `term-${string}`; cwd; name; status: 'running'|'exited' }
```

`MeowSettings` — the whole settings surface — is documented in
[06 — meow.json reference](06-data-and-storage.md#63-meowjson-reference).

## 5.6 Adding a new IPC call — worked example

Adding `getFooStats(projectPath: string): Promise<FooStats>`:

```ts
// 1. src/shared/types.ts
export interface FooStats { total: number }

// 2. src/shared/ipc.ts
export const Channels = { /* … */ FooStats: 'foo:stats' } as const
export interface AgentApi { /* … */ getFooStats(projectPath: string): Promise<FooStats> }

// 3. src/main/index.ts — inside registerIpcHandlers()
ipcMain.handle(Channels.FooStats, (_e, projectPath: string) => mainApp.foo.stats(projectPath))

// 4. src/preload/index.ts — inside the api object
getFooStats: (projectPath: string) => ipcRenderer.invoke(Channels.FooStats, projectPath),

// 5. tests/unit/ipc-contract.test.ts — add 'getFooStats' and 'foo:stats' to the assertions
```

For a **push event** instead: add an `Event*` channel, a payload interface, an `on*` subscribe
method in `AgentApi`, the `subscribe(...)` line in preload, and a
`win?.webContents.send(Channels.EventFoo, payload)` in main.
