# Model Router — Popup account manager + local OpenAI-compatible gateway: Implementation Plan

Trạng thái: chờ duyệt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây popup **Model Router** (mở từ dropdown footer sidebar) chứa: Accounts (chuyển nguyên
Connections tab hiện tại), Gateway (local OpenAI-compatible server + routing/auto-switch), Quota,
Logs — theo spec `docs/superpowers/specs/2026-08-21-model-router-design.md`. Gateway là Node `http`
server trong main process (Approach A), không sidecar, không thêm dependency.

**Architecture:** Module mới `src/main/gateway/` (config/server/router/forward/log-store/manager)
dùng `ConnectionsStore` (đã có) để lấy account + vault secrets. UI: dropdown footer sidebar →
`ModelRouterDialog` full-height 4 tab. Gỡ tab Connections khỏi SettingsDialog.

**Tech Stack:** TypeScript strict, Node `http` built-in, Vitest. Không dependency mới.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-21-model-router-design.md` — implement đúng spec.
- IPC channel mới không hardcode; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- System messages tiếng Việt prefix `[meow]`.
- Chỉ bind `127.0.0.1`; gateway yêu cầu Bearer key do user đặt.
- Mỗi task có verification (typecheck hoặc unit test).
- Commit nhỏ mỗi task.

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `src/shared/types.ts` | Sửa | `GatewayConfig`, `RoutingStrategy`, `GatewayRequestLog`, `GatewayStatus` |
| `src/shared/ipc.ts` | Sửa | Channels `GatewayGetConfig/SaveConfig/ListLogs/ClearLogs` + `EventGatewayChanged`; AgentApi methods |
| `src/main/gateway/config.ts` | Mới | `GatewayConfigStore` (userData/gateway.json) + defaults |
| `src/main/gateway/log-store.ts` | Mới | Ghi/đọc/clear `userData/gateway-logs/*.jsonl` |
| `src/main/gateway/router.ts` | Mới | `selectAccount(accounts, health, model, strategy)` — filter + sort |
| `src/main/gateway/forward.ts` | Mới | Gọi upstream OpenAI-compatible + relay SSE |
| `src/main/gateway/server.ts` | Mới | Node http server: auth, /v1/models, /v1/chat/completions, ghi log |
| `src/main/gateway/manager.ts` | Mới | `GatewayManager`: start/stop/config, health map, emit events |
| `src/main/index.ts` | Sửa | Init `gateway`; wire IPC; start/stop lifecycle |
| `src/preload/index.ts` | Sửa | Expose `gateway.*` methods |
| `src/renderer/.../components/Sidebar.tsx` | Sửa | Footer → dropdown 2 mục (Model Router / Settings) |
| `src/renderer/.../components/ModelRouter/ModelRouterDialog.tsx` | Mới | Modal full-height + sub-nav |
| `src/renderer/.../components/ModelRouter/AccountsTab.tsx` | Mới | (move từ settings/ConnectionsTab.tsx) |
| `src/renderer/.../components/ModelRouter/GatewayTab.tsx` | Mới | Bật/tắt + config + copy endpoint |
| `src/renderer/.../components/ModelRouter/QuotaTab.tsx` | Mới | Usage từng account |
| `src/renderer/.../components/ModelRouter/LogsTab.tsx` | Mới | Bảng request logs |
| `src/renderer/.../components/settings/SettingsDialog.tsx` | Sửa | Gỡ Connections tab |
| `src/renderer/.../components/App.tsx` | Sửa | State `showModelRouter` + render dialog |
| `src/renderer/src/styles.css` | Sửa | Style dropdown footer + ModelRouter |
| `tests/unit/gateway-router.test.ts` | Mới | Unit test routing/health/coldown/quota-reserve |
| `tests/unit/gateway-server.test.ts` | Mới | Unit test server auth + forward relay (mock fetch) |
| `tests/unit/ipc-contract.test.ts` | Sửa | Thêm gateway methods |

## Phase 1 — Gateway core (main process)

- [x] **T1.1** `src/shared/types.ts`: `RoutingStrategy`, `GatewayConfig`, `GatewayRequestLog`,
  `GatewayStatus = GatewayConfig & { running: boolean; actualPort: number | null }`.
- [x] **T1.2** `src/shared/ipc.ts`: Channels `GatewayGetConfig`, `GatewaySaveConfig`, `GatewayListLogs`,
  `GatewayClearLogs`, `EventGatewayChanged`; AgentApi `getGatewayConfig()`, `saveGatewayConfig(cfg)`,
  `listGatewayLogs(limit?)`, `clearGatewayLogs()`, `onGatewayChanged(cb)`.
- [x] **T1.3** `src/main/gateway/config.ts`: `GatewayConfigStore` — load/save `userData/gateway.json`,
  defaults `{ enabled: false, port: 1480, apiKey: '', routingStrategy: 'auto', coldownSeconds: 300,
  quotaReservePercent: 10 }`.
- [x] **T1.4** `src/main/gateway/log-store.ts`: `append(entry)`, `list(limit)`, `clear()` — file
  `userData/gateway-logs/<yyyy-mm-dd>.jsonl` (1 JSON/line).
- [x] **T1.5** `src/main/gateway/router.ts`: `selectAccount(accounts, health, opts)`:
  - filter: có token/key (qua `getSecrets`), không bị health block
  - quota reserve: `remaining < reserve%` → đẩy cuối
  - sort theo strategy (`auto`: remaining desc → lastUsed asc → plan tier desc; `random`; `single`
    → account active; `quota-high-first`/`quota-low-first`/`expiry-soon-first`)
  - return account | null.
- [x] **T1.6** `src/main/gateway/forward.ts`: `chatCompletions(account, secrets, body, signal)` — build
  upstream URL (codex: `apiBaseUrl` hoặc mặc định; api-key: `apiBaseUrl`), set
  `Authorization: Bearer <token/apiKey>`, forward body, relay SSE nếu `stream:true`. `listModels()`.
- [x] **T1.7** `src/main/gateway/server.ts`: `createGatewayServer(deps)` — http server bind 127.0.0.1:
  - Bearer auth với `cfg.apiKey` (thiếu/sai → 401; tắt → 503)
  - `GET /v1/models` → gộp model list
  - `POST /v1/chat/completions` → router.select → forward → ghi log; 429/5xx → health block
  - trả `{ port }` actual (EADDRINUSE → error).
- [x] **T1.8** `src/main/gateway/manager.ts`: `GatewayManager` — start/stop server theo config,
  health map `Map<accountId, { blockedUntil }>`, `getStatus()`, emit `EventGatewayChanged`.
- [x] **T1.9** Wire `src/main/index.ts`: init `gateway` (dir userData), IPC handlers `gateway:*`,
  start/stop lifecycle (start khi app ready nếu enabled; stop before-quit).
- [x] **T1.10** `src/preload/index.ts`: expose `gateway.*`.
- **Verify T1**: typecheck pass; test router + server (T3.1-T3.2 sớm).

## Phase 2 — UI

- [x] **T2.1** `src/renderer/.../components/Sidebar.tsx`: footer → dropdown 2 mục (Model Router /
  Settings), portal + click-ngoài/Escape (theo pattern project-menu hiện có). Props thêm
  `onOpenModelRouter`.
- [x] **T2.2** `src/renderer/.../components/ModelRouter/AccountsTab.tsx`: move nguyên nội dung
  `settings/ConnectionsTab.tsx` (đổi path import).
- [x] **T2.3** `src/renderer/.../components/ModelRouter/GatewayTab.tsx`: toggle + port + gateway API
  key + routing dropdown + coldown + quota reserve; copy endpoint; hiển thị `GatewayStatus`.
- [x] **T2.4** `src/renderer/.../components/ModelRouter/QuotaTab.tsx`: danh sách account (email/plan/
  quota bar/refresh) — tái dùng `QuotaBar` logic từ AccountsTab.
- [x] **T2.5** `src/renderer/.../components/ModelRouter/LogsTab.tsx`: bảng ts/account/model/status/
  tokens/ms + Refresh + Clear.
- [x] **T2.6** `src/renderer/.../components/ModelRouter/ModelRouterDialog.tsx`: modal full-height +
  sub-nav 4 tab; lắng nghe `onConnectionsChanged` + `onGatewayChanged`.
- [x] **T2.7** `App.tsx`: state `showModelRouter`, render dialog; truyền `onOpenModelRouter` vào Sidebar.
- [x] **T2.8** `SettingsDialog.tsx`: gỡ import + tab Connections; xoá file
  `settings/ConnectionsTab.tsx`.
- [x] **T2.9** `styles.css`: style dropdown footer + ModelRouter dialog + tabs.
- **Verify T2**: typecheck pass; `npm run dev` mở dropdown → popup hoạt động.

## Phase 3 — Tests + polish

- [x] **T3.1** `tests/unit/gateway-router.test.ts`: select theo strategy, coldown block/unblock,
  quota reserve xếp sau, single→active, empty→null.
- [x] **T3.2** `tests/unit/gateway-server.test.ts`: auth 401, tắt→503, forward mock fetch 200 + 429→
  health block, log ghi đúng (dùng tmpdir).
- [x] **T3.3** `tests/unit/ipc-contract.test.ts`: thêm 4 gateway methods + 1 event.
- [x] **T3.4** `npm run typecheck` + `npm test` pass (trừ officecli pre-existing); `npm run build` pass.
