# Changelog — Meow Coding v0.25.6 → v0.25.7

## 🚀 New Features

### Sidebar footer menu — version + update check
- Footer dropdown now shows the current app version and a **Check update** button that stays
  open while checking (button shows a loading spinner + disabled until the check finishes).
- When an update is available the existing **Update available** dialog opens; when already on the
  latest version a dialog reports *"Đây là phiên bản mới nhất"* with a Close button.
- Settings moved above Model Router in the footer dropdown.

### Settings cleanup
- **Remote Control** and **Templates** tabs are hidden from the Settings screen (backend unchanged).

### Model Router removed
- Removed the entire Model Router feature (accounts manager, local gateway, routing, quota, logs).
- The **Model Router** menu item remains in the footer dropdown and opens a small **Coming soon** dialog.

## 🐛 Bug Fixes
- App: single instance lock — double-clicking the desktop icon restores the tray session instead
  of spawning a second process.
- Sidebar: footer dropdown opens upward so it stays inside the viewport.

## 🧹 Internal & Docs
- Removed Model Router design spec + implementation plan.
- Removed connections (Claude/Codex login) and gateway backend; CLI agents now run with the
  machine's default configuration.
- Version bumped to 0.25.7.
