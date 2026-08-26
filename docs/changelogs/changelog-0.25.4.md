# Changelog — Meow Coding v0.25.3 → v0.25.4

## 🚀 New Features

### Run in background — minimize to tray
- Closing the window now hides Meow Coding to the system tray (Windows taskbar, macOS menu bar, Linux indicator) instead of quitting — agents, terminals and chat keep running.
- One-time system notification the first time the window is hidden: "Meow Coding is still running in the background, click the tray icon to open it again."
- Tray icon: left-click toggles the window, right-click menu offers **Show Meow Coding** and **Exit** (real quit still runs the full cleanup: agents, PTY sessions, browser bridge).
- Reopening the window restores the exact UI state — nothing is re-hydrated.

### File viewer — single horizontal scrollbar
- Wide content (long code lines, raw text, wide markdown code blocks/tables) now stretches to its natural width instead of wrapping or scrolling in place.
- The outer body owns the single horizontal scrollbar; the nested scrollbar inside highlighted code is gone.
- Markdown paragraphs still wrap to the window width — only wide blocks expand.

### Bigger, brighter scrollbars
- Scrollbars are larger and more visible; empty-state font is consistent across panels.

## 🐛 Bug Fixes
- Chat: long markdown code blocks no longer get underlined like clickable file links (only real inline paths are clickable).
- Update dialog: changelog popup now uses square corners, 0.5rem padding and full width — no more empty space on the right.

## 🧹 Internal & Docs
- Spec + implementation plan for the tray feature and the file-viewer single-scrollbar change.
- Version bumped to 0.25.4.
