# Changelog — Meow Coding v0.26.9 → v0.27.0

## 🚀 New Features

### Daily system logs
- All app-wide logs (main process, renderer, and agent events at INFO/WARN/ERROR level) are now written to `userData/logs/<YYYY-MM-DD>-log.txt`, one file per day.
- Fatal errors (`uncaughtException` / `unhandledRejection`) are captured with stack traces before the app exits, and agent crashes (non-zero exit, chat errors) are logged too.
- Log files older than 7 days are pruned automatically on startup, so disk usage stays bounded.

### Background agents keep running across tab switches
- Switching tabs no longer interrupts native agents — in-flight permission/questions are preserved and the pane stays mounted, so background agents keep streaming and answering.
- The chat panel restores a pending prompt after remounting, instead of leaving the agent stuck.

### Safety confirmations
- Closing a tab, deleting an agent, and removing a background agent now ask for confirmation before acting.

### Provider requests
- `max_tokens` is omitted by default (kept as an explicit override), matching provider defaults more cleanly.

## 🐛 Bug Fixes
- Agents: OpenAI-compatible proxies that reject an over-limit input with "Input token exceed the limit" are now recognized as context overflow and trigger compaction instead of a hard error.
- System logs: renderer console forwarding is guarded against dev hot-reload, preventing duplicate log entries.

## 🧹 Internal & Docs
- Added design specs and implementation plans for the daily system logger and the active-tab persistence feature.
- Synced `AGENTS.md` and `docs/reference/` with the system logger (new IPC channel `system-log:write`, new storage file) and background-agent behavior.
- Chat: tool-call content font size matched to regular chat messages.
- Version bumped to 0.27.0.
