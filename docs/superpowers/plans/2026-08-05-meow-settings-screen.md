# Meow Coding — Settings Screen: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo màn hình Settings tabbed đẩy toàn bộ `meow.json` vào UI (providers, agents, permission,
mcp, context). Mỗi tab chỉnh 1 nhóm; nút Save duy nhất áp dụng draft.

---

## 1. Shared types (`src/shared/types.ts`)

- Thêm:
  ```ts
  export type PermissionRule = 'allow' | 'ask' | 'deny'
  export interface McpServerConfig { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
  export interface CompactionSettings { auto: boolean; buffer: number; keepTokens: number; tailTurns: number; toolOutputMaxChars: number }
  export interface AgentSettings { name: string; systemPrompt: string; provider?: string; model?: string }
  ```
- Mở rộng `MeowSettings`:
  ```ts
  export interface MeowSettings {
    providers: ProviderSettings[]
    defaultProvider: string
    agents: AgentSettings[]
    permission: Record<string, PermissionRule>
    mcp: Record<string, McpServerConfig>
    maxContextTokens: number
    compaction: CompactionSettings
  }
  ```

## 2. Config mapping (`src/main/agent/config.ts`)

- `configToSettings(cfg)` → map đủ 7 field; agents thành `AgentSettings[]` (name + systemPrompt + provider/model).
- `settingsToConfig(settings, base)` → map ngược; giữ `agents`, `permission`, `mcp`,
  `maxContextTokens`, `compaction` từ `settings` (fallback base).
- Dùng shared `PermissionRule`/`CompactionSettings`; xoá type local trùng.
- `McpServerConfig` import từ `mcp/manager` → giữ (đã cùng shape), hoặc alias sang shared.

## 3. Manager (`src/main/meow-agent-manager.ts`)

- `connectProvider`/`disconnectProvider`: dùng `this.getSettings()` làm base rồi chỉ sửa
  `providers`/`defaultProvider`, giữ các field khác (tránh mất agents/mcp/context khi save).

## 4. Renderer

- `src/renderer/src/components/settings/SettingsDialog.tsx` (mới): backdrop + dialog 760px, nav tab trái
  (Providers / Agents / Permissions / MCP / Context), content phải, footer Cancel + Save.
  - Load `getSettings()` vào draft; state `tab`, `draft`, `status`, `saving`.
  - Save → `saveSettings(draft)` → `status` thành công; các tab khác đọc draft prop.
- `settings/ProvidersTab.tsx` (mới): port UI từ `ProvidersDialog` (catalog, connect, disconnect, models, MCP status) — giữ class cũ `.providers-dialog`? Không: dùng container mới nhưng giữ các class con `.provider-*`, `.mcp-status` để e2e ổn.
- `settings/AgentsTab.tsx` (mới): list agent (name readonly, systemPrompt textarea); không xoá `meow`.
- `settings/PermissionsTab.tsx` (mới): rows tool + select allow/ask/deny + add/remove.
- `settings/McpTab.tsx` (mới): rows server name + command/args/url/env + add/remove; hiển thị `getMcpStatus()`.
- `settings/ContextTab.tsx` (mới): inputs `maxContextTokens`, compaction fields.
- `Sidebar.tsx`: menu item "Providers" → "Settings" mở `SettingsDialog`.
- Xoá `ProvidersDialog.tsx` (thay bằng ProvidersTab).
- `styles.css`: `.settings-dialog`, `.settings-nav`, `.settings-tab`, `.settings-content`, `.settings-row`, form inputs.

## 5. Tests

- `agent-config.test.ts`: round-trip full `MeowSettings` ↔ `MeowConfig`.
- `meow-agent-manager.test.ts`: `getSettings`/`saveSettings` giữ agents/permission/mcp/context.
- `ipc-contract.test.ts`: khớp `MeowSettings` mở rộng.
- `e2e/smoke.spec.ts`: mở Settings (menu "Settings") → tab Providers → connect deepseek → Save → đóng.

## 6. Verify

- `npm run typecheck`
- `npm test`
- `npm run build && npm run e2e`
