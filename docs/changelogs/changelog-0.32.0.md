# Changelog — Meow Coding v0.31.0 → v0.32.0

## 🚀 New Features

### Personalize tab — app-wide font size
- A new **Personalize** tab in Settings lets you set the app's font size (px) so you can adjust it for your monitor's zoom or scale.
- The size applies directly to `<html>`/`<body>`, scaling the whole UI (sidebar, chat, buttons, settings), and the terminals follow it too.
- The font size persists across restarts; the default is 14px with a range of 8-40px, plus a Reset to default button.
- A `Font size` input field matches the app's other inputs, with −/+ steppers.

## 📱 Mobile Remote Control — Coming Soon
- Work continues on the WS relay, pairing code, and chat sync so a phone can drive a desktop session.
- Stay tuned — the mobile companion is still in the oven 🚧

## 🧹 Internal & Docs
- Added `src/renderer/src/font.ts` shared font-size helpers (mirrors `theme.ts`); wired `applyFontSize`/`watchFontSize` into every renderer entry.
- Updated the design spec, implementation plan, and `docs/reference/09-ui-guide.md` theming section.
- Bumped version to 0.32.0.
