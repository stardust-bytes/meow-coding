# Changelog — Meow Coding v0.26.3 → v0.26.4

## 🚀 New Features

### Codex OAuth Provider
- Sign in with Codex OAuth (PKCE) directly in the Providers screen; accounts are managed per-provider with connection lifecycle exposed over IPC.
- A local account-scoped Codex proxy sidecar routes native chat through the selected Codex account, with connection metadata and secrets persisted securely.
- Provider model effort catalog is synced, published, and applied — effort variants from the provider are picked up automatically.
- Codex model accounts display a human-friendly name instead of a raw identifier.

### Fullscreen Settings Page
- Settings is now a full-screen page with auto-save, replacing the modal dialog.
- A prominent back button blends with the sidebar header and returns to the app.

### UI Redesign — VSCode Dark+ Palette
- Switched the entire app to a near-black VSCode Dark+ palette (`#0a0a0b` base, `#007acc` accent) with white-dominant text for maximum contrast.
- Buttons, inputs, dropdowns, and menu items enlarged to Tailwind default sizes; root font size raised from 14px to 15px.
- Dropped unloaded display fonts (Bricolage/Instrument Sans) — UI now uses Segoe UI Variable/system-ui; terminal and data labels keep JetBrains Mono.
- Terminal (xterm) theme synced to VSCode Dark+ ANSI colors.
- Status bar: square corners, accent-blue hover for git/browser buttons, solid pill backgrounds for "waiting" (red) and "paired" (green) states.
- Chat: user bubble filled with accent blue; `@mentions` and `/slash` commands use gold (`#ffd700`) for contrast on blue; tool-call header/body flush border-radius.
- Sidebar footer taller with a larger menu button (32px).
- Right panel header fixed at 38px height for Explorer and Artifacts tabs.

### Settings Tab Improvements
- Commands tab: "+ Add command" button moved to the top, matching the Agents tab pattern.
- Context tab: fields grouped into 4 sections (Limits / Compaction / Tool output / Notifications) with section headers, centered layout.
- Agents tab: subagent models laid out in a responsive 2-column grid.
- Provider connect form and submodel fields wrap on narrow screens.

## 🐛 Bug Fixes
- Chat: never leave an orphan tool item that bricks the LLM conversation.
- Codex: bump CLIProxyAPI to v7.2.141 (registry + tool-call translator); drop stale fallback model names not in the registry.
- Codex OAuth: use registered callback port and required authorize params; resolve accounts without a `meow.json` entry and harden proxy lifecycle.
- Cliproxy: register internal translators to fix chat 400s.
- Build: package prebuilt cliproxy sidecar when Go is not installed.
- Ollama Cloud: sync live models, normalize base URL to `/v1`, guard invalid API keys.
- Preserve provider model metadata in the picker.
- Tests: isolate officecli PATH discovery from host shims.

## 🧹 Internal & Docs
- Translated all Vietnamese documentation (AGENTS.md files, changelogs, guides, READMEs) to English.
- Added design spec and implementation plan for the Codex OAuth provider-synced effort.
- Added spec and plan for the Codex OAuth local proxy.
- Added spec and plan for the settings fullscreen redesign.
- Dropped unused `openExternal` from the connections manager.
- Version bumped to 0.26.4.