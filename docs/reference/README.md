# Meow Coding — Reference Documentation

A complete, machine-readable description of the Meow Coding product: what it does, how it
operates, which features exist, and how it is built. Written primarily for AI agents / LLMs that
need to understand this codebase quickly, and secondarily for new human contributors.

> **Source of truth.** This set describes the code as it exists in the repository. Where a document
> states a constant, a file path, or a channel name, it was read from the source. If code and docs
> disagree, the code wins — and the doc should be corrected (see
> [11-conventions-and-pitfalls.md](11-conventions-and-pitfalls.md#113-documentation-sync-rule)).

## What Meow Coding is, in one paragraph

Meow Coding is a cross-platform **Electron desktop application** that lets a developer run several
**CLI coding agents** (opencode, Claude Code, aider, or anything on `PATH`) side by side in
parallel terminal panes inside one window, *and* ships its own first-party **native "Meow" agent**
— a full LLM coding agent with a chat UI, a tool registry, sessions, permissions, subagents,
context compaction, cost accounting, MCP/LSP integration, a Chrome browser bridge, and a skill
system. Version at the time of writing: **0.26.8**.

## Document map

| # | Document | Answers |
|---|---|---|
| 01 | [Product overview](01-product-overview.md) | What is the product, who uses it, what are the features, what do the domain terms mean |
| 02 | [Architecture](02-architecture.md) | Which processes exist, what each module does, how data flows |
| 03 | [Native agent runtime](03-agent-runtime.md) | How a chat turn actually executes: loop, steering, permissions, compaction, retries, subagents |
| 04 | [Tool catalog](04-tool-catalog.md) | Every tool the agent can call, its schema, its permission default, its behavior |
| 05 | [IPC contract](05-ipc-contract.md) | Every IPC channel, every `AgentApi` method, every push event |
| 06 | [Data & storage](06-data-and-storage.md) | Every file written to disk, its format, its lifecycle; `meow.json` reference |
| 07 | [Providers, models & connections](07-providers-and-connections.md) | Provider config, models.dev catalog, variants, limits, Codex OAuth, the cliproxy sidecar, the secret vault |
| 08 | [Integrations](08-integrations.md) | MCP, LSP, Chrome browser bridge + extension, OfficeCLI, remote-control relay |
| 09 | [UI guide](09-ui-guide.md) | Renderer structure, screens, components, theming, performance rules |
| 10 | [Build, test & release](10-build-test-release.md) | Commands, configs, CI, packaging, code signing, platform quirks |
| 11 | [Conventions & pitfalls](11-conventions-and-pitfalls.md) | House rules, the AGENTS.md sync rule, the Superpowers workflow, known traps |

## Suggested reading order by task

| If you are asked to… | Read, in order |
|---|---|
| Understand the product before anything else | 01 → 02 |
| Add or change an IPC call | 05 → 02 → 11 |
| Add a new agent tool | 04 → 03 → 06 (`meow.json` permission block) → 11 |
| Fix agent behavior (looping, truncation, cost, retries) | 03 → 07 → 06 |
| Work on the chat UI | 09 → 05 (`ChatEvent`) → 03 |
| Work on providers / model pickers / OAuth | 07 → 05 → 09 |
| Work on the browser bridge or extension | 08 → 04 (`browser_*` tools) → 02 |
| Package, sign or release | 10 → 11 |
| Debug a Windows-only failure | 11 → 10 → 02 |

## Repository landmarks

```
src/main/                 Electron main process (the only place that spawns processes)
  agent/                  Native Meow agent core (loop, llm, config, sessions, compaction)
    tools/                Tool implementations + registry
    mcp/  lsp/            MCP client manager, LSP client manager
  browser/                Chrome bridge (local WS server + pairing) and Chrome launcher
  connections/            OAuth account management (Codex) + account-scoped local proxy
  remote/                 Remote-control (mobile) relay client, pairing, command dispatch
  officecli/              OfficeCLI binary download/verify manager
src/preload/              contextBridge → window.api (implements AgentApi)
src/renderer/             React 19 UI
src/shared/               Types + IPC contract (no Node/Electron imports allowed)
src/browser-extension/    Chrome MV3 extension (built separately with esbuild)
server/                   Optional self-hosted WebSocket relay for remote control
sidecars/meow-cliproxy/   Go sidecar wrapping CLIProxyAPI for account-scoped Codex proxying
resources/skills/         Bundled skills shipped with the app
tests/                    unit / integration (Vitest) + e2e (Playwright)
docs/                     GitHub Pages landing page, changelogs, specs, plans, this reference
```

## Existing in-repo documentation (complementary)

- `AGENTS.md` at the repo root and one per module directory — short, authoritative, kept in sync
  with the code by an explicit rule. Read the module's `AGENTS.md` before editing that module.
- `README.md` — user-facing overview and credits.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the design spec and implementation plan
  behind nearly every feature, dated `YYYY-MM-DD-slug.md`. The best place to learn *why* something
  was built the way it was.
- `docs/changelogs/` — per-version changelogs; `changelog-format.md` defines the format.
- `docs/protocols/remote-control.md` — the mobile remote-control protocol and relay setup.
- `docs/guides/` — operational guides (Windows code signing, Katalon setup).
