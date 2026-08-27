# 11 — Conventions & Pitfalls

House rules, process, and the traps that have already bitten someone in this repo.

## 11.1 Hard rules

| Rule | Why |
|---|---|
| **Never hardcode an IPC channel string.** Use `Channels` from `src/shared/ipc.ts` | Channels change; a stray literal fails silently at runtime instead of at compile time |
| **`src/shared` imports nothing from Node, Electron, or third-party packages** | It is compiled into the main, preload, renderer *and* test builds |
| **The renderer never imports `electron` or `node:*`** | `contextIsolation: true`, `nodeIntegration: false` — it would not work, and it would be a security hole |
| **Never expose `ipcRenderer` to the window** | Only the exact `AgentApi` surface is exposed |
| **Only the main process spawns or kills processes** | Single choke point for `tree-kill` and lifecycle correctness |
| **Every stop path goes through `tree-kill`** | No orphan processes after quit; verify this after touching any stop logic |
| **Secrets live only in the vault** | Settings, indexes and IPC payloads carry `keyRef`s or masked values |
| **Do not modify `@lydell/node-pty` source** | It ships prebuilds; rebuild with `npx @electron/rebuild -f -w @lydell/node-pty` instead |
| **Do not break `buildSpawnCommand`** | Windows ConPTY cannot launch `.cmd` shims directly (see [11.5](#115-windows-specific-traps)) |
| **Browser bridge binds `127.0.0.1` only and requires a pairing code** | It drives the user's *real* Chrome profile |
| **One `AGENTS.md` per module, updated before commit** | See [11.3](#113-documentation-sync-rule) |

## 11.2 Style conventions

- **Comments are for decisions, not narration.** Comment when explaining a non-obvious choice (the
  Windows shim, the tree-kill grace period, why an estimate uses 3.5 chars/token). Do not add
  comments that restate the code.
- **Match the surrounding code**: comment density, naming, idiom.
- **Functional React components with hooks**; declare the `Props` interface in the same file.
- **UI labels are English.** Numeric displays use tabular-nums.
- **User-facing system notices from main are English, prefixed `[meow]`** — chat errors, PTY
  hints, native notifications. Follow this when adding one.
- **All project documentation is English**: specs, implementation plans, READMEs, `docs/`,
  `AGENTS.md` files, and changelogs are written in English.
- Some in-code comments are Vietnamese for historical reasons. They are normal comments; do not
  mass-translate them as a side effect of unrelated work.

## 11.3 Documentation sync rule

Every module directory has an `AGENTS.md` describing its purpose, status, key files, endpoints,
dependencies and TODOs. A sibling `CLAUDE.md` contains only `@AGENTS.md` (Claude Code's import
syntax).

**Principle: code changes → `AGENTS.md` updated before commit.** Update it when any of these change:

- business logic (endpoints, service methods, DTOs)
- file structure (adding/removing/renaming key files)
- status (SKELETON → PARTIAL → IMPLEMENTED)
- dependencies (entities, modules, packages)
- TODOs completed or added

When editing an `AGENTS.md`:

- **Only** modify the entries that reflect what actually changed.
- **Do not** rewrite the whole file, "clean up" unrelated sections, or reword text whose meaning is
  still correct.
- **Do not** change the file's existing format — heading levels, section order, bullet style,
  checkbox style, tables, label conventions, indentation, line spacing.
- Insert new information into the correct existing section using the existing format.
- If the current format seems imperfect but is consistent, **prefer preserving it**. Only adjust
  formatting when the user explicitly asks for that specific file.

The same discipline applies to `docs/reference/` (this set): when you change behavior a document
describes, update that document in the same commit. This includes **any feature, architecture, or
system change** — adding/changing a feature, an agent tool, an IPC channel, a setting, a storage
format, a provider/connection, an integration, or any behavior a reference page describes. Update the
matching `docs/reference/<NN>-*.md` page in the same commit.

## 11.4 The Superpowers workflow

The repository's own development process, mirrored by the bundled `/sp-*` commands:

```
brainstorm → spec → plan → execute → review → verify → finish
```

| Stage | Artifact |
|---|---|
| Brainstorm | `docs/superpowers/brainstorms/YYYY-MM-DD-slug.md` |
| Spec | `docs/superpowers/specs/YYYY-MM-DD-slug-design.md` — goals, decisions, scope, architecture, data flow, error handling, testing, success criteria. Written **before** code |
| Plan | `docs/superpowers/plans/YYYY-MM-DD-slug.md` — step-by-step implementation |
| Notes | `docs/superpowers/notes/YYYY-MM-DD-slug.md` — technical notes, ad-hoc decisions |
| Execution log | `.superpowers/sdd/<date>-<slug>/` — task briefs, task reports, review diffs, progress |

Conventions: file names are `YYYY-MM-DD-slug.md`; the first line states the status
(e.g. `Status: pending review`). When writing a new spec or plan, read existing ones first so the
format stays consistent. Update the spec/plan when decisions change.

**These documents are the best available answer to "why is it built this way?"** — for nearly every
non-obvious behavior in this codebase there is a dated spec explaining it.

## 11.5 Windows-specific traps

Windows is the primary development platform here, and several behaviors exist only because of it.

| Trap | Handling |
|---|---|
| ConPTY cannot spawn `.cmd`/`.bat` shims (`opencode`, `claude`, `aider` are all shims) — `CreateProcess` fails with exit code 2 and no output | `buildSpawnCommand` wraps any non-`.exe` command as `cmd.exe /d /s /c "<cmdline>"` |
| A rename over an existing file throws `EPERM`/`EACCES`/`EBUSY` while the destination is transiently locked (antivirus, Search Indexer, OneDrive) | `JsonStore` retries the rename `[10, 20, 40, 80]ms`, then falls back to an in-place write |
| Git Bash re-execs itself once, so the tree is `bash.exe → bash.exe → command`; `tree-kill`'s single `taskkill /t` snapshot can miss the innermost process | `bash` waits until 600ms after spawn before killing. Heuristic, not a guarantee — a heavy `~/.bash_profile` can push tree formation past the window |
| `fs.watch` fires for atime/attribute touches (AV scans, indexers) with unchanged content | `FileWatcher` keeps an `(mtime, size)` baseline; `hasContentChanged` filters spurious events out of artifact recording |
| `cmd.exe /s /c` argument quoting mangles embedded quotes | `buildShellCommand` passes the whole command as one quoted argv element with `windowsVerbatimArguments: true` |
| PTY input uses `\r`, not `\n` | `PtyManager.write` normalizes `\r\n` and `\n` to `\r` on Windows |
| The Windows title-bar overlay buttons stay dark in light mode | `applyTheme` calls `setTitleBarTheme`, and `applyTitleBarTheme` recolors the overlay |
| PowerShell 7 (`pwsh`) may not be installed | `electron-builder.ts` falls back to `powershell.exe` for the signing script |

## 11.6 Agent-behavior traps

| Trap | Handling |
|---|---|
| Starting a turn while the previous one is still winding down leaves an orphan tool item → provider 400 (`tool message without a preceding tool_calls`) | `runTurn` awaits `turnPromises.get(agentId)` first |
| Retrying a stream after it emitted parts duplicates text the UI already consumed | `withRetry` only retries a stream that failed **before** producing anything |
| Persisting partial text before a recover-and-retry doubles the text | `persistPartial()` is called only when recovery is *not* attempted |
| Estimating an inline image by its base64 length counted a 1MB screenshot as ~285k tokens, pinning the session over the compaction threshold forever | `token.ts` charges every inline image a flat `IMAGE_TOKENS = 1600` |
| 4 chars/token underestimated dense JSON transcripts and delayed compaction | `CHARS_PER_TOKEN = 3.5` |
| A catalog claiming 1M output tokens would push the auto-compact threshold to zero | `resolveOutputTokens` caps at `MAX_OUTPUT_HARD_CAP` and at half the context window |
| A compaction prompt can itself exceed the model's context on a long session | `fitHeadToBudget` drops the oldest turns (halving a single oversized turn) until it fits |
| A model denied `write` rewrites files via `sed -i` / `echo >` / `fs.writeFileSync` | `isWriteBashCommand` denies write-shaped bash outright in plan mode |
| A background subagent has no one to ask for permission | `canPrompt: false` → any `ask` becomes `deny` |
| A subagent given `todowrite` silently swallows its todos (no `setTodos` sink) | `task.ts` removes `todowrite` from every subagent tool map |
| Subagents nesting infinitely | `task` is not in the map passed to `createTaskTool` |
| A subagent's token usage overwriting the parent's overflow signal | `reportUsage(..., isMainContext=false)` does not touch `lastUsageByAgent` |
| A background subagent's result landing in whatever session is active when it finishes | `onBackgroundResult` delivers to the session recorded at `onBackgroundStart` |
| Reporting a `length`-truncated answer as `complete` left the user reading a cut-off reply | `done.reason` is `'length'` in that case |
| A superseded async registration overwriting a newer one | `registrationVersion` is compared before committing the runner |
| A non-ASCII API key failing deep in undici with `Cannot convert argument to a ByteString` | Validated in `connectProvider` *and* at the stream entry point |

## 11.7 Renderer traps

| Trap | Handling |
|---|---|
| The global `* { border-radius: var(--radius) }` rule rounds everything | Use `.scope * { border-radius: 0 }` then re-round only what needs it — see [09](09-ui-guide.md#the-border-radius-trap) |
| PTY output arriving before xterm mounts is lost | `App.buffersRef` buffers it and flushes on `registerTerminal`. **Do not remove.** |
| Every keystroke triggering a full-page layout on a long transcript | `content-visibility: auto` + `contain-intrinsic-size` on `.chat-msg` / `.tool-call` |
| A controlled chat input re-rendering on every keystroke | The composer is uncontrolled (ref-based) |
| Unstable callbacks defeating `memo()` — the 5s git poll re-rendering the whole chat | `useCallback` with correct deps; row components take primitive props |
| `requestAnimationFrame` assumed to be free | It is a real API call; measure before and after |
| `styles.css` and test files use CRLF, so exact-match edits fail | Edit them with a script when the edit tool cannot match |
| Transient chat lines (compaction/retry) being written to the transcript | They live only in renderer feed state |

## 11.8 Changelog format

Defined in `docs/changelogs/changelog-format.md`. Summary:

```markdown
# Changelog — Meow Coding v<old> → v<new>

## 🚀 New Features
### <Major feature name>
- User-visible change, in English, focused on user value.

## 📱 Mobile Remote Control — Coming Soon
- What is being developed. End with "Stay tuned — … 🚧".

## 🐛 Bug Fixes
- One fix per line, scoped ("Chat: …", "Remote: …").

## 🧹 Internal & Docs
- Refactor, docs, specs, plans, chore.
```

Rules: English; group commits by feature (from `git log --oneline <old-tag>..<new>`), never list
commits individually; one line per item, at most two sentences, starting with a verb or a
user-visible phrase; emoji in the main section headers; **always** describe Mobile as *Coming Soon* —
never as available.

## 11.9 Checklists

### Before claiming a change is complete

```bash
npm run typecheck   # must pass
npm test            # must pass
# and, when the change touches e2e-covered surface:
npm run build && npm run e2e
```

Then: relevant `AGENTS.md` updated, and any `docs/reference/` page whose described behavior changed.
This includes any feature, architecture, or system change described above.

### Adding an IPC call

`src/shared/ipc.ts` → `src/main/index.ts` handler → `src/preload/index.ts` →
`tests/unit/ipc-contract.test.ts`. See
[05 — worked example](05-ipc-contract.md#56-adding-a-new-ipc-call--worked-example).

### Adding an agent tool

`tools/<name>.ts` → `tools/registry.ts` → `DEFAULT_MEOW_CONFIG.permission` in `agent/config.ts` →
`tests/unit/agent-tools-*.test.ts` → `tools/AGENTS.md`. Remember `snapshotFile` before mutating and
`recordArtifact` after.

### Adding a setting

`MeowSettings` in `src/shared/types.ts` → normalize in `src/main/agent/config.ts`
(`normalize*` + `configToSettings` + `settingsToConfig`) → the matching tab in
`components/settings/`.

### Adding a push event

`Event*` channel + payload interface + `on*` in `AgentApi` → `subscribe(...)` in preload →
`win?.webContents.send(...)` in main → subscribe (and unsubscribe!) in the renderer.

## 11.10 Where to look when something breaks

| Symptom | First place to look |
|---|---|
| Agent exits immediately with code 2 and no output on Windows | `buildSpawnCommand` — the command is a `.cmd` shim |
| Orphan processes after quit | `PtyManager.stop` / `killProcess`, and the `bash` tool's `killAfterGrace` |
| Provider 400 about tool messages | Turn overlap — `runTurn`'s await of `turnPromises` |
| Provider rejects `max_tokens` | `reduceBudgetForMaxTokensError` + `learned-limits.json` |
| Context overflow loops | `MAX_COMPACT_PER_RUN`, `tryRecoverFromReject`, `hardTruncate` |
| Session never compacts | `compaction.auto`, the resolved limit (`getContextInfo`), `usableContextTokens` |
| Costs look wrong | `agent/usage.ts` prices, and whether cache read/write are being counted |
| Settings save hangs | `reload()` reconnecting MCP servers (up to 60s each) — provider connect deliberately does not await it |
| Chat input lags | [09 — Performance rules](09-ui-guide.md#97-performance-rules) |
| A store file "lost" data | Look for `<file>.corrupt` next to it |
| Browser tools all fail | Bridge not paired — status is `listening`/`disconnected`, not `paired` |
| Codex chat fails with "model is not supported" | The fallback model list in `connections-manager.ts` drifted from the CLIProxyAPI registry |
