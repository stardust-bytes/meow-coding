# AGENTS.md

Meow Coding — desktop app (Electron + React) that manages multiple CLI coding agents (opencode, Claude Code,
aider, ...) running in parallel across terminal panes within a single window.

## Technology

- Electron 41 + electron-vite 5 + React 19 + TypeScript (strict).
- PTY: `@lydell/node-pty`; terminal UI: `@xterm/xterm` + `@xterm/addon-fit`.
- Test: Vitest (unit + integration), Playwright (e2e).

## Structure

3 separate processes, communicating via a centralized IPC contract:

- `src/main` — main process: PTY, stores, services, IPC handlers, app lifecycle.
- `src/preload` — contextBridge, expose `window.api` (implement `AgentApi`).
- `src/renderer` — React UI: sidebar, pane grid, xterm + native-agent chat.
- `src/shared` — shared types + IPC contract. **DO NOT** import Node/Electron here.
- `src/browser-extension` — Chrome MV3 extension (built separately with esbuild → `out/browser-extension`,
  copy to `userData/browser-extension/` to Load unpacked on a real Chrome profile).
- `src/main/browser` — BrowserBridge (local WS server + pairing code) + Chrome launcher/install guide.

Alias `@shared` → `src/shared` (configured in electron.vite.config.ts, vitest.config.ts, tsconfig).

## Commands

- `npm run dev` — run dev (electron-vite; pre-hook auto-builds the extension).
- `npm run build` / `npm run start` — build / preview (pre-hook auto-builds the extension).
- `npm test` — unit + integration (Vitest).
- `npm run typecheck` — tsc node + web + extension.
- `npm run build:extension` — build Chrome extension (esbuild → `out/browser-extension`).
- `npm run e2e` — Playwright smoke (requires `npm run build` first).
- `npm run dist` / `dist:dir` / `dist:linux` / `dist:mac` — package via electron-builder.
- `npm run regen:models` — regenerate `src/main/models-snapshot.json`.

## Windows setup

- After `npm install`, if missing native binding for node-pty:
  `npx @electron/rebuild -f -w @lydell/node-pty`.
- node-pty uses prebuilds; do not modify node-pty code directly.
- On Windows (ConPTY), non-`.exe` commands (opencode, claude, ... are just `.cmd` shims) must be wrapped
  through `cmd.exe` — see `buildSpawnCommand` in `src/main/pty-manager.ts`. Do not break this logic.

## Conventions

- IPC: **do not hardcode** channel strings; only use `Channels` from `src/shared/ipc.ts`.
- Persistent data: `userData/templates.json`, `userData/workspaces.json`; per-agent logs in
  `userData/logs/<agentId>.log`.
- Only the main process may spawn/kill processes; the renderer accesses everything via `window.api`.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. Do not expose
  `ipcRenderer` to the window.
- Language: source code + UI labels in English; system-style notifications from main use Vietnamese, prefixed
  with `[meow]`.
- Do not add unnecessary comments; only comment when explaining a complex decision (e.g. Windows shim, tree-kill).
- Agent exits must be handled: kill the entire process tree (`tree-kill`), no orphan processes.
- Browser bridge: only bind `127.0.0.1` (do not expose to the network), pairing code required before accepting
  commands; runs on the user's **real** Chrome profile — do not create a separate profile per project.
- Custom subagent roles live in `.meow/agents/*.md` (project) or `userData/agents/*.md` (user);
  frontmatter takes `name`, `description`, `tools`, `model`, `deny`, `ask`. There is no `allow` key —
  a role file can only narrow what the user's own permission rules already grant.

## Required testing before completion

- `npm run typecheck` passes.
- `npm test` passes.
- If affecting e2e: `npm run build && npm run e2e`.

## Docs

- `docs/reference` — full system reference for agents/LLMs (product, architecture, agent runtime, tools,
  IPC, storage, providers, integrations, UI, build/release, conventions). Start at `docs/reference/README.md`.
- `docs/superpowers/specs` — design specs; `docs/superpowers/plans` — implementation plans.
- `docs/changelogs/changelog-format.md` — changelog format between versions (reused each release).
- Workflow: brainstorm → spec → plan → execute (details in existing docs).

## AGENTS.md — Documentation Sync Rule

Each module directory has an `AGENTS.md` file describing its purpose, status, key files, API endpoints, dependencies, and TODOs. A sibling `CLAUDE.md` only contains `@AGENTS.md` (Claude Code import syntax).

**ALWAYS** update `AGENTS.md` when any of the following changes occur:
- New or changed business logic (endpoints, service methods, DTOs)
- File structure changes (adding/removing/renaming key files)
- Status changes (SKELETON → PARTIAL → IMPLEMENTED)
- New or changed dependencies (entities, modules, packages)
- TODOs completed or new TODOs to add

Principle: **Code changes → AGENTS.md updated before commit.**

When updating any `AGENTS.md` file:
- **ONLY** modify the entries that reflect the code, structure, status, dependency, endpoint, or TODO items that were actually changed or newly added.
- **DO NOT** rewrite the whole file, **DO NOT** "clean up" unrelated sections, and **DO NOT** change wording just because you prefer different phrasing when the current meaning is still correct.
- **DO NOT** change the existing file format on your own, including heading levels, section order, bullet style, checkbox style, tables, label conventions, indentation, line spacing, and the presentation conventions already used in that specific file.
- If new information must be added, insert it into the correct section using the existing format instead of restructuring the whole file.
- If an existing entry is not affected by the code change, leave it unchanged.
- If the current format seems imperfect but is still consistent, **prefer preserving it**; only adjust formatting when the user explicitly asks for that specific file.