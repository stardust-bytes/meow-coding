# 09 — UI Guide (Renderer)

React 19 + TypeScript, no UI framework, no CSS-in-JS. All data flows through `window.api`
(typed `AgentApi`). **Never import `electron` or `node:*` in the renderer.**

## 9.1 Entry point and window routing

`src/renderer/src/main.tsx` routes by query string — the same bundle serves three window types:

| Condition | Renders |
|---|---|
| `window.api` missing | A fallback telling the user preload did not load |
| `?file=<path>&root=<dir>` | `<FileViewer>` in a popup `BrowserWindow` |
| `?git=<projectPath>` | `<GitViewer>` in a popup `BrowserWindow` |
| otherwise | `<App>` — the main window |

Every renderer calls `applyTheme()` and `watchTheme()` before first paint, so popups inherit the
main window's theme (see [9.6](#96-theming)).

## 9.2 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar (frameless: drag region + min/max/close)                     │
├────────┬───────────────────────────────────────────┬─────────────────┤
│Sidebar │ PaneGrid                                  │ RightPanel      │
│        │  ┌───────────────┐ ┌───────────────┐      │  ┌───────────┐  │
│ work-  │  │ PaneHeader    │ │ PaneHeader    │      │  │ Tree      │  │
│ spaces │  │ ChatPanel  or │ │ XtermHost     │      │  │ Artifacts │  │
│        │  │ XtermHost     │ │               │      │  └───────────┘  │
│ theme  │  └───────────────┘ └───────────────┘      │  (resizable)    │
├────────┴───────────────────────────────────────────┴─────────────────┤
│ StatusBar (workspace · git branch · running count · app version)      │
└──────────────────────────────────────────────────────────────────────┘
```

Overlays: `SettingsDialog` (full-screen tabbed), `AddProjectDialog`, `AddAgentDialog`,
`BrowserDialog`, `InstallGuideDialog`, `UpdateDialog`, `BackgroundPanel`, `FileContextMenu`.

## 9.3 `App.tsx` — the state hub

Owns: workspaces, templates, the open `WorkspaceRuntime`, background flags, browser status, update
status, terminals, right-panel state, artifacts, and the xterm registry.

```ts
export interface PaneModel { agent: AgentConfig; state: AgentState; git: GitStatus | null }
```

Two refs matter:

- **`termsRef: Map<agentId, Terminal>`** — xterm instances, registered by `XtermHost` on mount.
- **`buffersRef: Map<agentId, string>`** — PTY output that arrived **before** xterm mounted. It is
  flushed on registration. **Do not remove this mechanism**; without it, early agent output is lost.

Event subscriptions set up in `App`: `onPtyData`, `onAgentState`, `onGitStatus`,
`onAgentBackground`, `onAgentConfig`, `onBrowserStatus`, `onBrowserOpenInstallGuide`,
`onTerminalExit`, `onUpdaterStatus`, `onArtifactsChanged`. Every one returns an unsubscribe function
that must be called in the effect cleanup.

Update-dialog policy: `update-available` and `downloaded` open the dialog; `error` and
`not-supported` close it; `up-to-date` only opens a dialog when the check was **manual**
(`manualCheckRef`), so the automatic startup check never pops anything.

## 9.4 Component inventory

### Shell

| Component | Responsibility |
|---|---|
| `TitleBar.tsx` | Custom window chrome for frameless platforms |
| `PopupTitleBar.tsx` | Same for the FileViewer/GitViewer popups (drag region + Linux min/max/close) |
| `Sidebar.tsx` | Workspace list, add/remove, templates, open in editor, Providers entry, theme toggle. "Open Terminal" opens a real OS terminal window (via `openSystemTerminal`), not a tab. Projects with agents waiting on a permission/question prompt show a red count badge (and a dot on the collapsed-rail avatar) |
| `StatusBar.tsx` | Workspace name, git branch, running count, app version |
| `PaneTabs.tsx` | Tab-bar layout of agent/terminal panes; **all panes stay mounted** (inactive hidden via CSS) so background agents keep streaming/answering |
| `Pane.tsx` | One agent: header + `ChatPanel` (native) or `XtermHost` (pty); background badge mode |
| `PaneHeader.tsx` | Status dot, git info, menu (inject / log / stop / zoom / new session / background / delete) |
| `XtermHost.tsx` | xterm.js host with `@xterm/addon-fit`; wires `onData` → `writeInput`, resize → `resizePty` |
| `EmptyState.tsx` | No-pane hint (differs for "no workspace" vs "workspace open") |
| `BackgroundPanel.tsx` | Background agents; open/stop |
| `RightPanel.tsx` | Resizable panel with a fixed header; **both tabs stay mounted** for instant switching |
| `RightPanelTree.tsx` | Lazy directory tree; auto-expands the project root; background refresh |
| `RightPanelArtifacts.tsx` | `.md` files agents created/edited |
| `FileViewer.tsx` | Popup file viewer with Shiki highlighting |
| `FileContextMenu.tsx` | Context menu for tree/artifact entries |

### Dialogs

`AddProjectDialog`, `AddAgentDialog`, `UpdateDialog`, `BrowserDialog` (bridge pairing + status),
`InstallGuideDialog` (extension install steps), `ChallengeToast` (ChatGPT web challenge).

### Chat (`components/chat/`)

| Component | Responsibility |
|---|---|
| `ChatPanel.tsx` | The container: subscribes to chat events, owns feed state (items / todos / queue / pendingPrompt), rAF-batches stream deltas, renders feed + composer + context footer. The permission/question prompt is rendered in-flow at the top of the chat input card (never overlays the chat history). The composer's bottom row (`chat-footer`) puts the context readout on the left and the mode/model/variant selectors on the right. Memoized. |
| `ChatInput.tsx` | Composer: textarea (Enter to send), paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, `/` command menu, edit-queued flow. Memoized, **uncontrolled**. |
| `useChatScroll.ts` | Feed scroll controller: follow / anchored / manual modes, turn-top anchoring, jump-to-end button. Pure geometry helpers live in `chat-scroll-geometry.ts`. |
| `SessionBar.tsx` | Session list bar: create / switch / rename / delete |
| `ToolCallCard.tsx` | One tool call: input JSON, diff (edit / apply-patch), output or error. Memoized. |
| `DiffView.tsx` | Inline diff for edit-style tool calls |
| `MarkdownText.tsx` | `marked` + `DOMPurify.sanitize` |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs table pipes before rendering |
| `markdownPaths.ts` | Turns file paths in markdown into clickable `openFile` links |
| `highlight.ts` | Shiki syntax highlighting |
| `ContextFooter.tsx` | Context readout (context only by default); hovering shows a popover with session tokens in/out + cost |
| `ModelPicker.tsx` / `VariantPicker.tsx` / `ModePicker.tsx` / `Dropdown.tsx` | Model / variant / build-plan mode selection |
| `parseCommandInput.ts` | `parseCommandInput(raw) → { isCommand, prefix }` for the `/` menu |
| `questionAnswer.ts` | `buildQuestionAnswer` for permission/question responses |

Chat conventions:

- **Transient status lines** (compaction, retry) live only in feed state — never written to the
  transcript, so they vanish on reload. That is deliberate.
- Feed items are updated **copy-on-write**; never mutate in place, or `memo()` stops working.
- Images travel as data URLs inside `ImageAttachment`; only `image/*` is accepted.
- The message queue shows `queued` badge rows supporting remove/edit via
  `window.api.removeQueued` / `editQueued`.

### Settings (`components/settings/`)

Full-screen tabbed overlay editing `MeowSettings`. Loads with `getSettings()`, edits a **draft**
through `patch()`, and writes only on Save via `saveSettings(settings)` (which returns the
normalized settings).

| Tab | Edits |
|---|---|
| `ProvidersTab` | Add/connect providers (API key + base URL), fetch models live or from the catalog, hand-enter model ids, "Sync models", default provider, Model Connections (Codex OAuth accounts) |
| `AgentsTab` | Per-agent name, system prompt, provider/model |
| `PermissionsTab` | Per-tool allow / ask / deny |
| `McpTab` | MCP server configs + connection status |
| `ContextTab` | Basic: max steps, auto-compact, MCP output max tokens. Advanced (collapsible): buffer / keepTokens / tailTurns / toolOutputMaxChars / maxBytes / maxLines + Notifications. **Empty optional fields mean auto**, and the placeholder shows the auto value for the active agent |
| `CommandsTab` | Slash-command editor ("+ Add command" in the header) |
| `TemplatesTab` | Agent template CRUD |
| `UpdatesTab` | Update channel, check, install |
| `RemoteTab` | Remote control enable, relay URL, pairing, revoke |
| `Modal.tsx` | Reusable modal shell |

Adding a setting touches three places: `MeowSettings` in `src/shared/types.ts`, the normalize path in
`src/main/agent/config.ts`, and the tab here.

### Git viewer (`components/git/`)

`GitViewer.tsx` hosts tabs: `GitChangesTab`, `GitDiffView`, `GitHistoryTab`, `GitBlameTab`, plus
`GitFileTree` and `GitBranchSwitcher`. `parseDiff.ts` parses unified diffs for rendering. It runs in
its own `BrowserWindow` opened by `Channels.GitOpenViewer`.

### Trace (`components/trace/`)

`TracePanel` hosts `TraceTimeline`, `TraceLedger`, `TraceInspector` and `SubagentTree`, driven by
`traceList` / `traceRead` / `onTraceEvent`.

## 9.5 Styling

`src/renderer/src/styles.css` — one file, CSS variables only.

- Root font size 15px; sizes `--fs-xs` 12px … `--fs-lg` 18px.
- Fonts: `--font-ui` (Segoe UI Variable / system-ui) for everything, `--font-mono`
  (JetBrains Mono / Nerd Font) for terminal, data and code labels. `--font-display` aliases
  `--font-ui`: the display fonts were never loaded via `@font-face` (CSP is `'self'` only) and
  silently fell back to mono, which made uppercase labels look like terminal output.
- Spacing on a 4px scale; controls use Tailwind default sizes.
- Numeric displays use tabular-nums.
- UI labels are English.

### The `border-radius` trap

`styles.css` contains a **global `* { border-radius: var(--radius) }`** rule. It rounds *every*
element unless explicitly overridden. To make a screen square-cornered, do **not** set
`border-radius: 0` rule by rule — you will miss some (tab, panel, cell). Use this pattern:

```css
.git-viewer * { border-radius: 0; }                              /* square everything */
.git-viewer .btn,
.git-viewer .git-header-btn { border-radius: var(--radius-sm); } /* re-round only what needs it */
```

Before editing, check whether the element is being rounded by the `*` rule
(`grep "border-radius"` and trace the class). Do not assume.

**CRLF note:** `styles.css` and the test files use CRLF line endings, which can make exact-match
string edits fail. Edit them with a script (e.g. python) if the edit tool cannot match.

## 9.6 Theming

- Dark is the default (`--bg: #0a0a0b`, near-black, VSCode-Dark+-derived with a `#007acc` accent
  family). Light mode is a full token override under `[data-theme="light"]` on `<html>` using the
  VSCode Light+ palette.
- The choice persists in `localStorage` under `meow.theme`; the toggle lives in the Sidebar footer
  menu (Sun/Moon).
- `applyTheme(theme?)` sets `data-theme` **and** calls `window.api.setTitleBarTheme(resolved)` so the
  Windows `titleBarOverlay` min/max/close buttons follow the app theme (without this they stay dark
  in light mode).
- `watchTheme()` listens for `storage` events, which fire across same-origin windows — this is how
  the Git viewer and File viewer popups re-theme when the main window toggles.
- App-wide font size persists in `localStorage` under `meow.fontSize` (default 14, range 8–40px,
  integer). `applyFontSize()` in `font.ts` sets `font-size` on `<html>`/`<body>` and dispatches a
  `meow:fontsize` CustomEvent so open xterm terminals re-`fit()` live; `watchFontSize()` re-applies
  on `storage` events across same-origin popups. The control lives in the Settings → Personalize tab.

## 9.7 Performance rules

These come from a real, measured chat-input lag investigation (Chromium trace via CDP — not
guesswork). Treat them as requirements, not suggestions.

1. **Limit animations on frequently-updating elements.** Animations run on the UI thread; combined
   with dense re-renders (token streaming, continuous keystrokes) they cause visible jank. Use
   instant `scrollIntoView()` for streaming; reserve smooth scroll for discrete one-off actions.
2. **Long lists need `content-visibility: auto`** on each row (`.chat-msg`, `.tool-call`) plus an
   estimated `contain-intrinsic-size`. Measured: a project with ~250 items / ~3000 DOM nodes made
   *every* keystroke in the chat box trigger a full-page layout (~39ms) — the browser needs a
   synchronous layout to position the caret (`TypingCommand::InsertText`), and that layout spans the
   whole DOM including off-screen content. Adding this cut it ~6–7× (39ms → 5.7ms/keystroke).
3. **The chat input is uncontrolled (ref), not controlled.** `setState` on every keystroke forces a
   re-render even when the value affects nothing else. Read `e.target.value` via ref; only
   `setState` when a derived value actually changes (e.g. opening the `/` menu), and return the same
   object reference when nothing changed so React skips the render.
4. **Callbacks passed to `memo()`ed components must be stable** (`useCallback` with correct deps).
   Otherwise any parent re-render — including the 5-second git-status poll — cascades through the
   whole subtree. Row components should take primitive props, not objects whose reference changes
   every render.
5. **Measure before optimizing.** `requestAnimationFrame` is not free. An attempt to move a cheap
   string comparison out of the input handler via rAF made things *slower*, because rAF is a real
   browser API call. Use a CPU profile / Chromium trace or the Event Timing API
   (`processingStart` / `processingEnd`) before and after.

## 9.8 Testing the renderer

There are no renderer unit tests. Coverage comes from:

- `npm run typecheck` (which includes `tsconfig.web.json`)
- Playwright e2e (`npm run build && npm run e2e`), which launches the real app:
  `smoke.spec.ts`, `prompt.spec.ts`, `context-footer.spec.ts`, `chat-scrollbar.spec.ts`,
  `trace-panel.spec.ts`

After touching IPC or UI, add or extend a smoke assertion so the regression is caught there.
