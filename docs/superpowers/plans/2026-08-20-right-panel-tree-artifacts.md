# Plan: Right Panel — Directory Tree + Artifacts

Implements spec: `docs/superpowers/specs/2026-08-20-right-panel-tree-artifacts-design.md`

## File map

### New files
| File | Responsibility |
|---|---|
| `src/main/artifact-store.ts` | Per-project artifact collection, dedupe, clear. Pure-ish, unit-testable. |
| `src/renderer/src/components/RightPanel.tsx` | Panel shell: drag-resize, vertical tab nav, content header, mounts the two tabs. |
| `src/renderer/src/components/RightPanelTree.tsx` | Directory tree: lazy load, expand/collapse, refresh, context menu. |
| `src/renderer/src/components/RightPanelArtifacts.tsx` | Artifacts list: grouped by agent, kind icon, relative time, clear, context menu. |
| `src/main/dir-lister.ts` | Filesystem listing: read dir, ignore list, sort dirs-first A–Z. Pure helpers exported for tests. |

### Modified files
| File | Change |
|---|---|
| `src/shared/types.ts` | Add `DirEntry`, `ArtifactEntry`. |
| `src/shared/ipc.ts` | Add `Channels.DirList`, `ArtifactsList`, `ArtifactsClear`, `EventArtifactsChanged`, `ArtifactsChangedEvent`, `AgentApi` methods. |
| `src/preload/index.ts` | Expose new IPC surface. |
| `src/main/index.ts` | IPC handlers; `ArtifactStore` wiring; watcher-fallback attribution; forward native `onArtifact`. |
| `src/main/agent/tools/types.ts` | `ToolContext.onArtifact?`. |
| `src/main/agent/tools/write.ts` | Record artifact after write. |
| `src/main/agent/tools/edit.ts` | Record artifact after edit. |
| `src/main/agent/tools/apply-patch.ts` | Record artifact after apply. |
| `src/main/agent/loop.ts` | Wire `onArtifact` from deps into `ToolContext`. |
| `src/main/meow-agent-manager.ts` | Accept `onArtifact` dep; pass to `SessionRunner`; expose to main app. |
| `src/renderer/src/App.tsx` | Mount `RightPanel`; localStorage state (open/tab/width); artifact event subscription. |
| `src/renderer/src/components/TitleBar.tsx` | Panel toggle button (right side). |
| `src/renderer/src/styles.css` | All panel/tab/tree/artifact/tooltip styles. |

## Task 1 — Shared types + IPC contract

1. `src/shared/types.ts`:
   - `export interface DirEntry { name: string; path: string; isDirectory: boolean }`
   - `export interface ArtifactEntry { id: string; path: string; absPath: string; kind: 'create' | 'edit'; agentId: string; agentName: string; ts: number }`
2. `src/shared/ipc.ts`:
   - Add to `Channels`: `DirList: 'dir:list'`, `ArtifactsList: 'artifacts:list'`, `ArtifactsClear: 'artifacts:clear'`, `EventArtifactsChanged: 'artifacts:changed'`.
   - `export interface ArtifactsChangedEvent { projectPath: string; artifacts: ArtifactEntry[] }`
   - In `AgentApi`: `listDir(absPath: string): Promise<DirEntry[]>`, `listArtifacts(projectPath: string): Promise<ArtifactEntry[]>`, `clearArtifacts(projectPath: string): Promise<void>`, `onArtifactsChanged(cb: (e: ArtifactsChangedEvent) => void): () => void`.
3. `src/preload/index.ts`: implement the four additions via `ipcRenderer.invoke` / `on` (mirror existing patterns in the file).

Verify: `npm run typecheck`.

## Task 2 — Main: dir lister

`src/main/dir-lister.ts`:
- `IGNORED_DIRS = ['node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage']`.
- `export function shouldIgnore(name: string): boolean` — dirs in the set or names starting with `.`.
- `export function sortEntries(entries: DirEntry[]): DirEntry[]` — dirs first, then case-insensitive alphabetical by name.
- `export async function listDir(absPath: string): Promise<DirEntry[]>` — `readdir` with `withFileTypes`; skip ignored; stat failures skipped; return `{ name, path: path.join(absPath, name), isDirectory }`.

Unit test `src/main/dir-lister.test.ts`: ignore rule, sort order, symlink/dir detection basics.

## Task 3 — Main: ArtifactStore

`src/main/artifact-store.ts`:
```ts
export class ArtifactStore {
  private byProject = new Map<string, Map<string, ArtifactEntry>>() // key: projectPath -> (path|agentId) -> entry
  private onChange: (projectPath: string, artifacts: ArtifactEntry[]) => void
  constructor(onChange: (projectPath: string, artifacts: ArtifactEntry[]) => void)
  record(projectPath: string, input: Omit<ArtifactEntry, 'id' | 'ts'>): ArtifactEntry
  list(projectPath: string): ArtifactEntry[]
  clear(projectPath: string): void
}
```
- Dedupe key: `${path}::${agentId}`; update in place (keep original id, refresh ts/kind) — repeated edits of the same file by the same agent stay one entry.
- `record` calls `onChange` after mutation.
- Sorted newest-first in `list`.

Unit test `src/main/artifact-store.test.ts`: record creates entry; repeated record same path+agent updates (no duplicate, id stable); different agents → separate entries; clear empties; onChange fired.

## Task 4 — Main: native tool instrumentation

1. `src/main/agent/tools/types.ts`: add `onArtifact?(entry: ArtifactEntry): void` to `ToolContext`.
2. `write.ts`: after `writeFileSync` + diagnostics, if `ctx.onArtifact`:
   `ctx.onArtifact({ path: toPosix(relative(cwd, full)), absPath: full, kind: existsSync(full) ? (wasCreate ? 'create' : 'edit') : 'create', agentId: ctx.agentId ?? '', agentName: '' })`
   — simpler: determine kind by checking existence **before** write: if the file did not exist before write → `create`, else `edit`.
3. `edit.ts`: file existed (edit) → `kind: 'edit'`.
4. `apply-patch.ts`: after applying, for each touched file path: kind = `existsSync(full) ? 'edit' : 'create'` (checking post-op existence per the spec rule; for apply-patch, new files in the diff won't exist before).
   - Inspect how `apply-patch.ts` applies diffs (parsed file list) to know where to hook. Add the recording at the point where files are written.
5. `agentName` resolution: keep `agentName: ''` at tool level; the `MeowAgentManager`/main app fills the real name from workspace config before storing (or store passes a resolver). Simplest: main `index.ts` resolves `agentName` from `workspace.agents` when forwarding.
6. `loop.ts`: in the `toolCtx` object literal add `onArtifact: (entry) => this.deps.onArtifact?.(entry)` — add `onArtifact?: (entry: ArtifactEntry) => void` to `SessionRunnerDeps` (find its interface near top of loop.ts).
7. `meow-agent-manager.ts`: add `onArtifact?: (entry: ArtifactEntry) => void` to its `ManagerDeps`; pass into `new SessionRunner({ ..., onArtifact: (e) => this.deps.onArtifact?.(e) })`.

Verify: typecheck; existing tests pass.

## Task 5 — Main: watcher fallback + wiring

`src/main/index.ts`:
- Instantiate `ArtifactStore` with `onChange` → send `Channels.EventArtifactsChanged` to `win`.
- In `startFileWatcher(projectPath)`: keep sending `EventContextChanged` (tree auto-refresh) AND call `recordWatcherChanges(projectPath, files)`.
- `recordWatcherChanges`:
  - Find running agents: from `this.states`, agents with `status === 'running'`; pick the one with max `lastOutputAt` (tie → first). If none → return.
  - For each changed file: `absPath = path.join(projectPath, rel)`; `kind = existsSync(absPath) ? 'edit' : 'create'`; skip if the file is inside an ignored dir or is a dotfile (reuse `shouldIgnore` from dir-lister); `store.record(projectPath, { path: rel, absPath, kind, agentId, agentName: resolveAgentName(agentId) })`.
  - Note: dedupe in the store handles double-recording when a native agent both instruments and triggers the watcher.
- `resolveAgentName(agentId)`: look up `this.activeProject` workspace agents; fallback `agentId`.
- IPC handlers:
  - `Channels.DirList` → `listDir(absPath)` (guard: only allow paths inside `activeProject`; else throw).
  - `Channels.ArtifactsList` → `store.list(projectPath)`.
  - `Channels.ArtifactsClear` → `store.clear(projectPath)`.
- Wire `meowAgent.setOnEvent`... no — wire `onArtifact` from `MeowAgentManager` deps: find where `MeowAgentManager` is constructed (index.ts) and pass `onArtifact: (e) => { resolve agentName; store.record(activeProject, e) }`.
  - The `ArtifactEntry` from tools has `path` relative to `ctx.cwd` (agent cwd = project root in practice) and `absPath`. Record with `projectPath = activeProject`; if `absPath` is outside project root, skip.

Verify: `npm run typecheck`; `npm test` (dir-lister + artifact-store suites).

## Task 6 — Renderer: App state + mount

`src/renderer/src/App.tsx`:
- State: `rightPanelOpen` (localStorage `meow.rightpanel.open`, default `'1'`), `rightPanelTab` (`'tree'|'artifacts'`, default `'tree'`), `rightPanelWidth` (default 280).
- `artifacts` state: `Record<projectPath, ArtifactEntry[]>`; subscribe `window.api.onArtifactsChanged` → set.
- Pass to `<RightPanel>`: `open`, `tab`, `width`, `onToggle`, `onTabChange`, `onWidthChange`, `root={runtime?.workspace.projectPath ?? null}`, `artifacts={artifacts[runtime?.workspace.projectPath ?? ''] ?? []}`, `onClearArtifacts={() => projectPath && void window.api.clearArtifacts(projectPath)}`.
- Render `<RightPanel>` after `<main>` inside `.app-body`, only when `open` — but keep tab nav hidden via CSS when closed (panel hidden entirely per spec; toggle removes it from layout: render conditionally).
- On workspace close (`resetActiveProject` event or `runtime` null) also clear local artifacts state for that path.

## Task 7 — Renderer: RightPanel component

`src/renderer/src/components/RightPanel.tsx`:
- Structure:
  ```
  <div class="right-panel" style={{ width }}>
    <div class="right-panel-content">
      <div class="right-panel-header"> title + (tree: refresh btn) / (artifacts: clear btn) </div>
      {tab === 'tree' ? <RightPanelTree root={root}/> : <RightPanelArtifacts ... />}
    </div>
    <div class="right-panel-tabs"> two icon buttons with title tooltips </div>
    <div class="right-panel-resizer" onMouseDown={startDrag} />
  </div>
  ```
- Drag resize: on `mousedown` record startX + startWidth; on `mousemove` compute new width, clamp 240–600; on `mouseup` remove listeners. Persist via `onWidthChange`.
- Icons: folder-tree SVG + artifact (document/file) SVG, inline, `title` attr for tooltip.
- Tab nav flush right: `.right-panel { display: flex }` with tabs as last child (right edge).

## Task 8 — Renderer: RightPanelTree

`src/renderer/src/components/RightPanelTree.tsx`:
- Local recursive node state: `expanded: Record<absPath, boolean>`, `children: Record<absPath, DirEntry[]>` (lazy).
- Root row: folder name from `root` basename; on first expand → `window.api.listDir(root)`.
- Expand: if children not loaded → `listDir(absPath)`; toggle expanded.
- Auto-refresh: subscribe `window.api.onContextChanged` (find existing listener name in ipc.ts — reuse the same event the chat uses, e.g. `EventContextChanged`) → debounce 500ms → re-fetch root + all expanded dirs (in place, preserving expanded state).
- Manual refresh button in header → same refetch.
- Click file (non-dir) → `window.api.openFile({ path: entry.path, root })`.
- Right-click file → context menu (portal to body, position at cursor):
  - "Open in VS Code" → `window.api.openFileInEditor(entry.path)`
  - "Reveal in folder" → `window.api.showFileInFolder(entry.path)`
  - Close on outside click / Escape (same pattern as Sidebar project menu).
- Loading spinner for pending dirs; empty/error message on list failure.
- No root → "No project open" empty state.

## Task 9 — Renderer: RightPanelArtifacts

`src/renderer/src/components/RightPanelArtifacts.tsx`:
- Props: `root: string | null`, `artifacts: ArtifactEntry[]`, `onClear: () => void`.
- Group by `agentId` preserving order (first seen), header: agent name + count badge.
- Entry: kind icon (create = plus circle, edit = pencil), relative `path`, relative time via small helper `relativeTime(ts)` (e.g. "just now", "2m ago", "3h ago").
- Click → `openFile({ path: absPath, root })`; right-click → same context menu as tree (extract a tiny shared `FileContextMenu` helper inside RightPanel.tsx or duplicate minimal menu logic — prefer a shared component `components/FileContextMenu.tsx` used by both tabs).
- Empty state: "No artifacts yet".
- Clear button → `onClear`.

## Task 10 — Renderer: TitleBar toggle

`src/renderer/src/components/TitleBar.tsx`:
- Add prop `panelOpen: boolean`, `onTogglePanel: () => void`.
- Render a button (reuse `.title-bar-btn` style or new `.title-bar-panel-toggle`) at the right side:
  - Windows/Linux: a right-side container before `.title-bar-controls` (Linux) / right-aligned spacer that accounts for the ~138px Windows overlay (add `padding-right` on the brand-side container; on Windows use `.title-bar-win` padding-right: 150px so the button sits left of the overlay controls).
  - macOS: place at far right.
- Icon: VSCode-style panel rectangle; `title` tooltip "Show/Hide Panel".

## Task 11 — Styles

`src/renderer/src/styles.css`: add
- `.app-body` unchanged (flex row already) — `.right-panel` flex child.
- `.right-panel`, `.right-panel-content`, `.right-panel-header`, `.right-panel-tabs`, `.right-panel-tab`, `.right-panel-tab.active`, `.right-panel-resizer` (cursor: col-resize), `.tree-*`, `.artifact-*`, `.context-menu` styles consistent with existing surfaces (`--bg-panel`, `--hairline`, `--accent`).
- Tooltips: native `title` attribute (simplest, consistent with app).

## Task 12 — Verification

- `npm run typecheck` pass.
- `npm test` pass (incl. new dir-lister + artifact-store suites).
- Manual smoke: run `npm run dev`, open a project, toggle panel, switch tabs, expand tree, resize, create/edit files via native agent → artifacts update; open a PTY terminal agent and touch a file → artifact attributed to it; Clear works; restart → panel state restored.
- e2e: layout selectors unchanged (main/sidebar) → skip unless Task 7–9 change shared selectors.

## Commit sequence

1. `feat(shared): dir + artifact types and IPC contract`
2. `feat(main): directory lister with ignore + sort`
3. `feat(main): artifact store (dedupe, clear, onChange)`
4. `feat(main): instrument native write/edit/apply-patch tools`
5. `feat(main): watcher fallback + IPC handlers wiring`
6. `feat(renderer): right panel shell with tabs + resize + state`
7. `feat(renderer): directory tree tab`
8. `feat(renderer): artifacts tab + shared file context menu`
9. `feat(renderer): title bar panel toggle`
10. `style(renderer): right panel styles`
11. `test(main): dir-lister + artifact-store suites` (folded into 2/3 commits)
