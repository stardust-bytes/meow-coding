# Right Panel: Directory Tree + Artifacts — Design

Date: 2026-08-20
Status: Approved (user confirmed design before writing this spec)

## Goal

Add a right-hand panel to the main window with two icon-tabs (vertical tab nav,
icons only, tooltips on hover, tab nav flush to the right edge, content to the
left of it):

1. **Directory Tree** of the currently selected project.
2. **Artifacts** — files created/modified during sessions, grouped by agent.

The panel can be shown/hidden via a toggle button in the title bar, placed next
to the window controls cluster (minimize/maximize/close) like VSCode. Panel
width is adjustable by dragging; open state, active tab and width persist.

## Layout

- `.app-body` (currently `display: flex`) becomes: `Sidebar | main | RightPanel`.
- RightPanel structure (left → right): content area | vertical icon tab bar.
- Drag handle at the left edge of the panel to resize (min 240px, max 600px,
  default 280px).
- Toggle button in the title bar, right-aligned, immediately left of the window
  controls cluster:
  - Windows (`titleBarStyle: hidden` + overlay): place before the OS overlay
    controls (overlay width ~138px reserved on the right).
  - Linux (`frame: false`, custom controls): before `.title-bar-controls`.
  - macOS (`hiddenInset`): far right (traffic lights are on the left).
  - Button: panel icon (VSCode-style), tooltip "Show Panel"/"Hide Panel".
- Persistence (localStorage, following the existing `meow.sidebar.collapsed`
  pattern):
  - `meow.rightpanel.open` — `'1'`/`'0'`
  - `meow.rightpanel.tab` — `'tree'` | `'artifacts'`
  - `meow.rightpanel.width` — px number

## Tab nav (vertical)

- Thin vertical strip (~44px) flush right. Icons only:
  - Folder-tree icon (tree tab)
  - Artifact icon (artifacts tab)
- Hover → tooltip with tab purpose ("Directory Tree", "Artifacts").
- Active tab highlighted; clicking toggles to that tab (clicking active tab keeps
  it active).
- When the panel is hidden, the whole panel (including tab nav) is hidden.

## Tab 1: Directory Tree

- Root = `projectPath` of the active workspace (`WorkspaceRuntime.workspace.projectPath`).
- Lazy loading: expanding a folder calls `dir:list` IPC
  (`listDir(absPath): Promise<DirEntry[]>`); main process reads the filesystem
  (renderer never touches fs).
- `DirEntry`: `{ name: string; path: string; isDirectory: boolean }` where
  `path` is the absolute path (renderer uses it for `openFile`, `openFileInEditor`,
  `showFileInFolder`).
- Ignore list (consistent with `FileWatcher`):
  `node_modules`, `.git`, `out`, `dist`, `.next`, `.nuxt`, `coverage`; hidden
  dotfiles are skipped (no `dot` entries).
- Sort: directories first, then files, alphabetical (case-insensitive).
- Root row shows the project folder name; expandable.
- Click file → `openFile({ path, root })` (in-app FileViewer).
- Right-click file → context menu (portaled, like Sidebar's project menu):
  - "Open in VS Code" → `openFileInEditor(absPath)`
  - "Reveal in folder" → `showFileInFolder(absPath)`
- Refresh:
  - Auto: on `EventContextChanged` (FileWatcher) — debounced (~500ms) — re-fetch
    the root listing and any currently expanded directories; preserve expansion
    state.
  - Manual refresh button in the panel content header.
- Empty state when no workspace open: "No project open".

## Tab 2: Artifacts

### Data model (main process, keyed by `projectPath`)

```ts
interface ArtifactEntry {
  id: string          // uuid
  path: string        // path relative to project root (posix separators)
  absPath: string
  kind: 'create' | 'edit'
  agentId: string
  agentName: string
  ts: number
}
```

### Sources

1. **Native agent — instrumented tools** (exact, like Claude Code / Codex):
   - Add `onArtifact?(entry: ArtifactEntry): void` callback to `ToolContext`.
   - `write` tool → record `create`.
   - `edit` and `apply-patch` tools → record `edit`.
   - Wired: `SessionRunner` deps → `MeowAgentManager` → main app `ArtifactStore`.
   - `ctx.agentId` identifies the agent; agent name resolved from the workspace
     agent config.

2. **PTY agents — file watcher fallback** (opencode / Claude Code CLI / aider are
   external processes and cannot be instrumented):
   - Reuse the existing `FileWatcher` (already emits `EventContextChanged` with
     changed relative paths while a workspace is open).
   - On change events, attribute each changed file to the **most recently active
     running agent** (by `AgentState.lastOutputAt`) when at least one agent is
     running; skip if no agent is running (avoid recording user's manual edits).
   - Kind inferred as `create` when the file does not exist yet, else `edit`.
   - Dedupe: if a path was already recorded by tool instrumentation for that
     agent, update the existing entry instead of inserting a duplicate.

### Display

- Grouped by agent: header = agent name + count badge.
- Each entry: icon by kind (create = plus, edit = pencil), relative path,
  relative time ("2m ago").
- Click entry → `openFile` (in-app FileViewer).
- Right-click entry → same context menu as the tree ("Open in VS Code",
  "Reveal in folder").
- **Clear** button in the panel content header → clears artifacts for the
  current project.
- Lifetime: in-memory per project; cleared when the workspace closes and on app
  restart (session semantics — no persistence).

## IPC additions (`src/shared/ipc.ts` — contract only via `Channels`)

- `Channels.DirList = 'dir:list'` — `listDir(absPath: string): Promise<DirEntry[]>`
- `Channels.ArtifactsList = 'artifacts:list'` — `listArtifacts(projectPath: string): Promise<ArtifactEntry[]>`
- `Channels.ArtifactsClear = 'artifacts:clear'` — `clearArtifacts(projectPath: string): Promise<void>`
- `Channels.EventArtifactsChanged = 'artifacts:changed'` — main → renderer push
  (`ArtifactsChangedEvent { projectPath, artifacts: ArtifactEntry[] }`) so the
  panel stays reactive without polling.
- New shared types: `DirEntry`, `ArtifactEntry` in `src/shared/types.ts`.
- Preload: expose the new methods/event on `AgentApi` (implement the interface).

## Files touched

- `src/shared/types.ts` — `DirEntry`, `ArtifactEntry`
- `src/shared/ipc.ts` — channels, event, `AgentApi` additions
- `src/preload/index.ts` — expose new API surface
- `src/main/artifact-store.ts` — **new**: per-project artifact collection +
  dedupe + clear
- `src/main/index.ts` — IPC handlers, wire `ArtifactStore`, forward
  `onArtifact` from `MeowAgentManager`, watcher fallback attribution
- `src/main/agent/tools/types.ts` — `ToolContext.onArtifact`
- `src/main/agent/tools/write.ts`, `edit.ts`, `apply-patch.ts` — record entries
- `src/main/agent/loop.ts` — pass `onArtifact` from deps into `ToolContext`
- `src/main/meow-agent-manager.ts` — accept `onArtifact` dep, forward to main
- `src/renderer/src/App.tsx` — mount `RightPanel`, state from localStorage
- `src/renderer/src/components/RightPanel.tsx` — **new**: tabs + resize + header
- `src/renderer/src/components/RightPanelTree.tsx` — **new**: directory tree
- `src/renderer/src/components/RightPanelArtifacts.tsx` — **new**: artifacts list
- `src/renderer/src/components/TitleBar.tsx` — toggle button
- `src/renderer/src/styles.css` — panel, tab bar, tree, artifacts, tooltip styles

## Tests

- Unit: `ArtifactStore` (record from tool, watcher attribution, dedupe, clear).
- Unit: directory listing sort + ignore list helper (extracted pure function).
- `npm run typecheck` and `npm test` must pass.
- E2E smoke not affected (no change to pane/sidebar flows) — rerun if touching
  layout selectors.

## Out of scope

- Persisting artifacts across app restarts.
- Git-diff-based artifacts tab.
- File icons per extension (only kind icon for artifacts; tree shows folder/file
  glyphs).
- Multi-select / bulk actions.
