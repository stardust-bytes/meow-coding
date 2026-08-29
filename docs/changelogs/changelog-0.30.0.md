# Changelog — Meow Coding v0.29.0 → v0.30.0

## 🚀 New Features

### Agent hooks system (PreToolUse / PostToolUse / Stop)
- Run your own policy around the native agent's tool calls. Hooks execute **outside the context window** — as a subprocess, an MCP tool, an HTTP endpoint, or a tool-less model call — and only a bounded result ever reaches the model.
- Configure hooks globally in `meow.json` under a `hooks` key, per project in `<cwd>/.meow/hooks.json`, or both: the two scopes merge and every matching hook runs, so a project cannot silently drop a global policy.
- `PreToolUse` gates a call before the permission prompt: deny it, rewrite its input, waive the prompt, or attach extra context. Hooks only ever tighten — a hook can never override a configured deny or plan mode.
- `PostToolUse` runs after a tool acts, where it can redact or replace what the model reads and add a note beside the result.
- `Stop` can keep a turn going when work isn't finished, feeding its reason back as the next instruction; a block cap stops a hook that is never satisfied from looping forever.
- Matchers follow Claude Code's rules (`*`, an exact name, an `edit|write` list, or a regex), and the exit code is the control channel — `2` blocks, anything else does not, and a hook that fails or times out never blocks your work.
- Hooks apply inside subagents too, and the config is re-read every turn, so editing a hooks file takes effect on the next message without a reload.
- Hook activity is recorded in the trace (never in the transcript): each run shows its event, tool, status, and duration.

## 📱 Mobile Remote Control — Coming Soon
- Work continues on the WS relay, pairing code, and chat sync so a phone can drive a desktop session.
- Stay tuned — the mobile companion is still in the oven 🚧

## 🐛 Bug Fixes
- Right panel: the tab strip is now square and flush with the Explorer header (38×38 tabs in a 38px strip) instead of overhanging it at 44px.

## 🧹 Internal & Docs
- New `hooks.ts` module with the executor, config merge, matcher, and the four handler types, covered by unit tests for the exit-code protocol, decision aggregation, and each handler.
- `McpManager` gained `callTool` so callers can address a server tool by name instead of going through the `mcp__server__tool` registry.
- Documented the hooks subsystem in the agent runtime reference (§3.17) and in `src/main/agent/AGENTS.md`.
- Refreshed the app icon set from the updated Meow Coding logo.
- Bumped version to 0.30.0.
