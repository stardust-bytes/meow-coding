# AGENTS.md — src/main/agent

The native "Meow agent" core: the agent loop, LLM integration, config, sessions, permissions,
commands, references, compaction and usage accounting. Orchestrated by `MeowAgentManager` in
`src/main/meow-agent-manager.ts` (which lives one level up).

## Key files

| File | Responsibility |
|---|---|
| `loop.ts` | `SessionRunner`: the agent turn loop — streams LLM output, executes tool calls, handles permissions/aborts, emits `ChatEvent`s. `system` may be a function, re-resolved once per run. The heart of the agent. |
| `llm.ts` | `LlmClient` interface + `createLlm` factory (Anthropic / OpenAI-compatible); `classifyLlmError` + `withRetry` retry a stream that failed before emitting anything, and `reduceBudgetForMaxTokensError` re-runs with a smaller budget when the provider rejects `max_tokens` (catalog overstates the model's real output limit), firing `onReducedBudget(realLimit)` so the learned-limits store can remember it; `withCacheBreakpoints` breaks after the anchored summary. |
| `message.ts` | `toLlmMessages`: converts stored transcript (user/assistant/tool items, incl. image parts) into AI-SDK model messages; `keepFullTurns` exempts the recent tail from `toolOutputMaxChars`; `toToolDefinition` wraps tools. |
| `config.ts` | Loads `meow.json` + env; `MeowConfig` / `ResolvedAgentConfig`; `loadMeowConfig`, `resolveAgentConfig`, `settingsToConfig`/`configToSettings`, `writeMeowConfig`; defaults (tokens, compaction, notifications, lsp); `resolveOutputTokens` picks the per-answer output **reserve** (catalog/live/learned limit, hard cap, half-context guard, fallback `DEFAULT_MAX_OUTPUT_TOKENS`) — `maxContextTokens`/`maxOutputTokens` are optional overrides resolved by `LimitsService`. |
| `session.ts` | `SessionStore`: persists sessions + transcript items to `sessions.json` (normalized once, then cached); `flush()` forces debounced writes; create/list/switch/delete/rename; title inference. |
| `permission.ts` | Permission rules (allow/ask/deny) + matcher used by `decidePermission`; `ToolPermissionContext` + `decide` gate every tool call, and `deriveSubagentContext` narrows the parent's context for a subagent (deny > ask > allow, no prompting in background). |
| `subagent-roles.ts` | Subagent role discovery: `.meow/agents/*.md` (project) → user dir → built-ins, first-wins by name; frontmatter (`name`, `description`, `tools`, `model`, `deny`, `ask`) can only narrow permissions — there is no `allow` key. |
| `commands.ts` | Slash commands: built-ins (init/review/sp-*) + user store (`commands.json`) + `resolveCommand`/`expandReferences`-aware templates. |
| `references.ts` | `expandReferences`: expands `@path` / `@"path with space"` mentions into file contents appended to the prompt. |
| `snapshot.ts` | `SnapshotStore`: per-turn file snapshots for undo/redo. |
| `saved-permissions.ts` | Persists "always allow" tool permissions (`permissions.json`). |
| `compact.ts` | Context compaction: `usableContextTokens` (buffer + output reserve), `truncateToolOutput`, `fitHeadToBudget` (keeps the summary prompt inside the window), `hardTruncate` (last-resort shrink when LLM compaction cannot help). |
| `limits.ts` | `LimitsService.resolveLimits` merges override → learned → live `/models` → catalog → 128k default into `{ context, output: number \| null }` (output null = omit `max_tokens`); `parseLiveModelsInfo`, `matchModel`, `classifyContextOverflowError`, `parseContextLimitFromError`; live fetch is background, cached per `baseUrl\|apiKey` with `LIVE_MODELS_TTL_MS`. |
| `learned-limits.ts` | `LearnedLimitsStore`: provider-verified caps persisted to `userData/learned-limits.json`, keyed `baseUrl\|model`; `recordMaxTokensLimit` / `recordContextOverflow` only ever tighten, never raise. |
| `truncation.ts` | `TruncationStore`: truncation state per session. |
| `usage.ts` | `calcCost` / `EMPTY_USAGE` / price-based cost accounting. |
| `token.ts` | Token estimation/counting helpers (`estimateTokens`, `estimateUsage`, `charsForTokens`); inline image data URLs are charged a flat cost, not their base64 length. |
| `trace-store.ts` | `TraceStore`: per-session trace event log (buffered + flushed async, seq per session). |
| `apply-patch.ts` | Unified-diff parser + applier (the `apply-patch` tool backend). |
| `plugin.ts` | Loads user tools from `userData/tools`. |
| `skill.ts` | Collects skills (builtin + user) into `skillListText` for the system prompt. |
| `instructions.ts` | Loads `AGENTS.md`-style instructions into the system prompt. |
| `tools/` `lsp/` `mcp/` | Tool implementations and service clients — see their own AGENTS.md. |

## Conventions

- All agent logic lives in the **main process**; the renderer only sees `ChatEvent`s over IPC.
- Tests use a **model stub** (`createLlm` fake) — never hit a real LLM API (see `tests/unit/agent-loop.test.ts`).
- New tools: implement in `tools/`, register in `tools/registry.ts`, add permission default in `config.ts`.
- Session transcript items are the single source of truth for what the LLM sees (`message.ts` rebuilds prompts from them).
