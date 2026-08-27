# Provider-Driven max_tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Meow Coding omit `max_tokens` by default (provider decides, like Claude Code/opencode), while keeping an explicit `maxOutputTokens` override for users who want to force a cap.

**Architecture:** Revert the previous default of always sending `DEFAULT_MAX_OUTPUT_TOKENS` (32000). `maxOutputTokens` becomes `undefined` unless the user sets it, so `LimitsService.resolveLimits()` returns `output: null` and `llm.ts` omits `max_tokens`. `DEFAULT_MAX_OUTPUT_TOKENS` stays as the fallback for the compaction reserve only.

**Tech Stack:** Electron 41 · electron-vite 5 · React 19 · TypeScript strict · Vitest (unit).

## Global Constraints

- **TypeScript strict** — `npm run typecheck` (4× tsc) must pass after each task.
- **`npm test` must pass after each task.** `npm test` = `vitest run --passWithNoTests`.
- **TDD:** write the failing test first → run to see FAIL → implement minimal → run to see PASS → commit.
- **Docs sync rule:** update `AGENTS.md` and `docs/reference/` in the same commit when behavior they describe changes.
- **Do not change** `resolveOutputTokens`, learned-limits, or the Settings UI in this plan.

---

### Task 1: Revert default maxOutputTokens to omit

**Files:**
- Modify: `src/main/agent/config.ts` (DEFAULT_MEOW_CONFIG ~line 165; mergeDefaults ~line 323)
- Test: `tests/unit/agent-config.test.ts` (~line 348)
- Docs: `docs/reference/06-data-and-storage.md` (~line 110), `docs/reference/03-agent-runtime.md` (~line 328), `src/main/agent/AGENTS.md` (config.ts row)

**Interfaces:**
- Consumes: `DEFAULT_MAX_OUTPUT_TOKENS` (still exported from `config.ts`, value 32000).
- Produces: `loadMeowConfig(file)` returns `maxOutputTokens === undefined` when not set; `DEFAULT_MEOW_CONFIG.maxOutputTokens` is `undefined`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/agent-config.test.ts`, revert the `defaults to auto limits` assertion:

```ts
it('defaults to auto limits and token-based compaction settings', () => {
  const cfg = loadMeowConfig(file)
  expect(cfg.maxContextTokens).toBeUndefined()
  expect(cfg.maxOutputTokens).toBeUndefined()
  expect(cfg.maxSteps).toBe(100)
  ...
})
```

Also remove the now-unused `DEFAULT_MAX_OUTPUT_TOKENS` import from the import block at the top of the file (added in the previous change).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: FAIL — `cfg.maxOutputTokens` is `32000`, not `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/agent/config.ts`:

Remove the line from `DEFAULT_MEOW_CONFIG`:
```ts
  mcp: {},
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,   // DELETE this line
  maxSteps: DEFAULT_MAX_STEPS,
```

Change `mergeDefaults`:
```ts
    maxContextTokens: raw.maxContextTokens,
    maxOutputTokens: raw.maxOutputTokens,   // was: raw.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    maxSteps: raw.maxSteps ?? DEFAULT_MAX_STEPS,
```

Keep `export const DEFAULT_MAX_OUTPUT_TOKENS = 32000` — it is still used by `resolveOutputTokens`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full checks**

Run: `npm test` and `npm run typecheck`
Expected: both pass.

- [ ] **Step 6: Update docs**

- `docs/reference/06-data-and-storage.md` (~line 110): change the `maxOutputTokens` comment back to
  `// optional override; absent = omit max_tokens (provider decides)`.
- `docs/reference/03-agent-runtime.md` (~line 328): revert the added paragraph about the 32000 default
  so it reads that `maxOutputTokens` is an optional override and absent means `output: null` (omit).
- `src/main/agent/AGENTS.md` (config.ts row): revert the sentence about `maxOutputTokens` defaulting to
  `DEFAULT_MAX_OUTPUT_TOKENS`; describe it as an optional override, absent = omit.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/config.ts tests/unit/agent-config.test.ts docs/reference/06-data-and-storage.md docs/reference/03-agent-runtime.md src/main/agent/AGENTS.md
git commit -m "feat(agent): omit max_tokens by default, keep explicit override"
```
