# Changelog — Meow Coding v0.28.1 → v0.29.0

## 🚀 New Features

### Full harness system prompt for the native agent
- A structured system prompt builder now injects a per-turn `turnContext` reminder that keeps the agent grounded in the current project, mode, working directory, and available memory.
- The harness refreshes context at turn start (environment snapshot) and attaches a git-freshness reminder after relevant tool results, so the agent sees the real repo state.
- Per-project memory store with rules and helpers lets each project carry persistent agent notes; memory can be disabled per agent (`memory: false`).
- The harness builder, env snapshot, and memory are wired into agent registration for both parent and subagent runners.

### Tool-calling loop improvements
- Truncated answers (hit `max_tokens` / max steps) are now resumed instead of silently dropped, and refusals are reported distinctly from a normal done.
- Structured tool error formatting keeps partial output and surfaces a real cause (provider/refusal) instead of a generic "produced no answer".
- Subagent failures now propagate the actual LLM error to the parent and to the chat panel, instead of a bare `state: 'error'`.
- The truncation-resume nudge is kept out of the chat feed so the user only sees the final answer.

## 🐛 Bug Fixes
- A failed tool-result reminder no longer errors a call that already succeeded.
- The resume-cap scope is clarified and error-text partial output is gated so a subagent error doesn't leak partial text as a real answer.
- Subagent background results now deliver the real error to `onBackgroundResult` and the panel done event.

## 🧹 Internal & Docs
- Added design specs and implementation plans for the harness system prompt, per-project memory, the tool-calling loop improvements, and the agent hooks system (PreToolUse/PostToolUse/Stop).
- Documented SemVer versioning rules for releases in the release checklist.
- Bumped version to 0.29.0.
