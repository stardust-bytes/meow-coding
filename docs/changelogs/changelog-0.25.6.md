# Changelog — Meow Coding v0.25.5 → v0.25.6

## 🚀 New Features

### Katalon Studio automation via MCP
- Added builtin `katalon-studio` skill: the native Meow agent can create, edit, run and debug Katalon Studio test scripts (Web UI, API, Mobile) through the local Katalon Studio MCP server.
- New `docs/guides/katalon-setup.md` — onboarding for new users: install Katalon Studio ≥ 11.1.0, enable the MCP server, add the server in Settings, run a sample flow.
- The skill follows a capture workflow: navigate → take page source → capture objects into the Object Repository → write test case with `findTestObject` → run → fix → re-run.

## 🐛 Bug Fixes
- Single instance lock: double-clicking the Meow desktop icon while the app is hidden to the tray now brings back the existing running session instead of launching a second background process.

## 🧹 Internal & Docs
- Design spec for the Katalon Studio MCP + skill integration.
- Version bumped to 0.25.6.
