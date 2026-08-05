# Meow Coding — Group B: Slash Commands, Cost/Stats, File Watcher: Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhóm B — slash commands + prompt templates, cost/usage tracking + stats, file watcher.

**Trạng thái:** ✅ Đã thực thi (typecheck, 287 unit/integration tests, 6 e2e pass).

---

## 1. Commands store + resolver (`src/main/agent/commands.ts`, mới)

- Types: `Command { name, description, template, agent?, model? }` (shared).
- `CommandStore`: built-ins `/init`, `/review` + user commands `userData/commands.json` +
  project `project/.meow/commands/*.md` (frontmatter `name/description` + body template).
  API: `list(projectPath)`, `save(command)`, `remove(name)`, `resolve(name, args, cwd)`.
- `resolveCommandTemplate(template, args)`:
  - `$1..$N` (last slurps remainder), `$ARGUMENTS`, `@path` → gọi `expandReferences` (đã có).
  - `` !`cmd` `` → `exec` shell (timeout 10s), lỗi → thay error text.
- `/init`: generate AGENTS.md gợi ý (template text) vào project.
- `/review`: git diff (hoặc status) → tóm tắt, gửi cho agent.

## 2. IPC commands

- `Channels`: `CommandList: 'commands:list'`, `CommandSave: 'commands:save'`, `CommandRemove: 'commands:remove'`.
- `AgentApi`: `listCommands(projectPath): Promise<Command[]>`,
  `saveCommand(cmd: Command): Promise<Command>`, `removeCommand(name: string): Promise<void>`.
- Main handler + preload + ipc-contract test.

## 3. Command UI (`ChatInput.tsx`, `ChatPanel.tsx`)

- Gõ `/` mở dropdown commands (filter theo prefix).
- Chọn → resolve template (với args đã gõ sau tên command), điền vào input.
- Gửi như user message bình thường qua `send`.

## 4. Cost/usage tracking (`src/main/agent/usage.ts`, mới)

- `ModelPrice { input, output, cacheRead?, cacheWrite? }` từ catalog `cost`.
- `calcCost(model, tokens, price) = input*pi/1M + output*po/1M`.
- `StoredSession.usage: UsageSummary { input, output, cacheRead, cacheWrite, cost }` (mới, migration default).
- `loop.ts` done event → `deps.onUsage?.(usage)`; manager cập nhật session.
- `usageFor(agentId)` aggregate; `stats()` aggregate per model.

## 5. IPC stats

- `Channels.StatsGet: 'stats:get'`, `AgentApi.getStats(): Promise<StatsSummary>`.
- `StatsSummary { totalCost, totalTokens, perModel: Record<string, {messages,tokens,cost}>, perSession: SessionUsage[] }`.

## 6. Cost UI

- ChatPanel sau turn: `$0.00 · 123 tokens (100 in / 23 out)`.
- Settings: tab mới "Usage" (hoặc trong StatusBar) hiển thị tổng cost/tokens.

## 7. File watcher (`src/main/file-watcher.ts`, mới)

- `FileWatcher { start(projectPath, cb), stop() }` — `fs.watch` recursive (Node 20+), debounce 500ms,
  ignore `node_modules/.git/out/dist`, chỉ file text (ext allow-list: ts/js/tsx/jsx/json/md/css/html/py/go/rs...).
- MainApp: bật khi `openWorkspace`, tắt khi `resetActiveProject`/remove.
- Event `context:changed` → renderer badge.

## 8. IPC watcher event

- `Channels.EventContextChanged: 'context:changed'`, payload `ContextChangedEvent { projectPath, files }`.
- Preload `onContextChanged`.
- Renderer: ChatPanel hiển thị `N files changed` (nhỏ), gắn vào system prompt qua manager.

## 9. Tests

- `commands.test.ts` — resolver `$1..$N`/`$ARGUMENTS`/`@path`/`!cmd`, store, `/init`.
- `usage.test.ts` — cost calc, aggregate.
- `file-watcher.test.ts` — ignore dirs, debounce (dùng tmp dir + fs.writeFile).
- `ipc-contract.test.ts` — channels mới.
- e2e: giữ nguyên.

## 10. Verify

- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
