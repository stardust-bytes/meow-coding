# 01 — Product Overview

## 1.1 Problem and positioning

Developers increasingly drive their work through *CLI coding agents* — `opencode`, `claude`,
`aider` and similar. Each of these runs in its own terminal, holds its own conversation, and does
not know about the others. Running three of them across two projects means juggling six terminal
windows, six sets of logs, and no shared view of what changed.

**Meow Coding** solves that by making the agent the unit of work instead of the terminal:

1. **A single window hosting many agents.** Each agent occupies a pane. Panes can be started,
   stopped, restarted, injected with a prompt, zoomed to full window, or pushed to the background.
2. **A first-party agent that is not a black box.** Because most CLI agents cannot be instrumented,
   Meow ships its **native "Meow" agent**: the same class of coding agent, but implemented in-app so
   its transcript, tool calls, permissions, cost, context usage and file edits are all visible and
   controllable inside the UI.
3. **Project-centric ergonomics.** Workspaces map to git project folders. Git status, a file tree,
   a git viewer, and an "artifacts" list of files the agents touched are always one click away.

## 1.2 Primary users

| User | What they do with it |
|---|---|
| Solo developer | Runs the native Meow agent on one project; occasionally opens a second pane with `opencode` for comparison |
| Multi-project developer | Keeps several workspaces; switches between them; leaves background agents working |
| Agent power user | Configures providers, model variants, permissions, MCP servers, custom slash commands, custom subagent roles and custom tools |
| Team lead / reviewer | Uses plan mode, the `/review` command and the `reviewer` subagent for read-only analysis |

## 1.3 Feature inventory

Grouped by business capability. Each row names the primary implementation site so an agent can jump
straight to the code.

### Workspaces & panes

| Capability | Behavior | Implementation |
|---|---|---|
| Add workspace | Pick a folder; persisted in `userData/workspaces.json`; a native `meow` agent is auto-created if the workspace has none | `src/main/workspace-store.ts`, `Channels.WorkspaceAdd` |
| Open workspace | Registers native agents synchronously (so chat mounts instantly), then loads tools/MCP and starts PTY agents off the critical path | `MainApp.openWorkspace` / `prepareWorkspace` |
| Launch templates | Defaults: `meow` (native), `opencode`, `claude code`, `aider --auto-commits`; user templates are CRUD-able | `src/main/default-templates.ts`, `template-manager.ts` |
| Pane grid | 1–2 columns; click a pane to zoom full window, `Esc` to exit | `PaneGrid.tsx` |
| Pane status | Status dot (spawning/running/idle/exited/stopped/error), git branch, dirty-file count | `PaneHeader.tsx`, `git-status-service.ts` |
| Background agents | An agent can be moved out of the grid and keeps running; listed in a background panel | `Channels.AgentSetBackground`, `BackgroundPanel.tsx` |
| Idle / exit alerts | Idle alert after 5 minutes without output; exit alert classified by exit code | `alert-service.ts` |
| Per-agent logs | Every byte of PTY output appended to `userData/logs/<agentId>.log`, openable from the pane menu | `log-manager.ts` |
| Integrated terminals | Plain shell terminals (not agents) can be opened per project | `Channels.TerminalOpen`, `terminal-shell.ts` |

### Native Meow agent

| Capability | Behavior | Implementation |
|---|---|---|
| Chat turn loop | Streams text/reasoning deltas, executes tool calls, enforces permissions, honors abort | `src/main/agent/loop.ts` |
| Tool registry | `bash`, `read`, `write`, `edit`, `apply-patch`, `glob`, `grep`, `git`, `question`, `todowrite`, `task`, `revert`, `skill`, `webfetch`, `websearch`, `lsp`, `office`, `browser_*` | `src/main/agent/tools/` |
| Permissions | Per-tool `allow` / `ask` / `deny` with wildcard patterns, "always allow" persistence, and a read-only **plan mode** | `agent/permission.ts`, `agent/saved-permissions.ts` |
| Sessions | Create / switch / rename / delete per agent; auto-titled from the first user message; transcript persisted | `agent/session.ts` |
| Undo / redo | Per-turn file snapshots; undo restores files *and* truncates the transcript; redo re-applies both | `agent/snapshot.ts`, `MeowAgentManager.undo/redo` |
| Message queue & steering | Messages sent while a turn runs are queued (max 5) and injected at the next step boundary, resetting the step budget | `MeowAgentManager.enqueueMessage`, `loop.ts` `takeSteers` |
| Context compaction | Auto prune of old tool outputs, then LLM summarization of the head with a verbatim tail; hard truncation as a last resort; also runs while idle | `agent/compact.ts` |
| Cost & token accounting | Per-message tokens, per-session cost, per-model aggregate, cache-read/write aware | `agent/usage.ts`, `agent/token.ts`, `Channels.StatsGet` |
| Subagents | `task` tool spawns an isolated agent with its own context, narrowed permissions, optional dedicated model, resumable sessions, and background execution | `agent/tools/task.ts`, `agent/subagent-roles.ts` |
| Slash commands | Built-ins `/init`, `/review`, `/new`, `/frontend-design`, 14 `/sp-*` Superpowers commands; user commands in `commands.json`; project commands in `.meow/commands/*.md` | `agent/commands.ts` |
| Skills | Markdown skill packs discovered from `.meow/skills`, `userData/skills`, and the bundled `resources/skills`; listed in the system prompt, loaded on demand by the `skill` tool | `agent/skill.ts` |
| Instructions | `AGENTS.md` / `CLAUDE.md` walked up from the agent cwd are inlined into the system prompt; module-level ones attach automatically when a nearby file is read | `agent/instructions.ts` |
| `@`-mentions | `@path` in the composer resolves to an absolute path and is appended as a hint (the agent reads the file itself) | `agent/references.ts`, `file-suggest.ts` |
| Images | Paste/drop up to 4 images (≤5MB each) into the composer; sent as data URLs | `ChatInput.tsx`, `agent/message.ts` |
| Trace | Optional per-session structured event log (turn, message, tool, subagent, compaction, error, done, pty-run) with a trace panel | `agent/trace-store.ts`, `components/trace/` |
| Notifications | Native OS notifications when the agent needs input or finishes (only while the window is unfocused) | `notification-service.ts` |

### Providers, models & accounts

| Capability | Behavior | Implementation |
|---|---|---|
| Providers | Anthropic, Google, and any OpenAI-compatible endpoint (baseUrl + key + models) | `agent/llm.ts`, `agent/config.ts` |
| Model catalog | models.dev catalog with an offline snapshot fallback; live `/models` sync per provider | `models-catalog.ts`, `models-snapshot.json` |
| Model variants | Reasoning-effort levels derived per model family (e.g. `low`/`medium`/`high`/`xhigh`) | `model-variants.ts` |
| Context/output limits | Resolved from override → learned → live `/models` → catalog → 128k default; provider rejections tighten the learned value permanently | `agent/limits.ts`, `agent/learned-limits.ts` |
| API key vault | Keys stored encrypted in the OS keychain via Electron `safeStorage`; settings hold only a `keyRef` | `vault.ts` |
| Model Connections (Codex) | Multiple ChatGPT/Codex accounts via PKCE OAuth; the active account's requests go through an **account-scoped loopback proxy** so a credential for one account can never route through another | `connections/`, `sidecars/meow-cliproxy/` |

### Project surfaces

| Capability | Behavior | Implementation |
|---|---|---|
| Directory tree | Lazy-loaded on expand, ignores `node_modules`/`.git`/`out`/`dist`/…, expansion state survives tab switches | `RightPanelTree.tsx`, `dir-lister.ts` |
| Artifacts | Lists `.md` files agents created/edited; external CLI agents are attributed via a file watcher that filters spurious events by comparing `(mtime, size)` | `artifact-store.ts`, `file-watcher.ts` |
| Git viewer | Separate window: changes, diff, history, blame, branch switcher, stash/discard | `git-viewer.ts`, `components/git/` |
| File viewer | Separate window with syntax highlighting; binaries open with the system app | `file-viewer.ts`, `FileViewer.tsx` |

### Platform & desktop

| Capability | Behavior | Implementation |
|---|---|---|
| Frameless window | Custom title bar with min/max/close, re-themed live on dark/light toggle | `window-chrome.ts`, `TitleBar.tsx` |
| Themes | VSCode Light+ / Studio Dark palettes, CSS-variable driven, persisted in `localStorage` (`meow.theme`), inherited by popup windows | `styles.css`, `theme.ts` |
| Tray | Closing the window hides to tray so agents keep running; real quit via tray Exit / Cmd+Q | `tray-manager.ts` |
| Single instance | A second launch focuses the existing window instead of starting a duplicate bridge/agents | `app.requestSingleInstanceLock()` in `index.ts` |
| Auto-update | electron-updater; manual and startup checks; background download then a click-to-install notification | `updater.ts`, `UpdateDialog.tsx` |
| Remote control | Desktop half of a mobile remote-control protocol over a self-hosted WebSocket relay with 6-digit pairing (mobile app not shipped yet) | `remote/`, `server/` |

## 1.4 Domain glossary

| Term | Meaning |
|---|---|
| **Workspace** | A git project folder registered in the app, with a list of agents. Persisted in `workspaces.json`. |
| **Agent** | A configured worker inside a workspace. Two kinds: `pty` (an external CLI process) and `native` (the in-app Meow agent). |
| **Template** | A named launch recipe (`command` + `args` + `kind`) used to create agents. |
| **Pane** | The UI slot rendering one agent — either an xterm terminal (`pty`) or the chat panel (`native`). |
| **Session** | One conversation of a native agent. An agent may own many; exactly one is active. |
| **Transcript item** | The persisted unit of a session: either a `message` (user/assistant) or a `tool` (a tool call with input/output/permission). It is the single source of truth for what the LLM sees. |
| **Turn** | One user message and everything the agent does in response, until `done` or `error`. |
| **Step** | One LLM request inside a turn. A turn runs many steps; `maxSteps` bounds an uninterrupted run. |
| **Steering** | Injecting queued user messages at a step boundary of a running turn (rather than waiting for it to finish). Resets the step budget. |
| **Compaction** | Shrinking the transcript so it fits the model's context window: prune old tool outputs → LLM-summarize the head, keep the recent tail verbatim → hard-truncate as a last resort. |
| **Variant** | A provider-specific option bundle for a model, typically reasoning effort (`low`/`medium`/`high`/`xhigh`). |
| **Mode** | `build` (default, full tools) or `plan` (read-only: writes denied, write-shaped bash denied). |
| **Subagent / task** | An isolated agent run spawned by the `task` tool with its own context and a *narrowed* copy of the parent's permissions. Cannot nest. |
| **Role** | A subagent's persona: name, description, system prompt, tool allowlist, and permission tightenings. Built-ins: `research`, `general`, `reviewer`. |
| **Skill** | A markdown document (`SKILL.md` or `*.md` with frontmatter `name`/`description`) that the agent can load into context via the `skill` tool. |
| **Command** | A slash command: a prompt template with `$1..$N`, `$ARGUMENTS`, and backtick-shell interpolation. `type: 'system'` commands act on app state instead of prompting the LLM. |
| **Artifact** | A file an agent created or edited during a session, tracked per project for the right-panel Artifacts list. |
| **Connection / account** | An OAuth-authenticated provider account (currently Codex/ChatGPT) managed under `userData/connections`. |
| **Bridge** | The loopback WebSocket server that pairs the app with the Meow Chrome extension. |
| **Relay** | The self-hosted WebSocket server that routes messages between the desktop app and a (future) mobile client. |
| **Vault** | The `safeStorage`-encrypted secret store; settings and indexes reference secrets by `keyRef`, never by value. |

## 1.5 Design lineage and credits

- **opencode** — the native agent's architecture (slash commands, undo/redo, LSP diagnostics,
  compaction, cost tracking, MCP, skills, steering) is explicitly modeled on it. The feature-by-feature
  comparison lives in `docs/superpowers/notes/2026-08-05-opencode-feature-diff.md`, and several
  source comments say "mirrors opencode …" to mark the reference behavior.
- **obra/superpowers** — the bundled workflow skills and the `/sp-*` commands.
- **anthropics/skills** (Apache-2.0) — the bundled frontend/design skills, shipped verbatim with
  their license files.
- **iOfficeAI/OfficeCLI** (Apache-2.0) — the `office` tool backend.
- **CLIProxyAPI** (MIT, pinned `v7.2.141`) — wrapped by the `meow-cliproxy` sidecar.
- **@lydell/node-pty**, **xterm.js**, **Electron**, **electron-vite**, **React**, **TypeScript**,
  **Vercel AI SDK** (`ai`, `@ai-sdk/*`) — the platform.

## 1.6 Language policy

- Source code identifiers, comments and **all UI labels are English**.
- System-style notices emitted from the main process to the user (chat errors, PTY hints, native
  notifications) are **English**, always prefixed with `[meow]`. Example:
  `"[meow] No provider/API key configured. Open Settings, add a provider (id + API key + models) and try again."`.
  Some in-code comments are Vietnamese for historical reasons; treat them as normal comments.
