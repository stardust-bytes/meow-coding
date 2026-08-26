# Changelog — Meow Coding v0.26.2 → v0.26.3

## 🚀 New Features

### Codex-Style Chat Scroll
- A newly submitted user turn anchors at a stable 20px reading position near the top of the chat feed instead of jumping to the bottom.
- Streaming responses, tool calls, sub-agent and status content follow the viewport only while the app owns scrolling; the shrinking tail keeps a short response readable below the anchored turn.
- Any deliberate wheel, touch, keyboard or scrollbar interaction immediately hands control to the user; following resumes from the 80px bottom zone or via the "Scroll to end" button.
- Opening or switching sessions restores the transcript to its true end instantly; reduced-motion mode skips animated transitions.

## 🧹 Internal & Docs
- Added deterministic unit tests for the scroll geometry/state contract and Electron E2E coverage for anchoring, follow, manual takeover, resume and session restoration.
- Added the design spec and implementation plan for the codex-style chat scroll work.
- Version bumped to 0.26.3.
