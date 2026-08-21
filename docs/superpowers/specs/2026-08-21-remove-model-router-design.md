# Remove Model Router — kết quả routing không như mong muốn: gỡ toàn bộ, để lại menu "Coming soon": Design Spec

Ngày: 2026-08-21 · Trạng thái: chờ duyệt spec

## 1. Mục tiêu

Kết quả router model không như mong muốn. Gỡ **toàn bộ** những thứ liên quan đến Model Router
(gateway, accounts/connections, quota, logs, popup). Chỉ giữ lại mục **Model Router** trong dropdown
footer sidebar — khi bấm vào hiển thị modal nhỏ **"Coming soon"**.

Quyết định của người dùng khi được hỏi scope:

- **Xóa toàn bộ** — kể cả hệ thống Connections/Accounts (login Claude Code / Codex) + quota monitor.
- UX "coming soon" = **modal nhỏ** (style `.dialog` sẵn có), không toast, không thay body dialog.

## 2. Phạm vi xóa

### 2a. Main process — xóa toàn bộ

- `src/main/connections/` — toàn bộ thư mục:
  - `manager.ts` (ConnectionsManager: login, switch, quota refresh, resolveSpawnEnv)
  - `oauth.ts`, `store.ts`, `types.ts`, `quota.ts` (QuotaMonitor)
  - `providers/claude.ts`, `providers/codex.ts`, `providers/apikey.ts`
  - `vault.ts` → **di chuyển** thành `src/main/vault.ts` (vẫn cần cho mã hoá API key providers)
- `src/main/gateway/` — toàn bộ thư mục:
  - `config.ts`, `manager.ts`, `server.ts`, `router.ts`, `forward.ts`, `log-store.ts`

### 2b. Renderer — xóa toàn bộ

- `src/renderer/src/components/ModelRouter/` — toàn bộ:
  - `ModelRouterDialog.tsx`, `AccountsTab.tsx`, `GatewayTab.tsx`, `QuotaTab.tsx`, `LogsTab.tsx`

### 2c. Tests — xóa toàn bộ

- `tests/unit/connections-oauth.test.ts`
- `tests/unit/connections-store.test.ts`
- `tests/unit/gateway-router.test.ts`
- `tests/unit/gateway-server.test.ts`

### 2d. Docs — xóa

- `docs/superpowers/specs/2026-08-21-model-router-design.md`
- `docs/superpowers/plans/2026-08-21-model-router.md`

## 3. Shared types & IPC contract

### `src/shared/types.ts` — xóa các type

`ProviderId`, `AuthMode`, `RoutingStrategy`, `GatewayConfig`, `GatewayStatus`, `GatewayRequestLog`,
`QuotaInfo`, `ProviderAccount`, `LoginStart`, `ConnectionProviderStatus`, `ConnectionsState`,
`ApiKeyInput`.

### `src/shared/ipc.ts` — xóa

- Channels: `connections:*` (`ConnectionsList`, `ConnectionsLoginStart/Cancel/Submit`,
  `ConnectionsSwitch`, `ConnectionsRemove`, `ConnectionsImport`, `ConnectionsApiKeySave/Test`,
  `ConnectionsQuotaRefresh`, `EventConnectionsChanged`, `EventConnectionsLoginProgress`,
  `EventConnectionsQuotaAlert`) và `gateway:*` (`GatewayGetConfig`, `GatewaySaveConfig`,
  `GatewayListLogs`, `GatewayClearLogs`, `EventGatewayChanged`).
- Event interfaces: `ConnectionsChangedEvent`, `ConnectionsLoginProgressEvent`,
  `ConnectionsQuotaAlertEvent`.
- Methods trên `AgentApi`: `listConnections`, `startConnectionLogin`, `cancelConnectionLogin`,
  `submitConnectionCode`, `switchConnectionAccount`, `removeConnectionAccount`,
  `importConnectionAccount`, `saveApiKeyAccount`, `testApiKeyAccount`, `refreshConnectionsQuota`,
  `onConnectionsChanged`, `onConnectionsLoginProgress`, `onConnectionsQuotaAlert`,
  `getGatewayConfig`, `saveGatewayConfig`, `listGatewayLogs`, `clearGatewayLogs`, `onGatewayChanged`.

## 4. Sửa code phụ thuộc

- `src/main/index.ts`:
  - Bỏ import/khởi tạo `Vault` (chuyển import từ `./connections/vault` → `./vault`), `ConnectionsManager`,
    `QuotaMonitor`, `GatewayManager`.
  - Bỏ IPC handlers `Connections*`, `Gateway*`.
  - Bỏ `syncGatewayProvider`, `gatewaySyncTimer`, `saveGatewayConfig` wrapper, startup gateway sync.
  - Bỏ `this.connections.resolveSpawnEnv(tmpl.id)` khi spawn CLI agent — không inject credentials
    nữa; CLI agent chạy với config mặc định của máy.
  - Bỏ `quotaMonitor.start()/stop()`, `gateway.start()/stop()` trong lifecycle.
- `src/main/meow-agent-manager.ts`:
  - Bỏ `syncGatewayProvider`, import `forwardListModels`, import types `GatewayStatus`, `ProviderAccount`,
    `ConnectionSecrets`.
  - Bỏ special-case `gateway` trong `fetchProviderModels`.
- `src/preload/index.ts`: bỏ các phương thức connections/gateway + type imports tương ứng.
- `tests/unit/ipc-contract.test.ts`: cập nhật stub `AgentApi` bỏ methods đã xóa.
- `src/renderer/src/App.tsx`: thay `<ModelRouterDialog>` bằng modal "Model Router — Coming soon"
  (dùng `.dialog-backdrop` + `.dialog` sẵn có; nút Close + ✕; Escape đóng).
- `src/renderer/src/components/Sidebar.tsx`: **giữ nguyên** mục "Model Router" trong dropdown,
  click vẫn gọi `onOpenModelRouter` (App mở modal coming soon).

## 5. Dọn user data (máy hiện tại)

- Xóa entry `provider.gateway` trong `meow.json` (nếu có) — để ModelPicker không còn hiện model
  gateway chết.
- Xóa refs `provider:gateway`, `conn:*` trong `connections/vault.json` (file vault sẽ không còn
  được đọc nữa sau khi xóa ConnectionsManager — dọn sạch cho gọn).

## 6. Hệ quả

- Terminal CLI agents (template `claude`/`codex`) chạy với config mặc định của máy
  (`~/.claude`, `~/.codex`) — không còn credentials từ account đã login trong app.
- Không còn UI đăng nhập/switch account Claude/Codex trong app.
- Không còn local gateway OpenAI-compatible, routing, quota monitor, logs.

## 7. Kiểm thử

- `npm run typecheck` pass.
- `npm test` pass (bỏ 4 test file router/connections; 10 fail officecli hiện có không liên quan).
- `npm run build` pass.
