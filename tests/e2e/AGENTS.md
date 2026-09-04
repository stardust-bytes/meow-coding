# AGENTS.md — tests/e2e

Playwright end-to-end smoke tests that launch the real Electron app (`_electron.launch({ args: ['.'] })`)
with a temp `MEOW_USER_DATA`. Run after `npm run build` via `npm run e2e`; single file:
`npx playwright test tests/e2e/<file>.spec.ts`.

## Key files

| File | Responsibility |
|---|---|
| `smoke.spec.ts` | App launches, sidebar/status-bar (incl. version), native chat panel sends a message, mode selector toggles build/plan, settings connects a provider + syncs models. |
| `prompt.spec.ts` | Permission prompt: click allow, keyboard `1`, prompt spans pane width, prompt overlays the feed without changing its height. |
| `context-footer.spec.ts` | Context footer shows real token usage, persists across reload, resets on new session; danger state past auto-compact threshold. |
| `chat-scrollbar.spec.ts` | Chat feed scrollbar reflects the full transcript (no content-visibility collapse). |
| `trace-panel.spec.ts` | Trace panel shows agent trace events. |

## Conventions

- Each test uses an isolated temp userData + temp project; writes `workspaces.json` directly.
- **Requires `npm run build` first** — e2e launches the built app in `out/`.
- Use locator auto-wait (e.g. `toHaveText`/`toContainText`) for async UI (IPC round-trips, streaming).
- After touching IPC/UI, add/extend a smoke assertion so regressions are caught here.
