# AGENTS.md — tests

- `unit/` — test logic thuần (Vitest, environment `node`). Một file cho một module: `<name>.test.ts`.
- `integration/` — test PTY thật (chạy trên ConPTY Windows): `pty-manager.test.ts`.
- `e2e/` — Playwright cho Electron, smoke test mở app.
- `fixtures/` — fake CLI (`echo-agent.js`) để spawn thay agent thật khi cần.

## Quy ước

- Unit/integration test **không** phụ thuộc agent thật (opencode/claude/aider); dùng fixture hoặc
  lệnh `node` + fixture.
- Integration test spawn PTY thật → phải stop/cleanup trong `afterEach`/`finally` để không để lại
  process mồ côi. Ví dụ trong `tests/integration/pty-manager.test.ts`.
- Alias `@shared` đã cấu hình trong `vitest.config.ts`; import code main bằng đường dẫn tương đối.
- Chạy: `npm test` (unit + integration). E2E cần build trước: `npm run build && npm run e2e`
  (Playwright config trong `playwright.config.ts`, workers = 1).
