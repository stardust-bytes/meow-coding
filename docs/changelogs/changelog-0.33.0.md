# Changelog — Meow Coding v0.32.0 → v0.33.0

## 🚀 New Features

### Chat composer rearranged — controls to the bottom-right
- The build/plan mode, model, and variant selectors now live in a single footer row at the bottom-right of the chat input card, instead of a mode bar above it.
- The build/plan toggle is now a single dropdown selector (`ModePicker`) rather than two buttons.

### Context readout with hover popover
- The bottom-of-chat context line now shows just the context usage by default.
- Hovering the context readout reveals a popover with session tokens (in/out) and cost.

### Permission/question prompt stays inside the input card
- The permission/question prompt no longer floats over the chat history. It renders in-flow at the top of the chat input card, so the feed is never covered or resized.

## 🐛 Bug Fixes
- Chat: fixed the context hover popover being painted behind the input and clipped by the pane by lifting the composer footer into its own stacking context and opening the popover within the pane.
- Chat: moved the "read-only — edits denied" hint to the left of the mode selector for clearer flow.

## 🧹 Internal & Docs
- Added `ModePicker.tsx`; `Dropdown.tsx` gained an `ariaLabel` prop; `ChatInput.tsx` gained a `promptSlot`.
- Added e2e assertions for prompt-in-card placement, no feed overlay, and the mode dropdown interaction.
- Updated `docs/reference/09-ui-guide.md` and the chat module AGENTS.md.
- Bumped version to 0.33.0.
