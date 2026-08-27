# Changelog — Meow Coding v0.26.7 → v0.26.8

## 🐛 Bug Fixes
- Store: fixed a crash on Windows where saving `sessions.json` threw `EPERM` when the file was transiently locked by antivirus, Search Indexer or OneDrive. The atomic temp+rename write now retries with backoff and falls back to an in-place write instead of crashing the main process.
- Store: debounced flush writes are now best-effort, so a failed write during a background save or on quit no longer crashes or blocks shutdown.

## 🧹 Internal & Docs
- Synced `AGENTS.md` with the resilient atomic write behavior in `json-store` (Windows lock retry + fallback).
- Version bumped to 0.26.8.
