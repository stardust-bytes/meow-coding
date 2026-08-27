# Changelog — Meow Coding v0.26.8 → v0.26.9

## 🚀 New Features

### Tab bar layout — VSCode-style pane tabs
- Replaced the split-screen pane grid with a top tab bar so each agent pane is a single active view with a pill-style tab card.
- Tab bar is pinned to a fixed 38px height with square tab bottoms, and the active pane fills the remaining content area evenly padded on all sides.

### Provider flexibility
- Custom OpenAI-compatible endpoints are now fully supported — point the agent at any OpenAI-compatible base URL and it works.
- `reasoning_content` is echoed for custom OpenAI-compatible providers, so reasoning shows up in the chat.

### Retry feedback
- The retry indicator shows a live countdown and a pulse animation while a request is being retried, so a rate-limited turn doesn't look frozen.

## 🐛 Bug Fixes
- Chat: the pane now fills the full height and keeps the composer pinned at the bottom, so an empty feed no longer collapses to the top and a long message no longer pushes the input off screen.
- UI: pinned the sidebar Projects header to the same 38px height as the explorer header and balanced the Add Project button sizing.
- Tab bar: tabs are fully rounded, the tab bar container is top-rounded only, and its horizontal scrollbar is thinned to 4px.
- Providers: editing a provider no longer resets its `providerType` to the default.

## 🧹 Internal & Docs
- Added the full system reference for agents/LLMs and design specs/plans for the PaneTabs redesign.
- Synced `AGENTS.md` and `docs/reference/` with the tab-bar layout, sidebar header height, and chat layout fixes.
- Version bumped to 0.26.9.
