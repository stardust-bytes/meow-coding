# AGENTS.md — src/main/agent

The native "Meow agent" core: the agent loop, LLM integration, config, sessions, permissions,
commands, references, compaction and usage accounting. Orchestrated by `MeowAgentManager` in
`src/main/meow-agent-manager.ts` (which lives one level up).

## Key files

| File | Responsibility |
|---|---|
| `loop.ts` | `SessionRunner`: the agent turn loop — streams LLM output, executes tool calls, handles permissions/aborts, emits `ChatEvent`s. `system` may be a function, re-resolved once per run. The heart of the agent. |
| `llm.ts` | `LlmClient` interface + `createLlm` factory (Anthropic / OpenAI-compatible); `classifyLlmError` + `withRetry` retry a stream that failed before emitting anything; `withCacheBreakpoints` breaks after the anchored summary. |
| `message.ts` | `toLlmMessages`: converts stored transcript (user/assistant/tool items, incl. image parts) into AI-SDK model messages; `keepFullTurns` exempts the recent tail from `toolOutputMaxChars`; `toToolDefinition` wraps tools. |
| `config.ts` | Loads `meow.json` + env; `MeowConfig` / `ResolvedAgentConfig`; `loadMeowConfig`, `resolveAgentConfig`, `settingsToConfig`/`configToSettings`, `writeMeowConfig`; defaults (tokens, compaction, notifications, lsp); `resolveOutputTokens` picks the per-answer output budget (catalog limit, hard cap, half-context guard, fallback `maxOutputTokens`). |
| `session.ts` | `SessionStore`: persists sessions + transcript items to `sessions.json` (normalized once, then cached); `flush()` forces debounced writes; create/list/switch/delete/rename; title inference. |
| `permission.ts` | Permission rules (allow/ask/deny) + matcher used by `decidePermission`. |
| `commands.ts` | Slash commands: built-ins (init/review/sp-*) + user store (`commands.json`) + `resolveCommand`/`expandReferences`-aware templates. |
| `references.ts` | `expandReferences`: expands `@path` / `@"path with space"` mentions into file contents appended to the prompt. |
| `snapshot.ts` | `SnapshotStore`: per-turn file snapshots for undo/redo. |
| `saved-permissions.ts` | Persists "always allow" tool permissions (`permissions.json`). |
| `compact.ts` | Context compaction: `usableContextTokens` (buffer + output reserve), `truncateToolOutput`, `fitHeadToBudget` (keeps the summary prompt inside the window), `hardTruncate` (last-resort shrink when LLM compaction cannot help). |
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
