# Changelog — Meow Coding v0.26.5 → v0.26.6

## 🚀 New Features

### Subagents — permission, cost & lifecycle hardening
- Subagent roles are now discovered dynamically from `.meow/agents/*.md` (project) or `userData/agents/*.md` (user), with `name`, `description`, `tools`, `model`, `deny`, and `ask` frontmatter.
- A subagent runs under a derived permission context that only narrows (never widens) the user's own permission rules; plan mode and the role's tool/model gates are resolved dynamically per spawn.
- Subagent snapshots are attributed to the parent turn, so edits made by a child land in the correct session and can be undone/redone together.
- Configurable step budget per subagent, with honest "incomplete" reports when a child exhausts its budget instead of a falsely complete summary.
- A background subagent can be cancelled via Stop, and its token spend counts into the session cost alongside the main agent.

### Popup windows follow the app theme
- FileViewer and GitViewer windows now share the main app's hidden title bar and theme-matched overlay colors (Windows/macOS) or frameless style (Linux), so they no longer look like detached OS windows.
- Window-chrome IPC (min/max/close/theme) is routed to the window that sent it, so popup overlay colors follow the app theme correctly.

### Settings — output budget
- Added a configurable per-answer output budget (`maxOutputTokens`) that falls back to the user setting when a model's catalog limit is unknown, and never reserves more than half the context window so auto-compaction keeps room to work.

## 🐛 Bug Fixes
- Agent: when a provider rejects `max_tokens` (e.g. deepseek's catalog 384k vs a 64k real cap), the request is retried with the real limit parsed from the error instead of failing the whole turn.
- Markdown: theme-aware tokens keep light mode readable — chat mentions/slash-commands, blockquotes, and table borders no longer use dark-only colors that wash out on a white background.
- Title bar: Windows overlay buttons follow the app theme (sync with theme and use the theme text color in both modes).
- Task: subagent edits are snapshotted and the dead `todowrite` tool is removed.
- Chat: stopped the scroll re-anchor loop that spun up to 300 frames and caused continuous flicker when content was shorter than the viewport.

## 🧹 Internal & Docs
- Subagent permission hardening: `ToolPermissionContext` + `decide()`, derived narrowing context, and per-turn permission decided once per call.
- Moved guide/protocol/test docs into typed folders under `docs/`, moved changelogs into `docs/changelogs/`, and removed an orphaned release note.
- Documented derived subagent permissions and role files; added the permission-hardening spec and implementation plan.
- Added the settings active-tab primary-color design note.
- Replaced screenshots with light- and dark-mode images in `README.md` and the `docs/` landing page.
- Updated e2e smoke tests to match the current design.
- Version bumped to 0.26.6.
