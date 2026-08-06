# AGENTS.md — tests/unit

Vitest unit + integration tests (node environment). One test file per module, covering the main
process logic, shared contract, and pure renderer helpers. Run with `npm test` (or `npx vitest run
tests/unit/<file>` for one file).

## Conventions

- **Never** call a real LLM API — agent tests use a stub `LlmClient` (`makeManager` in
  `meow-agent-manager.test.ts`) or `partsQueue` to script outputs.
- `ipc-contract.test.ts` guards the contract: every `AgentApi` method must exist, every channel
  string is asserted. **Update it whenever the IPC contract changes.**
- Keep tests hermetic: temp dirs via `mkdtempSync(tmpdir())` + cleanup in `afterEach`/`finally`.
- Prefer testing observable behavior (events emitted, store contents) over internals.
