# Changelog — Meow Coding v0.26.6 → v0.26.7

## 🚀 New Features

### Provider limits — trust the provider, verify by error
- The agent now resolves each model's real context/output limits from the most reliable source it knows: your override → limits the provider has verified in past errors → the live `/models` endpoint → the catalog → a 128k default, in that order.
- Provider-verified caps are remembered across restarts (`learned-limits.json`) and only ever tighten, so a model that really caps at 64k stops being sent a 384k `max_tokens` on every turn.
- Live `/models` limits are fetched in the background and cached, so resolution never blocks a turn on the network.
- When the provider rejects a request for context overflow, the transcript is compacted and the same step is retried automatically instead of ending the turn.
- The `max_tokens` actually sent is now the verified output limit, kept separate from the reserve the context budget holds for the reply — so a small-context model no longer gets a prompt that fills the window and is then rejected once it starts writing.

### Context knobs — auto-scale + Advanced UI
- Compaction knobs (buffer, keep-tokens, tool-output cap) are now optional: leave them empty and they auto-scale by ratio of the model's context window (15% / 6% / 1.5%, with floors), so a 1M model and a 32k model both get sane defaults without hand-tuning.
- The Context settings tab is reorganized into Basic (max steps, auto-compact, MCP output cap) plus a collapsible Advanced section; empty fields show the auto value for the active agent as a placeholder.
- MCP tool output is capped by a new `mcpOutput.maxTokens` knob (default 25000): oversized results are truncated to a head/tail preview with the full output written to disk, instead of flooding the context.

### Retry feedback
- When a request is retried, the chat shows a transient "Retrying in Xs… (attempt N/M)" line like Claude CLI, so a rate-limited turn no longer looks frozen.

## 🐛 Bug Fixes
- Agent: pressing Stop during a retry backoff or a provider `Retry-After` now stops the turn immediately instead of hanging for the full delay.
- Agent: a huge `Retry-After` header (60s+) is capped at 60s so it can't freeze the turn for minutes.
- Agent: compaction stays alive when the context budget is below buffer + reserve (small-context models), so compact-on-reject still has room to shrink the transcript.

## 🧹 Internal & Docs
- Added design specs and implementation plans for the provider-limits and context-knobs redesigns.
- Synced `AGENTS.md` with the limits service, auto-scaled compaction, MCP output truncation, and the abort-aware retry layer.
- Version bumped to 0.26.7.
