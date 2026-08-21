# Model Connections — Trung tâm đăng nhập & kết nối model: Implementation Plan

Trạng thái: chờ duyệt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây "Model Connections Center" trong meow-coding: quản lý đăng nhập/auth/kết nối nhiều
provider model (Claude, Codex, ChatGPT web, API key vault) + quota monitoring, thay thế cách kết nối
gõ API key hiện tại. Port cơ chế từ cockpit-tools theo spec
`docs/superpowers/specs/2026-08-21-model-connections-design.md`.

**Architecture:** Module mới `src/main/connections/` (vault safeStorage + store + manager +
provider adapters), mở rộng `pty-manager`/`startAgent` để inject env theo account active, thêm
Channels IPC mới, tab `Connections` trong SettingsDialog.

**Tech Stack:** TypeScript strict, Electron `safeStorage`, Vitest. KHÔNG thêm dependency mới cho
phần OAuth (dùng `fetch`/`http` Node built-in); `playwright-core` đã có cho ChatGPT web.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-21-model-connections-design.md` — implement đúng spec.
- IPC channel mới không hardcode string; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- System messages từ main tiếng Việt, prefix `[meow]` (AGENTS.md).
- Chỉ main process đụng secret; renderer chỉ nhận metadata + masked secret.
- Mỗi task có verification (typecheck hoặc unit test chạy được).
- Commit nhỏ, mỗi task 1 commit nếu được.

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `src/shared/types.ts` | Sửa | ProviderAccount, QuotaInfo, ConnectionProviderStatus, LoginStart, ConnectionState |
| `src/shared/ipc.ts` | Sửa | Channels `connections:*` + event channels |
| `src/main/connections/types.ts` | Mới | type nội bộ + constants (endpoints, client_id) |
| `src/main/connections/vault.ts` | Mới | safeStorage wrapper |
| `src/main/connections/store.ts` | Mới | ConnectionsStore: index + per-account + vault file |
| `src/main/connections/oauth.ts` | Mới | PKCE helper, local callback server, manual-code flow state |
| `src/main/connections/quota.ts` | Mới | refresh quota + alert cooldown |
| `src/main/connections/providers/claude.ts` | Mới | Claude adapter |
| `src/main/connections/providers/codex.ts` | Mới | Codex adapter |
| `src/main/connections/providers/apikey.ts` | Mới | API key vault adapter |
| `src/main/connections/manager.ts` | Mới | ConnectionsManager + resolveSpawnEnv |
| `src/main/pty-manager.ts` | Sửa | `start(..., env?)` |
| `src/main/index.ts` | Sửa | Wire ConnectionsManager + IPC handlers + startAgent env resolution |
| `src/main/meow-agent-manager.ts` | Sửa | connectProvider lưu vault + keyRef; resolveAgentConfig đọc vault |
| `src/main/agent/config.ts` | Sửa | ProviderSettings thêm `keyRef`; resolve key từ vault |
| `src/preload/index.ts` | Sửa | Expose `connections.*` methods |
| `src/renderer/.../settings/ConnectionsTab.tsx` | Mới | Tab Connections trong SettingsDialog |
| `src/renderer/.../settings/connections/*` | Mới | Sub-view per provider + modals |
| `tests/unit/connections-store.test.ts` | Mới | Unit test vault/store |

## Phase 1 — Vault + Store + Manager skeleton + IPC

- [x] **T1.1** `src/shared/types.ts`: thêm `ProviderId`, `AuthMode`, `ConnectionSecrets`,
  `ProviderAccount`, `QuotaInfo`, `LoginStart`, `ConnectionProviderStatus`, `ConnectionState`.
- [x] **T1.2** `src/shared/ipc.ts`: Channels `ConnectionsList/LoginStart/LoginCancel/LoginSubmit/
  Switch/Remove/Import/ApiKeySave/ApiKeyTest/QuotaRefresh` + `EventConnectionsChanged`,
  `EventConnectionsLoginProgress`, `EventConnectionsQuotaAlert`; type `ConnectionsChangedEvent`.
- [x] **T1.3** `src/main/connections/vault.ts`: `Vault` class — `saveSecret(ref, plaintext)`,
  `getSecret(ref)`, `deleteSecret(ref)`, `mask(secret)`; dùng `safeStorage`; throw nếu không
  available. File `userData/connections/vault.json` (map ref → base64 ciphertext).
- [x] **T1.4** `src/main/connections/store.ts`: `ConnectionsStore` — index
  `connections.json` + 1 file/account `accounts/<id>.json` (metadata plaintext, secrets qua vault
  theo ref `conn:<id>:<field>`); CRUD: list, get, upsert, remove, setActive (đảm bảo 1 active/provider).
- [x] **T1.5** `src/main/connections/manager.ts`: `ConnectionsManager` — list statuses, login state
  registry (TTL 300s), switch/remove/import dispatch theo provider adapter, `resolveSpawnEnv(templateId)`,
  emit events qua callback dep.
- [x] **T1.6** Wire vào `src/main/index.ts`: khởi tạo manager (dir `userData/connections`), đăng ký
  IPC handlers `connections:*`, `resolveSpawnEnv` trong `startAgent`.
- [x] **T1.7** `src/preload/index.ts`: expose `connections.*` theo `AgentApi`.
- [x] **T1.8** Unit test: vault round-trip (mock safeStorage), store CRUD + setActive unique.
- **Verify T1**: ✅ typecheck + `npm test` pass (trừ officecli-binary-manager pre-existing).

## Phase 2 — API key vault + native agent integration

- [x] **T2.1** `src/main/connections/providers/apikey.ts`: `saveApiKeyAccount(input)` — lưu secret vào
  vault, tạo `ProviderAccount` (provider='apikey', authMode='api-key'); `testConnection(accountId)` —
  gọi endpoint provider (Anthropic `/v1/messages` 1 token / OpenAI `/v1/models` / openai-compatible)
  tuỳ `apiBaseUrl`+`apiKeyField`.
- [x] **T2.2** `src/main/agent/config.ts`: `ProviderSettings` thêm `keyRef?: string`;
  `resolveAgentConfig` nhận dep `getSecret(ref)` và ưu tiên `keyRef` khi resolve apiKey.
- [x] **T2.3** `src/main/meow-agent-manager.ts`: `connectProvider(providerId, apiKey, baseUrl)` → lưu
  vault (ref `provider:<id>`), set `keyRef`, không giữ apiKey plaintext trong settings; dep
  `connections` được inject (constructor).
- [x] **T2.4** ProvidersTab.tsx: hiển thị trạng thái key đã lưu + nút "Replace key"/"Disconnect";
  khi nhập key mới → `connectProvider` cũ.
- **Verify T2**: ✅ typecheck + test pass; connect provider → key vào vault (keyRef), chỉ fallback
  plaintext khi safeStorage unavailable.

## Phase 3 — Claude adapter

- [x] **T3.1** `src/main/connections/oauth.ts`: PKCE (verifier 43–128 chars, S256 challenge),
  `startManualCodeLogin(provider, authUrlBuilder)` → pending state; `submitCode(loginId, code)`
  → callback lấy token.
- [x] **T3.2** `providers/claude.ts`:
  - `loginStart()` → authorize URL (constants §5.1 spec).
  - `exchangeCode(code, verifier)` → POST token endpoint (authorization_code, PKCE) → tokens.
  - `fetchProfile(tokens)` → `/api/oauth/profile`; `fetchUsage(tokens)` → `/api/oauth/usage`.
  - `refreshTokens(tokens)` → token endpoint refresh_token grant.
  - `writeCredentialsDir(account)` → tạo `claudeConfigDir` + ghi `.credentials.json` (§5.1.1),
    ghi `settings.json` rỗng.
  - `buildSpawnEnv(account)` → `CLAUDE_CONFIG_DIR` (oauth) hoặc `ANTHROPIC_API_KEY`/
    `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` (api-key/relay) + extraEnv.
  - `importFromJson(json)` (oauthAccount shape), `importApiKey(input)` (+ test key qua `/v1/messages`).
- [x] **T3.3** Manager: wire claude adapter; `resolveSpawnEnv('claude')` → active account →
  `buildSpawnEnv`.
- [x] **T3.4** `pty-manager.ts`: `start(..., env?: Record<string,string>)` merge vào `process.env`.
- [x] **T3.5** `index.ts startAgent`: resolve env theo templateId rồi truyền xuống pty.start.
- [x] **T3.6** Unit test: PKCE (vector cố định), auth.json/credentials builder, quota parse
  (fixture JSON).
- **Verify T3**: typecheck + test pass. Thủ công (Windows): login Claude → paste code → account
  active; spawn agent template `claude` → CLI dùng đúng account (kiểm tra qua `/status` hoặc log).

## Phase 4 — Codex adapter

- [x] **T4.1** `providers/codex.ts`:
  - `loginStart()` → local callback server port 1455 (http module; nếu bận → lỗi
    `CODEX_OAUTH_PORT_IN_USE`) + authorize URL (§5.2).
  - `exchangeCode`, `refreshTokens` → token endpoint; decode `id_token` JWT payload → email +
    account_id.
  - `mergeAuthFile(baseDir, account)` → đọc `~/.codex/auth.json` (nếu có), merge theo §5.2.1,
    atomic write (temp + rename), backup bản gốc nếu chưa có backup.
  - `removeAuthAccount()` → restore backup / xoá field meow.
  - `fetchQuota(tokens)` → `chatgpt.com/backend-api/wham/usage` + `subscriptions` (Bearer + UA).
  - `importAuthJson(json)` — chấp nhận auth.json từ máy khác.
- [x] **T4.2** Manager: wire codex adapter; `resolveSpawnEnv('codex')` → env `OPENAI_API_KEY` nếu
  api-key account (oauth account không cần env — auth.json đã có).
- [x] **T4.3** Unit test: auth.json merge (giữ field lạ, set OPENAI_API_KEY null), JWT decode,
  quota parse fixture.
- **Verify T4**: typecheck + test pass. Thủ công: login Codex (browser + callback) → `~/.codex/auth.json`
  có tokens → spawn `codex` chạy đúng account.

## Phase 5 — Quota monitoring + Connections UI

- [x] **T5.1** `src/main/connections/quota.ts`: refresh theo provider (claude usage/profile, codex
  wham/subscriptions), scheduler 45 phút, chỉ refresh token còn hạn (skew 5 phút, refresh token nếu
  cần), alert ngưỡng 90% + cooldown 300s → `notification-service`.
- [x] **T5.2** Wire quota vào manager + IPC `connections:quota-refresh` + event
  `connections:quota-alert`.
- [x] **T5.3** `ConnectionsTab.tsx` + sub-views: provider list (Claude, Codex, API keys), mỗi provider
  hiển thị accounts (email, authMode, planType, quota progress bar, active badge), nút: Login
  (Claude: browser+paste-code modal; Codex: browser+auto callback), Import JSON, Add API key, Switch
  (set active), Logout/Remove. Masked secret hiển thị.
- [x] **T5.4** Register tab trong `SettingsDialog.tsx`.
- **Verify T5**: typecheck + test pass. Thủ công: login đủ loại, xem quota, switch account, spawn
  agent dùng đúng account, alert quota hiển thị `[meow]`.

## Phase 6 — Polish + test toàn diện

- [x] **T6.1** Test edge cases: port 1455 bận, OAuth timeout, token hết hạn, safeStorage off,
  auth.json không tồn tại, restore backup.
- [x] **T6.2** Cập nhật `docs/` nếu cần (changelog), đảm bảo README nêu tính năng mới.
- [x] **T6.3** `npm run typecheck` + `npm test` pass; nếu ảnh hưởng e2e → `npm run build && npm run e2e`.
