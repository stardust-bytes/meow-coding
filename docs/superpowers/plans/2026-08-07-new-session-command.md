# Meow Coding — `/new` command (new session) — Plan

**Goal:** `/new` trong chat native agent tạo session mới (dừng turn, reset view, reload session list),
không gửi prompt cho LLM. Theo spec `docs/superpowers/specs/2026-08-07-new-session-command-design.md`.

**Phạm vi:** `src/shared/types.ts`, `src/main/agent/commands.ts`, `src/main/meow-agent-manager.ts`,
`src/renderer/src/components/chat/ChatPanel.tsx`, `tests/unit/meow-agent-manager.test.ts`.

---

## Task 1: shared/types.ts
- [ ] `Command` thêm `type?: 'prompt' | 'system'` (optional, mặc định prompt).
- [ ] `ChatEvent` thêm `| { type: 'session-created'; agentId: string }`.

## Task 2: commands.ts
- [ ] Thêm `NEW_COMMAND` (`name: 'new'`, description, `template: ''`, `type: 'system'`).
- [ ] Thêm vào builtin list trong `CommandStore` constructor.

## Task 3: meow-agent-manager.ts
- [ ] `runCommand`: sau khi tìm được command, nếu `type === 'system'` → dispatch (hiện chỉ `new`:
      `this.newSession(agentId)` + `emit({ type: 'session-created', agentId })`), return sớm trước
      `resolveCommand`.

## Task 4: ChatPanel.tsx
- [ ] `applyEvent`: thêm nhánh `if (e.type === 'session-created') { resetView(); reloadSessions(); return }`
      (đặt trước nhánh fallback `setItems`), thêm `resetView`/`reloadSessions` vào deps.

## Task 5: test
- [ ] `meow-agent-manager.test.ts`: test `runCommand('a1', 'new', [])` → session mới khác session cũ,
      emit `session-created`, **không** gọi LLM (`createLlm` không được gọi), không có `done` event.

## Task 6: verify
- [ ] `npm run typecheck` PASS.
- [ ] `npm test` PASS.
