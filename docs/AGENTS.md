# AGENTS.md — docs

Documentation following the Superpowers workflow.

- `superpowers/brainstorms/` — brainstorm session notes.
- `superpowers/specs/` — design specs: goals, decisions, scope, architecture, data flow, error
  handling, testing, success criteria. Written **before** code.
- `superpowers/plans/` — step-by-step implementation plans, guiding from spec to execution.
- `superpowers/notes/` — technical notes / ad-hoc decisions.
- `reference/` — full system reference for agents/LLMs: product, architecture, agent runtime, tools,
  IPC, storage, providers, integrations, UI, build/release, conventions. Start at `reference/README.md`.

## Conventions

- File naming: `YYYY-MM-DD-slug.md` (e.g. `2026-08-04-meow-coding-agent-console.md`).
- First line states the status (e.g. `Status: pending review`).
- Process: brainstorm → spec → plan → execute. Update spec/plan when decisions change.
- When writing a new spec/plan, refer to existing specs/plans to keep the format consistent.