# Meow Coding — Settings Screen (toàn bộ meow.json) : Design Spec

Ngày: 2026-08-05 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Tạo **màn hình Settings riêng** với **tabbed layout** (mỗi tab chỉnh 1 nhóm setting), đẩy **toàn bộ**
các setting trong `meow.json` vào đó — không chỉ providers như hiện tại:

| Key trong meow.json | Tab | Trạng thái hiện tại |
|---|---|---|
| `provider` + `model` | Providers | Đã có (ProvidersDialog) |
| `agents` (systemPrompt, model) | Agents | **Chưa có UI** |
| `permission` (tool → allow/ask/deny) | Permissions | **Chưa có UI** |
| `mcp` (MCP server configs) | MCP | Chỉ đọc status, **chưa CRUD** |
| `maxContextTokens` + `compaction` | Context | **Chưa có UI** |

Mục tiêu phụ: giữ nguyên hành vi hiện tại (connect/disconnect provider, permission runtime, MCP
reconnect khi save, compaction) và không phá e2e.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Form factor | Dialog lớn (khoảng 760px, ~80vh) có thanh tab dọc trái / nội dung phải — "màn hình settings riêng" trong app |
| Entry point | Sidebar menu "Providers" → đổi thành "Settings" |
| Data model | Mở rộng `MeowSettings` (shared) thành DTO đầy đủ của `MeowConfig`: providers, defaultProvider, agents, permission, mcp, maxContextTokens, compaction |
| Type dùng chung | Chuyển `PermissionRule`, `McpServerConfig`, `CompactionSettings` vào `src/shared/types.ts` |
| Persist | Một nút **Save** duy nhất gọi `saveSettings(draft)`; `settingsToConfig` map đầy đủ → `writeMeowConfig` → `reload()` |
| Providers tab | Dùng lại luồng `connectProvider`/`disconnectProvider` (persist tức thì như cũ) + refresh; phần còn lại (agents/permission/mcp/context) là draft + Save |
| MCP | Chỉnh `mcp` trong draft; Save → `reload()` → `syncTools()` reconnect |
| Agents | Sửa `systemPrompt`; không cho xoá agent `meow` (fallback mặc định) |
| Permissions | Row tool + select allow/ask/deny; thêm/xoá rule; gợi ý tool có sẵn |

## 3. Kiến trúc / luồng dữ liệu

```
Sidebar (menu Settings)
  └─ SettingsDialog
       ├─ load: window.api.getSettings()          → MeowSettings (đầy đủ)
       ├─ draft state (agents, permission, mcp, maxContextTokens, compaction)
       ├─ ProvidersTab   → connectProvider/disconnectProvider IPC (persist tức thì)
       ├─ AgentsTab      → edit draft.agents
       ├─ PermissionsTab → edit draft.permission
       ├─ McpTab         → edit draft.mcp  (+ getMcpStatus để hiển thị)
       ├─ ContextTab     → edit draft.maxContextTokens + draft.compaction
       └─ Save → window.api.saveSettings(draft) → main: settingsToConfig → write → reload()
```

Thay đổi file:

- `src/shared/types.ts` — thêm `PermissionRule`, `McpServerConfig`, `CompactionSettings`,
  `AgentSettings`; mở rộng `MeowSettings`.
- `src/main/agent/config.ts` — `configToSettings`/`settingsToConfig` map đầy đủ; dùng shared types.
- `src/main/agent/mcp/manager.ts` — import `McpServerConfig` từ shared.
- `src/main/meow-agent-manager.ts` — `connectProvider`/`disconnectProvider` giữ nguyên các field khác.
- `src/renderer/src/components/ProvidersDialog.tsx` → thay bằng `settings/SettingsDialog.tsx` +
  các tab (`ProvidersTab`, `AgentsTab`, `PermissionsTab`, `McpTab`, `ContextTab`).
- `src/renderer/src/components/Sidebar.tsx` — menu item "Settings".
- `src/renderer/src/styles.css` — class cho settings dialog + tabs + form rows.
- Tests: `agent-config.test.ts`, `meow-agent-manager.test.ts`, `ipc-contract.test.ts`, `e2e/smoke.spec.ts`.

## 4. Xử lý lỗi

- `getSettings` lỗi/offline → dialog hiển thị settings mặc định.
- Save thất bại → giữ draft, hiện message lỗi.
- Provider connect/disconnect không đổi draft của các tab khác.
- MCP không connect được (offline) → status `error` hiển thị trong MCP tab, không chặn save.

## 5. Kiểm thử

- Update `agent-config.test.ts`: round-trip `MeowSettings` đầy đủ ↔ `MeowConfig`.
- Update `meow-agent-manager.test.ts`: `getSettings`/`saveSettings` giữ agents/permission/mcp/context.
- Update `ipc-contract.test.ts`: khớp contract mở rộng.
- Update `e2e/smoke.spec.ts`: mở Settings → tab Providers → connect → Save.
- Bắt buộc: `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

## 6. Tiêu chí thành công

- Mở Settings từ sidebar thấy đủ 5 tab; mỗi tab chỉnh đúng 1 nhóm setting.
- Save phản ánh đúng vào `meow.json` và áp dụng runtime (system prompt, permission, MCP, compaction).
- `npm run typecheck` + `npm test` pass; e2e smoke pass.
