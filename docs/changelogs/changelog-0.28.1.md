# Changelog — Meow Coding v0.28.0 → v0.28.1

## 🚀 New Features

### LLM retries recover from network/API outages
- Network errors (ECONNRESET, etc.) and server 5xx errors now retry indefinitely (like Claude CLI) until the network/API recovers or the user stops the turn.
- Rate limits (408/409/425/429) retry up to 10 attempts, then surface the error to the user.
- The retry indicator now shows "waiting for the network/API to recover" for unbounded retries.

### Notification "needs input" jumps to the waiting agent
- Clicking the OS "Input needed" notification switches to the correct project and activates the tab of the agent waiting for a reply/approval, even when several projects/agents are running.
- The sidebar project list now shows a red badge with the count of agents awaiting your reply/approval per project (plus a small dot on the collapsed-rail avatar).

## 🐛 Bug Fixes
- Context settings: edits made while a save was in flight are no longer overwritten by the older save result — the settings UI now keeps the latest changes.
- Provider type (e.g. DeepSeek) is preserved across reload/save, so provider-specific LLM handling and the provider edit form show the stored value correctly.
- Notifications: a fresh "needs input" notification is no longer suppressed by a recent "done" notification for the same agent (throttle is now per agent × kind).

## 🧹 Internal & Docs
- Bumped version to 0.28.1.
- Synced `docs/reference/` and the module `AGENTS.md` files with the notification, provider-save and context-save changes.
