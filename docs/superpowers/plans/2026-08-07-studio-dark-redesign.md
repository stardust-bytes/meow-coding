# Meow Coding — Studio Dark: Instrument Panel — Plan

**Goal:** Redesign toàn app sang Studio Dark theo spec `docs/superpowers/specs/2026-08-07-studio-dark-redesign-design.md`.
Giữ nguyên class name / logic component; chỉ đổi style + font + theme terminal.

**Phạm vi:** `package.json`, `src/renderer/src/main.tsx`, `src/renderer/src/styles.css`,
`src/renderer/src/components/XtermHost.tsx`.

---

## Task 1: Fonts
- [ ] `npm i @fontsource-variable/instrument-sans @fontsource-variable/bricolage-grotesque`.
- [ ] `main.tsx` import 2 font CSS.

## Task 2: styles.css — Tokens + base + atmosphere
- [ ] `:root`: typography (display/ui/mono), palette mới, radius, hairline.
- [ ] Base: `*` radius, body bg + color + font-ui, focus-visible, scrollbar.
- [ ] `body::before` noise/grain overlay + vignette.

## Task 3: styles.css — Shell (title bar, sidebar, panes, status bar, dialogs)
- [ ] Title bar: hairline bottom, brand display font, nút điều khiển hover đỏ.
- [ ] Sidebar: surface, active row accent left-bar + lime dot, panel-title display font.
- [ ] Pane grid + pane: radius-lg, shadow, hairline; pane-header active accent top + raised bg;
      status-dot pill accent theo trạng thái; git/status mono.
- [ ] Background panel, badge.
- [ ] Status bar: dark graphite, brand dot accent, text dim.
- [ ] Buttons & inputs: radius, hover glow, primary lime.
- [ ] Dialogs: radius-lg, shadow sâu, backdrop blur.
- [ ] Menus (sidebar/pane/project dropdown), templates, empty state.

## Task 4: styles.css — Chat (feed, todos, composer, prompts, menus)
- [ ] Chat panel bg + feed padding, bubbles (assistant/user) radius.
- [ ] Todos: accent card + progress indicator + fixed header (giữ từ commit trước).
- [ ] Session bar, history actions, subagent card, tool-call card.
- [ ] Composer: raised surface, focus-within accent glow; attach lime; stop red; chips radius.
- [ ] Prompt (permission/question), options, kbd.
- [ ] Command menu + model picker: raised surface, shadow, selected accent.
- [ ] Context footer mono.

## Task 5: styles.css — Settings + markdown + diff + reasoning
- [ ] Settings dialog/nav/content, providers, MCP, commands, permissions tabs.
- [ ] Markdown content (code, pre, blockquote, table), diff view, reasoning.

## Task 6: XtermHost theme
- [ ] Đổi theme màu terminal sang palette Studio Dark (bg #0c0f0d, foreground #d6ddd6, cursor, ANSI).

## Task 7: verify
- [ ] `npm run typecheck` PASS.
- [ ] `npm test` PASS.
- [ ] `npm run build && npm run e2e` PASS.
