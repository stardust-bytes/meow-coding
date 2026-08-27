# Changelog — Meow Coding v0.26.6 → v0.26.8

## 🚀 New Features

### Provider limits — trust the provider, verify by error
- The agent now resolves each model's real context/output limits from the most reliable source it knows: your override → limits the provider has verified in past errors → the live `/models` endpoint → the catalog → a 128k default, in that order.
- Provider-verified caps are remembered across restarts (`learned-limits.json`) and only ever tighten, so a model that really caps at 64k stops being sent a 384k `max_tokens` on every turn.
- Live `/models` limits are fetched in the background and cached, so resolution never blocks a turn on the network.
- When the provider rejects a request for context overflow, the transcript is compacted and the same step is retried automatically instead of ending the turn.
- The `max_tokens` actually sent is now the verified output limit, kept separate from the reserve the context budget holds for the reply — so a small-context model no longer gets a prompt that fills the window and is then rejected once it starts writing.

### Context knobs — auto-scale + Advanced UI
- Compaction knobs (buffer, keep-tokens, tool-output cap) are now optional: leave them empty and they auto-scale by ratio of the model's context window (15% / 6% / 1.5%, with floors), so a 1M model and a 32k model both get sane defaults without hand-tuning.
- The Context settings tab is reorganized into Basic (max steps, auto-compact, MCP output cap) plus a collapsible Advanced section; empty fields show the auto value for the active agent as a placeholder.
- MCP tool output is capped by a new `mcpOutput.maxTokens` knob (default 25000): oversized results are truncated to a head/tail preview with the full output written to disk, instead of flooding the context.

### Subagents — permission, cost & lifecycle hardening
- Subagent roles are now discovered dynamically from `.meow/agents/*.md` (project) or `userData/agents/*.md` (user), with `name`, `description`, `tools`, `model`, `deny`, and `ask` frontmatter.
- A subagent runs under a derived permission context that only narrows (never widens) the user's own permission rules; plan mode and the role's tool/model gates are resolved dynamically per spawn.
- Subagent snapshots are attributed to the parent turn, so edits made by a child land in the correct session and can be undone/redone together.
- Configurable step budget per subagent, with honest "incomplete" reports when a child exhausts its budget instead of a falsely complete summary.
- A background subagent can be cancelled via Stop, and its token spend counts into the session cost alongside the main agent.

### Retry feedback
- When a request is retried, the chat shows a transient "Retrying in Xs… (attempt N/M)" line like Claude CLI, so a rate-limited turn no longer looks frozen.

### Popup windows follow the app theme
- FileViewer and GitViewer windows now share the main app's hidden title bar and theme-matched overlay colors (Windows/macOS) or frameless style (Linux), so they no longer look like detached OS windows.
- Window-chrome IPC (min/max/close/theme) is routed to the window that sent it, so popup overlay colors follow the app theme correctly.

### Settings — output budget
- Added a configurable per-answer output budget (`maxOutputTokens`) that falls back to the user setting when a model's catalog limit is unknown, and never reserves more than half the context window so auto-compaction keeps room to work.

## 🐛 Bug Fixes
- Store: fixed a crash on Windows where saving `sessions.json` threw `EPERM` when the file was transiently locked by antivirus, Search Indexer or OneDrive. The atomic temp+rename write now retries with backoff and falls back to an in-place write instead of crashing the main process.
- Store: debounced flush writes are now best-effort, so a failed write during a background save or on quit no longer crashes or blocks shutdown.
- Agent: when a provider rejects `max_tokens` (e.g. deepseek's catalog 384k vs a 64k real cap), the request is retried with the real limit parsed from the error instead of failing the whole turn.
- Agent: pressing Stop during a retry backoff or a provider `Retry-After` now stops the turn immediately instead of hanging for the full delay.
- Agent: a huge `Retry-After` header (60s+) is capped at 60s so it can't freeze the turn for minutes.
- Agent: compaction stays alive when the context budget is below buffer + reserve (small-context models), so compact-on-reject still has room to shrink the transcript.
- Markdown: theme-aware tokens keep light mode readable — chat mentions/slash-commands, blockquotes, and table borders no longer use dark-only colors that wash out on a white background.
- Title bar: Windows overlay buttons follow the app theme (sync with theme and use the theme text color in both modes).
- Task: subagent edits are snapshotted and the dead `todowrite` tool is removed.
- Chat: stopped the scroll re-anchor loop that spun up to 300 frames and caused continuous flicker when content was shorter than the viewport.

## 🧹 Internal & Docs
- Added design specs and implementation plans for the provider-limits and context-knobs redesigns.
- Subagent permission hardening: `ToolPermissionContext` + `decide()`, derived narrowing context, and per-turn permission decided once per call.
- Moved guide/protocol/test docs into typed folders under `docs/`, moved changelogs into `docs/changelogs/`, and removed an orphaned release note.
- Documented derived subagent permissions and role files; added the permission-hardening spec and implementation plan.
- Added the settings active-tab primary-color design note.
- Replaced screenshots with light- and dark-mode images in `README.md` and the `docs/` landing page.
- Updated e2e smoke tests to match the current design.
- Synced `AGENTS.md` with the limits service, auto-scaled compaction, MCP output truncation, the abort-aware retry layer, and the resilient atomic write behavior in `json-store` (Windows lock retry + fallback).
- Versions bumped to 0.26.6, 0.26.7 and 0.26.8.
