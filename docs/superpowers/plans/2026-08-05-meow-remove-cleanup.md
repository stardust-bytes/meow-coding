# Meow Coding — Dọn dữ liệu khi xoá agent + fix removeWorkspace buffers: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi xoá agent / xoá workspace, dọn sạch dữ liệu liên quan (sessions, state, idle timer, log)
và buffers renderer — tránh dữ liệu mồ côi tích luỹ. Đồng thời **bỏ nút remove** ở Permissions tab
(vì merge default khiến nút remove vô tác dụng với tool có default rule).

**Trạng thái:** ✅ Đã thực thi.

---

## Đã làm

### 1. `src/main/agent/session.ts`
- Thêm `deleteForAgent(agentId)`: `saveSessions(loadSessions().filter(s => s.agentId !== agentId))`.

### 2. `src/main/log-manager.ts`
- Thêm `remove(agentId)` dùng `unlinkSync`, bọc try/catch (file có thể chưa tồn tại).

### 3. `src/main/alert-service.ts`
- Thêm `clear(agentId)` dùng lại `clearTimer`.

### 4. `src/main/meow-agent-manager.ts`
- `removeAgent(agentId)` bổ sung `this.deps.store.deleteForAgent(agentId)`.

### 5. `src/main/index.ts`
- `AgentRemove` handler: thêm `clearState(agentId)`, `alerts.clear(agentId)`, `logs.remove(agentId)`.
- `WorkspaceRemove` handler: trong vòng lặp thêm `alerts.clear(agent.id)`, `logs.remove(agent.id)`.

### 6. `src/renderer/src/App.tsx`
- `removeWorkspace(path)`: khi xoá workspace đang mở, dọn `termsRef`/`buffersRef` của từng agent.

### 7. `src/renderer/src/components/settings/PermissionsTab.tsx`
- Bỏ `removeRule` + nút remove. Giữ Add + select allow/ask/deny.

## Tests

- `session-store.test.ts`: `deleteForAgent` xoá đúng agent, giữ agent khác.
- `log-manager.test.ts`: `remove` xoá file + tolerate missing file.
- `meow-agent-manager.test.ts`: `removeAgent` xoá sessions của agent.
- `alert-service.test.ts`: `clear` dừng idle timer.

## Verify

- `npm run typecheck` ✅
- `npm test` ✅ (249 tests)
- `npm run build && npm run e2e` ✅ (6 tests)
