# Meow Coding — Vibe P2: Auto-fix Loop + Session Export/Share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the P2 "loop + collaboration" features from `docs/superpowers/specs/2026-08-06-vibe-coding-gaps-design.md` §6:
1. **Auto-fix loop** — after the agent reports "done" in build mode, run a configured command (e.g. `npm test`); on failure, feed output back to the agent to fix, up to `maxRounds`.
2. **Session export/share** — export a session to Markdown/JSON; import JSON back; share a summarized context to another agent's new session.

**Architecture:** The auto-fix orchestrator lives **outside** the agent loop (in `MeowAgentManager.send`) so it never touches `MAX_STEPS`/compaction internals; each round is a system-style message in the transcript (`tool`-kind card) so the user sees and can Stop. Export/share reuse `StoredSession` (JSON store) — Markdown via `turndown`/manual render (check existing `MarkdownText` usage; export is plain text so no turndown needed).

**Tech Stack:** Electron 41, React 19, TypeScript strict, `node:child_process` spawn, `tree-kill`, Vitest.

---

## File Map

- Modify: `src/shared/types.ts` — `AutoFixSettings`, `MeowSettings.autoFix?`, `SessionExportResult`, `SessionShareResult`.
- Modify: `src/shared/ipc.ts` — `Channels.AutoFixGet/Save` (nếu setting riêng; hoặc dùng `SettingsGet/Save` chung — chọn dùng chung `SettingsGet/Save`), `Channels.SessionExport`, `Channels.SessionImport`, `Channels.SessionShare`.
- Modify: `src/main/agent/config.ts` — `AutoFixConfig`, `DEFAULT_AUTO_FIX`, normalize.
- Modify: `src/main/meow-agent-manager.ts` — auto-fix orchestrator trong `send()`; `exportSession`, `importSession`, `shareSession` methods.
- Create: `src/main/agent/auto-fix.ts` — `runAutoFixCommand(cwd, command, timeoutMs)` spawn wrapper (return `{code, output}`).
- Modify: `src/main/agent/session.ts` — `exportMarkdown(session)`, `importFromJson(json)` helpers (hoặc để trong manager; chọn để trong manager để SessionStore thuần JSON).
- Modify: `src/main/index.ts` — IPC handlers cho export/import/share.
- Modify: `src/preload/index.ts` — AgentApi methods.
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` — auto-fix card rendering (dùng ToolCallCard-style hoặc message system); SessionBar menu export/import/share.
- Modify: `src/renderer/src/components/chat/SessionBar.tsx` — export/share dropdown + import button.
- Test: `tests/unit/ipc-contract.test.ts`, `tests/unit/agent-config.test.ts`, new `tests/unit/auto-fix.test.ts`, `tests/unit/session-export.test.ts`, `tests/unit/meow-agent-manager.test.ts`.

---

## Task 1: Types + config — autoFix setting

**Files:** `src/shared/types.ts`, `src/main/agent/config.ts`, tests `tests/unit/ipc-contract.test.ts`, `tests/unit/agent-config.test.ts`

- [ ] **Step 1: Write failing tests**
  - `tests/unit/ipc-contract.test.ts`: stub `getSettings` thêm `autoFix: { enabled: false, maxRounds: 3, command: '' }`.
  - `tests/unit/agent-config.test.ts`:
```ts
  it('normalizes autoFix with defaults', () => {
    const cfg = configToSettings({ ...DEFAULT_MEOW_CONFIG, autoFix: undefined })
    expect(cfg.autoFix).toEqual({ enabled: false, maxRounds: 3, command: '' })
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement types** — `src/shared/types.ts`:
```ts
export interface AutoFixSettings {
  enabled: boolean
  maxRounds: number
  command: string  // '' = vô hiệu hóa; VD 'npm test'
}
// MeowSettings thêm: autoFix?: AutoFixSettings
```
- [ ] **Step 4: Implement config.ts** — `AutoFixConfig` + `DEFAULT_AUTO_FIX = { enabled: false, maxRounds: 3, command: '' }` + normalize + wire vào `configToSettings`/`settingsToConfig`.

- [ ] **Step 5: Settings UI** — `ContextTab.tsx` thêm row "Auto-fix loop" (toggle `enabled`, input `command` VD `npm test`, number `maxRounds`), wire vào `onChange` patch `autoFix`.
- [ ] **Step 6: Run tests** → PASS.

- [ ] **Step 7: Commit** — `git commit -m "config: autoFix setting (default off, maxRounds 3)"`

---

## Task 2: Auto-fix — command runner

**Files:** create `src/main/agent/auto-fix.ts`, test `tests/unit/auto-fix.test.ts`

- [ ] **Step 1: Write failing test** — `tests/unit/auto-fix.test.ts`:
```ts
  it('runs command and returns code+output', async () => {
    const res = await runAutoFixCommand(process.cwd(), 'node -e "console.log(42); process.exit(1)"', 5000)
    expect(res.code).toBe(1)
    expect(res.output).toContain('42')
  })
  it('times out long commands', async () => {
    const res = await runAutoFixCommand(process.cwd(), 'node -e "setTimeout(()=>{},10000)"', 300)
    expect(res.code).not.toBe(0)
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `src/main/agent/auto-fix.ts`:
```ts
import { spawn } from 'node:child_process'
import kill from 'tree-kill'

export interface AutoFixResult { code: number | null; output: string; timedOut: boolean }

export function runAutoFixCommand(cwd: string, command: string, timeoutMs = 60_000): Promise<AutoFixResult> {
  return new Promise(resolve => {
    const isWin = process.platform === 'win32'
    const child = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d','/s','/c', command] : ['-c', command], {
      cwd, windowsHide: true, windowsVerbatimArguments: isWin, env: process.env
    })
    let output = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      kill(child.pid!, 'SIGTERM')
    }, timeoutMs)
    child.stdout?.on('data', d => { output += d; if (output.length > 64_000) output = output.slice(-64_000) })
    child.stderr?.on('data', d => { output += d; if (output.length > 64_000) output = output.slice(-64_000) })
    child.on('error', err => { clearTimeout(timer); resolve({ code: -1, output: String(err), timedOut }) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, output, timedOut }) })
  })
}
```
- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "agent: auto-fix command runner with timeout and tree-kill"`

---

## Task 3: Auto-fix — orchestrator in send()

**Files:** `src/main/meow-agent-manager.ts`, test `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Write failing test**
```ts
  it('runs auto-fix rounds when enabled and command fails', async () => {
    // fake runner.run = lần 1 gọi onEvent done; command = 'node -e "process.exit(1)"' luôn fail
    // autoFix {enabled:true, maxRounds:2, command}
    // assert: appendMessage user được gọi thêm 2 lần (2 rounds), mỗi lần text chứa '[auto-fix attempt'
  })
  it('does not auto-fix in plan mode', async () => {
    // mode plan → không chạy command
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — trong `send()` sau `runner.run` thành công (không bị abort), trước `finally` kết thúc:
```ts
const cfg = loadMeowConfig(this.deps.configPath)
const autoFix = cfg.autoFix
const mode = this.modes.get(agentId) ?? 'build'
if (autoFix?.enabled && autoFix.command && mode === 'build' && !aborted) {
  let round = 0
  while (round < (autoFix.maxRounds ?? 3)) {
    round++
    const res = await runAutoFixCommand(agent.cwd, autoFix.command)
    const prefix = `[auto-fix attempt ${round}/${autoFix.maxRounds}]`
    if (res.code === 0) {
      this.deps.store.appendMessage(sessionId, { id: randomUUID(), role: 'user', text: `${prefix} passed.`, createdAt: Date.now() })
      break
    }
    const body = `${prefix} failed (exit ${res.code}${res.timedOut ? ', timeout' : ''}):\n${res.output.slice(0, 4000)}`
    this.deps.store.appendMessage(sessionId, { id: randomUUID(), role: 'user', text: body, createdAt: Date.now() })
    this.emit({ type: 'auto-fix', agentId, round, maxRounds: autoFix.maxRounds ?? 3, code: res.code, output: res.output.slice(0, 2000) })
    // chạy lại agent để sửa
    await runner.run(controller.signal)  // reuse cùng runner; controller chưa abort
    if (controller.signal.aborted) break
  }
}
```
Note: cần cẩn thận — `runner.run` hiện được gọi 1 lần trong try; refactor: tách `runOnce(controller)` helper, gọi trong try rồi loop auto-fix gọi lại. Đảm bảo `snapshots.commitTurn`/`resolvePendingFor` chỉ chạy sau khi toàn bộ auto-fix rounds xong (trong finally).
- [ ] **Step 4: Add ChatEvent type** — `src/shared/types.ts`:
```ts
  | { type: 'auto-fix'; agentId: string; round: number; maxRounds: number; code: number | null; output: string }
```
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "agent: auto-fix orchestrator (build mode only, maxRounds)"`

---

## Task 4: Auto-fix — transcript card UI

**Files:** `src/renderer/src/components/chat/ChatPanel.tsx`, `src/renderer/src/components/chat/ToolCallCard.tsx` (tham chiếu style)

- [ ] **Step 1: Implement** — ChatPanel `onChatEvent` thêm branch `e.type === 'auto-fix'` → thêm FeedItem `{kind:'tool', ...}`-style hoặc item riêng `{kind:'autofix', round, code, output}`:
```tsx
<div className={`autofix ${code === 0 ? 'pass' : 'fail'}`}>
  <div className="autofix-head">auto-fix run #{round}/{maxRounds} {code === 0 ? 'passed' : `failed (exit ${code})`}</div>
  {code !== 0 && <pre className="autofix-output">{output}</pre>}
</div>
```
- [ ] **Step 2: Manual check** — bật autoFix command fail → card đỏ hiện, agent sửa, card xanh khi pass.
- [ ] **Step 3: Commit** — `git commit -m "renderer: auto-fix round cards in chat feed"`

---

## Task 5: Session export — Markdown + JSON

**Files:** `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, test `tests/unit/session-export.test.ts`

- [ ] **Step 1: Write failing test** — `tests/unit/session-export.test.ts`:
```ts
  it('exports session to markdown', () => {
    const md = exportSessionMarkdown(session)
    expect(md).toContain('# title')
    expect(md).toContain('user text')
    expect(md).toContain('assistant text')
  })
  it('round-trips import from JSON', () => {
    const parsed = parseSessionJson(JSON.stringify(session))
    expect(parsed.id).toBe(session.id)
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement manager methods**:
```ts
exportSessionMarkdown(session: StoredSession): string {
  const lines = [`# ${session.title}`, '', `- Agent: ${session.agentId}`, `- Created: ${new Date(session.createdAt).toISOString()}`, `- Usage: ${session.usage.cost} USD`, '']
  for (const item of session.items) {
    if (item.kind === 'message') lines.push(`## ${item.message.role}\n\n${item.message.text}\n`)
    else lines.push(`### tool: ${item.tool.tool}\n\`\`\`json\n${JSON.stringify(item.tool.input ?? {})}\n\`\`\`\n`)
  }
  return lines.join('\n')
}
```
- [ ] **Step 4: IPC** — `Channels.SessionExport: 'session:export'`, `SessionImport: 'session:import'`; handler:
```ts
ipcMain.handle(Channels.SessionExport, (_e, sessionId) => {
  const session = mainApp.meowAgent.getSessionById(sessionId)
  return session ? { markdown: exportSessionMarkdown(session), json: JSON.stringify(session) } : null
})
ipcMain.handle(Channels.SessionImport, (_e, agentId, json: string) => mainApp.meowAgent.importSession(agentId, json))
```
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "agent: session export to markdown/json + import"`

---

## Task 6: Session share — summarize context to another agent

**Files:** `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, test `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Write failing test**
```ts
  it('shares summarized context as first user message in target agent session', async () => {
    // source session có 2 turn (user + assistant); shareSession(sourceId, targetAgentId)
    // → target store.appendMessage gọi với text chứa title + nội dung user/assistant, ≤ 6000 tokens
  })
```
- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `shareSession(sourceId: string, targetAgentId: string)`:
```ts
const src = this.deps.store.get(sourceId)
if (!src) return null
const target = this.agents.get(targetAgentId)
if (!target) return null
const targetSessionId = this.createSession(targetAgentId).id  // session mới bên nhận
const parts: string[] = [`Context shared from "${src.title}" (agent ${src.agentId}).`, '']
for (const item of src.items) {
  if (item.kind === 'message' && item.message.role === 'user') parts.push(`**User:** ${item.message.text}`)
  else if (item.kind === 'message' && item.message.role === 'assistant') parts.push(`**Assistant:** ${item.message.text}`)
  const joined = parts.join('\n')
  if (joined.length > 6000) { parts.pop(); break }  // token limit gần đúng
}
this.deps.store.appendMessage(targetSessionId, { id: randomUUID(), role: 'user', text: parts.join('\n') + `\n\n(Shared from agent ${src.agentId}, session "${src.title}")`, createdAt: Date.now() })
return this.summary(this.deps.store.get(targetSessionId)!)
```
- [ ] **Step 4: IPC** — `Channels.SessionShare: 'session:share'`; handler `(_e, sourceId, targetAgentId)`.
- [ ] **Step 5: Run tests** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "agent: share summarized session context to another agent"`

---

## Task 7: Renderer — SessionBar export/share/import UI

**Files:** `src/renderer/src/components/chat/SessionBar.tsx`, `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Implement SessionBar menu** — thêm dropdown (⋯) trên session hiện tại:
  - **Export Markdown** → `window.api.exportSession(sessionId)` → `{markdown, json}` → tạo Blob download (renderer: `URL.createObjectURL` + `<a download>`).
  - **Export JSON** → tương tự với `json`.
  - **Import...** → `<input type=file accept=.json>` → `window.api.importSession(agentId, jsonText)` → reload sessions.
  - **Share to agent...** → danh sách agent khác trong workspace (từ props) → `window.api.shareSession(sourceId, targetAgentId)` → thông báo thành công (system-style `[meow]` qua error event? dùng alert nhẹ — thêm `ChatEvent` type `notice` hoặc renderer toast. Chọn renderer-local toast đơn giản).
- [ ] **Step 2: Manual check** — export md hiện đúng nội dung; import tạo session mới; share tạo session mới bên agent kia có context.
- [ ] **Step 3: Commit** — `git commit -m "renderer: session export/import/share menu"`

---

## Task 8: Final — full verification

- [ ] **Step 1:** `npm run typecheck` — PASS.
- [ ] **Step 2:** `npm test` — PASS (`auto-fix`, `session-export`, `agent-config`, `meow-agent-manager`, `ipc-contract`).
- [ ] **Step 3:** `npm run build && npm run e2e` — PASS.
- [ ] **Step 4:** Manual smoke: auto-fix round fail→pass; export/import/share hoạt động.

---

## Out of scope (theo spec §6)

- Tự cài dependencies; chọn lệnh tự động theo project; fix song song nhiều agent.
- Sync cloud; diff 2 session; export theo filter turn.
