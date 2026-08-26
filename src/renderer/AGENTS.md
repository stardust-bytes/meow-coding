# AGENTS.md — src/renderer

React renderer (no direct Node/Electron access).

## Structure

- `index.html` + `src/main.tsx` — entry; render `<App>`; if `window.api` is missing, show a guidance
  fallback (preload not loaded).
- `src/App.tsx` — state hub: workspaces, templates, open runtimes; defines `PaneModel`
  (agent + state + git) for each pane.
- `src/components/` — `Sidebar`, `PaneGrid`, `Pane`, `PaneHeader`, `XtermHost`, `EmptyState`,
  `StatusBar`, `TitleBar`, `BackgroundPanel`, `AddProjectDialog`, `AddAgentDialog`, `UpdateDialog`,
  `BrowserDialog`, `InstallGuideDialog`, `chat/`, `settings/`.
- `src/styles.css` — VSCode Dark+ palette (default) with a Light+ variant activated via
  `[data-theme="light"]` on `<html>`. All colors use CSS variables so theme switching is a single
  attribute flip. Spacing on a 4px scale, controls use Tailwind default sizes. Font: UI sans (Segoe UI
  Variable/system-ui) for all text, mono (JetBrains Mono) for terminal/data/code labels.
  Theme toggle lives in the Sidebar footer dropdown menu (Sun/Moon icon). Theme preference is
  persisted in `localStorage` (`meow.theme`), default is `dark`.
- `src/theme.ts` — shared theme helpers: `applyTheme` (set `data-theme` on `<html>` from
  localStorage) and `watchTheme` (re-apply on `storage` events). `main.tsx` calls both for EVERY
  renderer — including the Git viewer and FileViewer popup windows (separate BrowserWindows) — so
  they inherit the theme from the main window automatically.

## Conventions

- All main access goes through `window.api` (typed `AgentApi` from shared). Do not import Node/electron.
- Output arriving before xterm mounts → buffer in `buffersRef` (App), flush when `registerTerminal`
  is called. Do not remove this mechanism.
- Input/resize: xterm `onData`/resize → `window.api.writeInput` / `window.api.resizePty` (via props
  in `Pane`).
- Grid + zoom: click a pane to zoom full-window, `Esc` to exit (handled in `PaneGrid`).
- Functional components + hooks; declare the `Props` interface in the same file.
- UI labels in English. Use tabular-nums figures when displaying numbers.

## CSS — border-radius & style scope

Lessons learned from the Git viewer screen (don't repeat them):

- **`src/styles.css` has a global rule `* { border-radius: var(--radius) }`** — it rounds EVERY element
  unless explicitly overridden. When you want a "square" area (no rounded corners), don't just set
  `border-radius: 0` on each rule — you'll miss some (tab, panel, cell) and easily get the syntax wrong.
- **Standard pattern for a screen/popup that wants square corners:**
  ```css
  /* Top of section: */
  .git-viewer * { border-radius: 0; }          /* square everything */
  .git-viewer .btn,
  .git-viewer .git-header-btn { border-radius: var(--radius-sm); }  /* only keep for buttons */
  ```
  Only list the elements that ACTUALLY need rounded corners (buttons, inputs, dropdown content, options...).
- Before editing: check whether the element is being rounded by the `*` rule (`grep "border-radius"` +
  trace the class). Don't assume.
- Edit CSS with python when the file uses CRLF (the edit tool won't match strings) — see `tests/*.test.ts`,
  `styles.css` are all CRLF.

## Performance

Lessons from a real chat input lag debugging session (measured with Chromium trace via CDP, no guessing):

- **Limit unnecessary animations**, especially on elements that update frequently (scrolling on every
  token stream, transitions on an input being typed into). Animations run on the UI thread; combined
  with dense re-renders (streaming, continuous keystrokes) this causes noticeable jank. For fast
  repeated updates, use instant scrolling (`scrollIntoView()` without `behavior: 'smooth'`); only use
  smooth scroll for discrete, one-time actions (e.g. a new message fully appearing, not every delta).
- **Long lists (chat feed, tool-call list) must have `content-visibility: auto` on each row**
  (`.chat-msg`, `.tool-call`) + an estimated `contain-intrinsic-size`. Measured in practice: a project
  with ~250 items / ~3000 DOM nodes caused EVERY keystroke in the chat box to trigger a full-page
  layout (~39ms) — the browser needs a synchronous layout to position the text caret
  (`TypingCommand::InsertText`), and that layout spreads across the entire DOM including parts long
  scrolled off-screen if not marked with content-visibility. Adding this property reduced the cost
  ~6-7x (39ms → 5.7ms/keystroke).
- **The main text input field (chat input) uses uncontrolled (ref) instead of controlled
  (`value` + `onChange` + `setState`)**. `setState` on every keystroke forces React to re-render even
  when the content doesn't affect other UI. Read `e.target.value` directly via ref; only `setState`
  when a derived state ACTUALLY changes (e.g. opening/closing the "/" command menu), and bail out by
  returning the same object reference when the value is unchanged so React skips the re-render.
- **Don't optimize before measuring.** `requestAnimationFrame`/`cancelAnimationFrame` are NOT free —
  once tried using rAF to "split" a cheap check (string comparison) out of the input handler, the result
  was SLOWER than the old synchronous version because rAF is a real browser API call, not a no-op.
  Before adding any perf optimization: measure with real tools (CPU profile / Chromium trace via CDP
  `Profiler`/`Tracing`, or Event Timing API `processingStart`/`processingEnd`) — don't guess from a
  familiar pattern and call it done.
- **Callbacks passed down to `memo()`-ized components** (e.g. `ChatPanel`, `FeedMessage`,
  `ToolCallCard`, `CommandMenuItem`) must be stable via `useCallback` with correct dependencies —
  otherwise every re-render of the parent component (including from unrelated state, e.g. polling git
  status every 5s) will force re-renders to cascade down the entire subtree. Row/item components should
  take primitive props, avoiding receiving whole objects whose reference the parent changes every
  render, otherwise `memo()` is ineffective.

## Testing

- No renderer unit tests yet; ensure `npm run typecheck` passes and the e2e smoke test
  (`npm run build && npm run e2e`) doesn't break.