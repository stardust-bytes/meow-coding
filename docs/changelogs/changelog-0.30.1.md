# Changelog — Meow Coding v0.30.0 → v0.30.1

## 🐛 Bug Fixes
- Chat: LLM errors that come back as a bare structured object (e.g. an OpenAI-compatible SSE error chunk like `{ message, type, code }`, as returned by a gateway returning `RATE_LIMIT`) now render readably as `message (type code)` instead of the useless `[object Object]`. Native `Error`s and objects with a custom `toString` keep their existing formatting.

## 🧹 Internal & Docs
- Bumped version to 0.30.1.
- Synced `src/main/agent/AGENTS.md` with the updated `formatLlmError` behavior.
- CI: checkout the repo in the publish job so the changelog file is available when creating the GitHub Release.
