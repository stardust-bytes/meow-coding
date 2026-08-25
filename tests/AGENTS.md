# AGENTS.md — tests

- `unit/` — pure logic tests (Vitest, `node` environment). One file per module: `<name>.test.ts`.
- `integration/` — real integration tests: `pty-manager.test.ts` (ConPTY), `agent-stream-overlap.test.ts`,
  `browser/bridge-flow.test.ts`.
- `e2e/` — Playwright for Electron, smoke test that launches the app.
- `fixtures/` — fake CLI (`echo-agent.js`) spawned in place of a real agent + `mock-lsp-server.js`.

## Conventions

- Unit/integration tests **do not** depend on a real agent (opencode/claude/aider); use a fixture or
  a `node` command + fixture.
- Integration tests spawn a real PTY → must stop/cleanup in `afterEach`/`finally` to avoid leaving
  orphan processes. See `tests/integration/pty-manager.test.ts` for an example.
- The `@shared` alias is configured in `vitest.config.ts`; import main code via relative paths.
- Run: `npm test` (unit + integration). E2E requires a build first: `npm run build && npm run e2e`
  (Playwright config in `playwright.config.ts`, workers = 1).