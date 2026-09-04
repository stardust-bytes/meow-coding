# Changelog — Meow Coding v0.30.1 → v0.31.0

## 🚀 New Features

### Collapsible prompt (question/permission) box
- The prompt box at the bottom of the chat composer now has a header with a collapse toggle, so a long question with many options no longer dominates the composer.
- Collapsing keeps a one-line summary — the question text, or the pending tool permission — while the agent is still waiting for your answer.
- The expanded/collapsed state resets when a new prompt arrives, when you respond, and on view reset.

## 📱 Mobile Remote Control — Coming Soon
- Work continues on the WS relay, pairing code, and chat sync so a phone can drive a desktop session.
- Stay tuned — the mobile companion is still in the oven 🚧

## 🧹 Internal & Docs
- Bumped version to 0.31.0.
- Synced `src/renderer/src/components/chat/AGENTS.md` with the prompt-box behavior.
