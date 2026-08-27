# AGENTS.md — src/shared

Shared contract between main / preload / renderer.

- `types.ts` — pure data models (Template, Workspace, AgentConfig, AgentState, GitStatus, LogLevel, LogSource, ...).
  JSON-serializable only: **no** classes, no functions, no Node/Electron imports.
- `log-helpers.ts` — pure helpers `formatLogArg`/`safeJson` dùng cho system logger (main + renderer).
- `ipc.ts` — `Channels` (all channel strings) + `AgentApi` (API interface) + event payload types
  (`PtyDataEvent`, `AgentStateEvent`, `GitStatusEvent`).
- `browser-types.ts` — types specific to the browser bridge (pairing, snapshot).
- `text.ts` — pure text helpers (append stream delta, ...).
- `usage.ts` — pure helpers for computing context/token usage.

## Conventions

- **DO NOT** hardcode channel strings elsewhere; only use `Channels`.
- Changing the contract requires updating 4 places in sync: main handler (`src/main/index.ts`), preload
  (`src/preload/index.ts`), renderer (`window.api`), and test `tests/unit/ipc-contract.test.ts`.
- Adding a new push event: add an `Event*` channel + payload interface + subscribe method in `AgentApi`,
  then implement it in preload and forward it in main.
- Files here are used by the main, preload, renderer builds and tests → do not pull in external dependencies.