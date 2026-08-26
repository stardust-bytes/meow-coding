# Changelog — Meow Coding v0.25.7 → v0.26.1

## 🚀 New Features

### Git Viewer
- New Git viewer popup with **Changes / History / Blame** tabs and branch switching, opened from the
  sidebar menu or the status bar.
- Unified diff parser and viewer with per-line rendering for changed files.
- Branch dropdown closes on outside click; history log no longer shows stray newlines.

### Context compaction
- The chat feed now shows a **Compacting context…** line while compaction runs; it resolves into
  "Context compacted" (or a red failure notice) when the summary call finishes.
- Compaction triggers on the **live transcript size** — including tool outputs appended after the
  last model response — so it kicks in at the threshold instead of overshooting the budget first.

### Settings
- Provider **base URL** can now be edited without re-entering the API key.

## 🐛 Bug Fixes
- Context: compaction could run late when a big tool result was appended after the previous
  provider-reported usage.

## 🧹 Internal & Docs
- Window chrome: Windows overlay button colors now match the app theme; bottom corners squared
  against the window edge.
- Docs: CSS border-radius scope pattern recorded in AGENTS; git viewer design + implementation plan.
- Version bumped to 0.26.1.
