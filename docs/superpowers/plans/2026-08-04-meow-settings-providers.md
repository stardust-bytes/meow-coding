# Meow Settings — Provider API Keys UI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** UI nhập API key nhiều provider (Anthropic/OpenAI/DeepSeek/local) + chọn default; lưu meow.json; áp dụng ngay.

**Spec:** `docs/superpowers/specs/2026-08-04-meow-settings-providers-design.md`

**TDD:** failing test trước → implement → pass → typecheck → commit từng task.

---

## Task 1: Shared types + IPC contract

- [ ] `src/shared/types.ts`: thêm `ProviderSettings`, `MeowSettings`.
- [ ] `tests/unit/ipc-contract.test.ts`: thêm method `getSettings`, `saveSettings` + channel `settings:get`, `settings:save` + type test. Run fail.
- [ ] `src/shared/ipc.ts`: thêm `Channels.SettingsGet`, `Channels.SettingsSave`; `AgentApi` thêm 2 method.
- [ ] Pass test + typecheck. Commit: `feat: settings ipc contract`.

## Task 2: config round-trip + write

- [ ] `tests/unit/agent-config.test.ts`: tests cho `configToSettings`, `settingsToConfig`, `writeMeowConfig`:
  - round-trip giữ providers/default; apiKey rỗng → apiKeyEnv `{ID}_API_KEY`; providers rỗng → DEFAULT;
  - merge giữ agents/permission từ config cũ; write file thật (temp dir) đọc lại được. Run fail.
- [ ] `src/main/agent/config.ts`: `configToSettings`, `settingsToConfig(s, base?)`, `writeMeowConfig`.
- [ ] Pass + typecheck. Commit: `feat: agent settings config mapping`.

## Task 3: MeowAgentManager getSettings/saveSettings/reload

- [ ] `tests/unit/meow-agent-manager.test.ts`: 
  - `getSettings` trả về providers mặc định (anthropic/openai) + default;
  - `saveSettings` ghi file + `reload()` khiến resolved apiKey mới được dùng (gọi llm với key mới);
  - reload không làm mất agents. Run fail.
- [ ] `src/main/meow-agent-manager.ts`: thêm `configPath` getter, `getSettings()`, `saveSettings(s)`, `reload()`.
- [ ] Pass + typecheck. Commit: `feat: agent manager settings api`.

## Task 4: Main wiring + preload

- [ ] `src/main/index.ts`: handler `SettingsGet`/`SettingsSave` → `mainApp.meowAgent.*`.
- [ ] `src/preload/index.ts`: `getSettings`/`saveSettings` invoke.
- [ ] typecheck. Commit: `feat: wire settings ipc`.

## Task 5: Renderer SettingsDialog

- [ ] `src/renderer/src/components/SettingsDialog.tsx`: form provider rows (id, model, baseUrl, apiKey password,
  default radio, remove) + "Add provider" preset dropdown (DeepSeek/OpenAI/Anthropic/Custom) + Save/Cancel.
  Load `getSettings()` khi mở; save → `saveSettings()` → đóng.
- [ ] `Sidebar.tsx`: nút "settings" mở dialog.
- [ ] `styles.css`: style dialog + rows.
- [ ] typecheck + build. Commit: `feat: renderer settings dialog`.

## Task 6: E2E + verification

- [ ] `tests/e2e/smoke.spec.ts`: mở settings dialog → thêm provider deepseek → save → dialog đóng.
- [ ] `npm run typecheck`, `npm test`, `npm run build && npm run e2e` đều pass. Commit: `feat: meow settings ui`.
