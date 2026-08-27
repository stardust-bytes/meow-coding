# Provider-Driven max_tokens — Design Spec

> **Status:** approved

## Goal

Make Meow Coding behave like Claude Code and opencode for output token limits: by default **omit**
`max_tokens` and let the provider decide. Users who want to force a cap can set `maxOutputTokens`
in Settings (an explicit override). This replaces the previous default of always sending
`DEFAULT_MAX_OUTPUT_TOKENS` (32000) that was added to work around Ollama Cloud's low default.

## Background

- `LimitsService.resolveLimits()` returns `{ context, output: number | null }` with precedence
  overrides → learned → live `/models` → catalog → `null`.
- `output: null` → `llm.ts` omits `max_tokens` entirely (provider chooses).
- `output: number` → sent as `max_tokens`.
- A previous change set `maxOutputTokens` to default `DEFAULT_MAX_OUTPUT_TOKENS` (32000) in
  `DEFAULT_MEOW_CONFIG` and `mergeDefaults`, so every request sent `max_tokens: 32000`. This spec
  reverts that so the default is again "omit".

## Decisions

1. **Default = omit.** `maxOutputTokens` is `undefined` unless the user sets it. `resolveLimits()`
   then returns `output: null` and `max_tokens` is omitted.
2. **Override = explicit.** Setting `maxOutputTokens` in `meow.json` / Settings sends that value as
   `max_tokens`.
3. **Keep `DEFAULT_MAX_OUTPUT_TOKENS` (32000)** as the fallback for the *compaction reserve* only
   (`resolveOutputTokens`), never sent to the provider.
4. **Keep learned-limits self-healing** unchanged (provider rejects `max_tokens` → learn real cap →
   send it next turn).
5. **No UI change** in this spec. The Settings field already exists; leaving it empty = provider
   decides. (UI hint is a possible follow-up, out of scope.)

## Behavior matrix

| User setting | `maxOutputTokens` | `resolveLimits().output` | Sent to provider |
|---|---|---|---|
| not set | `undefined` | `null` | omit `max_tokens` |
| set to 32000 | `32000` | `32000` | `max_tokens: 32000` |

## Code changes

### `src/main/agent/config.ts`
- Remove `maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS` from `DEFAULT_MEOW_CONFIG`.
- In `mergeDefaults`, change `maxOutputTokens: raw.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS`
  back to `maxOutputTokens: raw.maxOutputTokens`.
- Keep `DEFAULT_MAX_OUTPUT_TOKENS = 32000` (used by `resolveOutputTokens` for the reserve).

### `tests/unit/agent-config.test.ts`
- Revert the `defaults to auto limits` assertion:
  `expect(cfg.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)` → `toBeUndefined()`.
- Remove the `DEFAULT_MAX_OUTPUT_TOKENS` import if no longer referenced.

### Docs
- Revert `docs/reference/06-data-and-storage.md` and `docs/reference/03-agent-runtime.md` and
  `src/main/agent/AGENTS.md` to describe `maxOutputTokens` as an optional override; absent = omit.

## Out of scope
- UI hint/placeholder in Settings (possible follow-up).
- Changing learned-limits behavior.
- Changing `resolveOutputTokens` / compaction reserve logic.

## Success criteria
- `npm run typecheck` passes.
- `npm test` passes.
- With no `maxOutputTokens` set, `loadMeowConfig` returns `maxOutputTokens === undefined` and
  `resolveLimits` returns `output: null` (max_tokens omitted).
- With `maxOutputTokens` set, the value is preserved and sent.
