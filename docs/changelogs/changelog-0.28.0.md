# Changelog — Meow Coding v0.27.0 → v0.28.0

## 🚀 New Features

### Open Terminal opens a real OS terminal
- The "Open Terminal" action in a project's menu now opens an actual OS terminal window (cmd.exe on Windows, the default shell elsewhere) rooted at the project directory, instead of creating a tab inside Meow Coding.
- Adds the `system-terminal:open` IPC channel and `openSystemTerminal(cwd)` on `window.api`.

## 🧹 Internal & Docs
- Translated all user-facing messages (system-style `[meow]` notifications, error messages, browser-extension popup and manifest, renderer UI strings) from Vietnamese to English.
- Added a language rule: design specs, implementation plans, and all project documentation (README, `docs/`, `AGENTS.md`, changelogs) must be written in English.
- Synced `docs/reference/` (IPC contract, UI guide, language policy, conventions) with the above changes.
- Version bumped to 0.28.0.
