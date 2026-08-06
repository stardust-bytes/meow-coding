# Meow Coding — Vibe P1: Live Cost/Token + Auto-context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the P1 "context quality" features from `docs/superpowers/specs/2026-08-06-vibe-coding-gaps-design.md` §5:
1. **Live cost/token** — per-pane live chip, StatusBar workspace cost, per-session cost in SessionBar, usage-by-session/model view.
2. **File watcher → auto-context** — consume `ContextChangedEvent` (currently dead), changed-files chip bar in ChatPanel, optional `autoContext` main-side injection.

**Architecture:** Both features reuse existing infrastructure: `usage` ChatEvent is already emitted per-step (meow-agent-manager `onUsage`), `getStats()` already aggregates; `FileWatcher` already emits `ContextChangedEvent` via preload `onContextChanged`. This plan wires consumers + a new setting, no new processes.

**Tech Stack:** Electron 41, React 19, TypeScript strict, Vitest, `glob` ^13 (cho auto-context file lọc).

---

## File Map

- Modify: `src/shared/types.ts` — `AutoContextSettings`, `MeowSettings.autoContext?`, `ContextChangedEvent` (giữ nguyên), `SessionUsageView` (optional).
- Modify: `src/shared/ipc.ts` — `Channels.StatsLive` (event) + `AgentApi.onStatsLive`; `Channels.ContextAttach` (nếu attach-all gửi qua main); hoặc dùng `sendChat` text thay vì channel mới — chọn: **không thêm channel**, attach = chèn `@path` vào text (tái dùng P0.3). Chỉ thêm `onStatsLive`.
- Modify: `src/main/meow-agent-manager.ts` — `getStats()` thêm `perSession` cost (đã có); thêm `autoContext` injection ở `send()`; thêm `getChangedFiles(agentId)`.
- Modify: `src/main/index.ts` — lưu changed-files per workspace (đã có `ContextChangedEvent` forward); handler `stats:live` emit interval? Không — push khi `usage`/`done` (đã có `EventChat`). Thêm handler `ContextChanged` → forward (đã có) + lưu vào manager.
- Modify: `src/renderer/src/App.tsx` — subscribe `onContextChanged` → state per workspace.
- Modify: `src/renderer/src/components/StatusBar.tsx` — cost/token item.
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` — live cost chip (dùng `usage` event đã có), changed-files chip bar, "attach all" → send text `@path...`.
- Modify: `src/renderer/src/components/chat/SessionBar.tsx` — per-session cost label.
- Modify: `src/renderer/src/components/settings/ContextTab.tsx` — autoContext toggle (settings UI là `SettingsDialog` + tabs).
- Test: `tests/unit/ipc-contract.test.ts`, `tests/unit/meow-agent-manager.test.ts`, `tests/unit/agent-config.test.ts`, new `tests/unit/auto-context.test.ts`.

---

## Task 1: Types + config — autoContext setting

**Files:** `src/shared/types.ts`, `src/main/agent/config.ts`, tests `tests/unit/ipc-contract.test.ts`, `tests/unit/agent-config.test.ts`

- [ ] **Step 1: Write failing tests**
  - `tests/unit/ipc-contract.test.ts`: stub `getSettings` trả về thêm `autoContext: { enabled: false, maxFiles: 10 }`.
  - `tests/unit/agent-config.test.ts`:
```ts
  it('normalizes autoContext with defaults', () => {
    const cfg = configToSettings({ ...DEFAULT_MEOW_CONFIG, autoContext: undefined })
    expect(cfg.autoContext).toEqual({ enabled: false, maxFiles: 10 })
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement types** — `src/shared/types.ts`:
```ts
export interface AutoContextSettings {
  enabled: boolean
  maxFiles: number
}
// MeowSettings thêm: autoContext?: AutoContextSettings
```
- [ ] **Step 4: Implement config.ts** — thêm `AutoContextConfig` interface + `DEFAULT_AUTO_CONTEXT = { enabled: false, maxFiles: 10 }`; `normalizeAutoContext`; thêm vào `MeowConfig`, `configToSettings`, `settingsToConfig`.

- [ ] **Step 5: Settings UI** — `ContextTab.tsx` thêm row "Auto-context changed files" (toggle `enabled` + number `maxFiles`), wire vào `onChange` patch `autoContext`.
- [ ] **Step 6: Run tests** → PASS.

- [ ] **Step 7: Commit** — `git commit -m "config: autoContext setting (default off, maxFiles 10)"`

---

## Task 2: Live cost — StatusBar + SessionBar (per-pane chip đã có)

**Files:** `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/components/chat/SessionBar.tsx`, `src/renderer/src/App.tsx`

**Note (đã xác minh code):** ChatPanel đã có `sessionCost` state (dòng 74) + `usage` event handler (dòng 294) → `ContextFooter` đã render `cost={sessionCost}` (dòng 752). **Per-pane live chip đã xong** — phần này chỉ thêm StatusBar + SessionBar + usage view.

- [ ] **Step 1: StatusBar** — thêm prop `stats: StatsSummary | null`; render `$<cost> · <tokens>k tok` (format: `formatCost` helper — thêm vào `src/shared/text.ts` hoặc inline):
```ts
function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost > 0) return `$${cost.toFixed(4)}`
  return '$0.00'
}
```
- [ ] **Step 3: App.tsx** — state `stats`; refresh khi workspace open + khi `onChatEvent` nhận `usage`/`done` (re-fetch `getStats()`); truyền xuống StatusBar.
- [ ] **Step 4: SessionBar** — mỗi session item hiển thị `$<cost>` nhỏ (từ `stats.perSession` tìm theo session id — hoặc `listSessions` đã có `usage`? Kiểm tra `SessionSummary` — chưa có cost → dùng `getStats().perSession`).
- [ ] **Step 5: Manual check** — chạy 1 turn, StatusBar + SessionBar hiện cost tăng dần.
- [ ] **Step 6: Commit** — `git commit -m "renderer: live cost/token in status bar and session bar"`

---

## Task 3: Live cost — usage-by-session/model view

**Files:** `src/renderer/src/components/settings/SettingsDialog.tsx`, `src/main/meow-agent-manager.ts` (getStats đã có đủ)

- [ ] **Step 1: Implement view** — trong settings thêm tab/section "Usage": bảng per-session (title, model, input/output tokens, cost) từ `getStats()`, + per-model summary.
- [ ] **Step 2: Manual check** — view hiển thị đúng số liệu sau vài turn.
- [ ] **Step 3: Commit** — `git commit -m "renderer: usage by session and model view in settings"`

---

## Task 4: Auto-context — main-side changed-files tracking + injection

**Files:** `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/main/git-status-service.ts`, test `tests/unit/meow-agent-manager.test.ts`, new `tests/unit/auto-context.test.ts`

- [ ] **Step 1: Write failing test** — `tests/unit/auto-context.test.ts`:
```ts
  it('injects changed files into user message when autoContext enabled', async () => {
    // manager với autoContext.enabled=true + changedFiles=['src/a.ts']; send('a1','hi')
    // → appendMessage nhận text chứa '[Changed files]' và 'src/a.ts'
  })
  it('does not inject when autoContext disabled', async () => {
    // enabled=false → text không chứa '[Changed files]'
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement manager**:
  - Thêm `private changedFiles = new Map<string, string[]>()` (agentId → relative paths).
  - Method `setChangedFiles(agentId, files: string[])` — lưu; nếu vượt `maxFiles` → cắt + thêm `...` .
  - Method `clearChangedFiles(agentId)` — sau khi inject.
  - Trong `send()`: sau `expandReferences`, nếu `autoContext.enabled` và có changed files → append block:
```ts
const changed = this.changedFiles.get(agentId) ?? []
if (cfg.autoContext?.enabled && changed.length > 0) {
  text = text + '\n\n[Changed files]\n' + changed.join('\n')
  this.changedFiles.set(agentId, [])
}
```
- [ ] **Step 4: index.ts wiring** — `FileWatcher` callback hiện `win.webContents.send(EventContextChanged, ...)` → thêm: lưu vào manager (map theo agent thuộc workspace đó) + forward event. Cần map `projectPath → agents` (đã có qua `workspace`).
- [ ] **Step 5: git filter** — dùng `GitStatusService` dirty list để bỏ file chưa track nếu `autoContext` bật? (spec §5.2: "thêm lọc bằng GitStatusService dirty list") — chỉ lọc khi `enabled`; nếu dirty list trống → giữ nguyên watcher list.
- [ ] **Step 6: Run tests** → PASS.
- [ ] **Step 7: Commit** — `git commit -m "main: auto-context injects changed files into next turn (opt-in)"`

---

## Task 5: Auto-context — renderer changed-files chip bar

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: App.tsx** — subscribe `onContextChanged` (đã exposed, chưa dùng):
```ts
const offCtx = window.api.onContextChanged(({ projectPath, files }) => {
  setChangedByProject(prev => ({ ...prev, [projectPath]: files }))
})
```
- [ ] **Step 2: ChatPanel** — nhận prop `changedFiles: string[]` (lọc theo cwd project); render chip bar khi `changedFiles.length > 0`:
  - "📎 N files changed" + nút "attach all" + dropdown list từng file.
  - Attach all → gọi `send('@' + files.join(' @'))`? Không — gửi trực tiếp qua `sendChat(agentId, '...', images?)` với text chứa `@path` cho từng file (tái dùng expandReferences phía main). Hoặc gọi `window.api.sendChat(agentId, files.map(f => `@${f}`).join(' '))` → main expandReferences đọc nội dung.
  - Sau attach → gọi main `clearChangedFiles` (IPC mới? dùng `Channels.ChatSend` — không; thêm `Channels.ContextClear` hoặc tận dụng: attach xong render tự bỏ khỏi state; main-side clear khi autoContext enabled chỉ xảy ra khi inject. Giữ đơn giản: clear render state; main-side clear khi inject tự động).
- [ ] **Step 3: Manual check** — sửa file ngoài (VS Code), quay lại app → chip "1 file changed" hiện; attach all → agent nhận nội dung.
- [ ] **Step 4: Commit** — `git commit -m "renderer: changed-files chip bar with attach-all"`

---

## Task 6: Final — full verification

- [ ] **Step 1:** `npm run typecheck` — PASS.
- [ ] **Step 2:** `npm test` — PASS (`agent-config`, `auto-context`, `meow-agent-manager`, `ipc-contract`).
- [ ] **Step 3:** `npm run build && npm run e2e` — PASS (đụng IPC/UI).
- [ ] **Step 4:** Manual smoke: cost tăng live; sửa file → chip hiện → attach → agent thấy nội dung.

---

## Out of scope (theo spec §5)

- Chart phức tạp, cost theo ngày, cảnh báo ngân sách.
- Watch loại trừ tùy biến theo project; auto-attach mid-turn (chỉ đầu turn).
