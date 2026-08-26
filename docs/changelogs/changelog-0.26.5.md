# Changelog — Meow Coding v0.26.4 → v0.26.5

## 🚀 New Features

### Light Mode
- Added a light theme (VSCode Light+ palette) with a Sun/Moon toggle in the sidebar footer menu; the choice persists across restarts.
- Popup windows follow the theme — the Git viewer and File viewer previously stayed dark regardless of the setting.
- Terminal colors and syntax highlighting re-theme live when you switch, with no restart.

### Agent Engine — Context and Reliability
- Tool results from recent turns now reach the model in full instead of being cut to 2000 characters, so a file read or a test run is usable to the agent again; only older turns are trimmed.
- Transient provider failures (rate limits, overload, dropped connections) are retried with backoff instead of ending the turn and losing the work in flight.
- Compaction always has a way out: when the summary call cannot help, the transcript is shrunk without an LLM call rather than sending an over-limit request the provider rejects.
- An answer cut off at the model's output limit is now reported as cut off in the feed instead of appearing as a finished reply.
- Subagents run under the same context budget as the main agent, their token spend is counted in session cost, and Stop cancels background ones.
- Skills added or an `AGENTS.md` edited mid-session take effect on the next turn instead of waiting for a reload.
- The auto-compact threshold now also reserves room for the model's reply, so compaction starts earlier than before (on a 128k model: 108k → 76k).

## 🐛 Bug Fixes
- Context: a pasted image was estimated at ~285k tokens instead of ~1.6k, pinning the session above the compaction threshold and burning a summary call per step.
- Agent: the step limit defaulted to unlimited, so a model stuck in a tool-call loop never wrapped up.
- Sessions: `sessions.json` is written atomically, and an unreadable file is kept as `.corrupt` instead of silently loading as an empty session list.
- Sessions: the store no longer re-reads and re-parses the whole file on every message, which made long sessions progressively slower.
- Compaction: the summary prompt is trimmed to fit the model's own context, so the compaction call itself no longer fails on a long session.
- Compaction: prune thresholds scale with the model's context window instead of being fixed byte counts that treated a 1M model like a 128k one.
- Anthropic: the prompt cache now breaks after the anchored summary instead of on the one-line marker in front of it.
- Providers: an explicit output-token cap is sent, instead of relying on each provider's default.

## 🧹 Internal & Docs
- Core engine audit: 14 findings fixed across three batches, each driven by a failing test first (`npm test`: 876 passing, `npm run typecheck` clean).
- A tool call's permission is decided once per call instead of three times.
- Updated `AGENTS.md` for the theme system, session store, LLM retry, compaction helpers, and token estimation.
- Version bumped to 0.26.5.
