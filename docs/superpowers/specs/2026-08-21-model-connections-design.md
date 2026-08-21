# Model Connections — Trung tâm đăng nhập & kết nối model: Design Spec

Ngày: 2026-08-21 · Trạng thái: chờ duyệt

> Nguồn tham chiếu: `github.com/jlcodes99/cockpit-tools` (Tauri/Rust) — công cụ quản lý đa tài
> khoản cho các AI IDE/CLI (Codex, Claude, Copilot, Cursor, Windsurf, Trae, Grok, Zed...).
> Port **concept + cơ chế** sang stack meow-coding: Electron + TypeScript strict + electron-vite +
> Vitest + Vercel AI SDK. Không copy code Rust; tái hiện luồng OAuth, account switch/injection,
> quota monitoring, encrypted vault bằng TS.

## 1. Mục tiêu

Thay thế cách kết nối "thuần tuý" hiện tại (gõ API key vào config JSON) bằng **Model Connections
Center**: một nơi quản lý đăng nhập/auth/kết nối tới các nhà cung cấp model mà meow-coding spawn:

- **Claude Code** — đăng nhập OAuth, nhiều account, chuyển đổi account, xem plan/quota.
- **Codex** — đăng nhập OAuth (auth.openai.com), nhiều account, chuyển đổi (ghi `~/.codex/auth.json`),
  xem quota.
- **API key vault** — kho API key mã hoá (safeStorage) cho các provider native (Anthropic, OpenAI,
  Google, OpenAI-compatible, relay), thay cho việc để key plaintext trong settings.
- **Quota monitoring** — truy vấn plan/usage/period theo account, cảnh báo gần hết hạn qua
  notification-service (prefix `[meow]`).

> **Ghi chú quyết định:** Tính năng ChatGPT web (provider `chatgpt-web`) đã bị **gỡ hoàn toàn**
> khỏi meow-coding (theo yêu cầu người dùng) trước khi module Connections được xây — không còn code
> `src/main/chatgpt-web/`, không còn Channels/IPC, tab Settings, tests tương ứng. ProviderId không bao
> gồm `chatgpt-web`.

Yêu cầu từ người dùng: **dùng thật được ngay**, không MVP. Kiến trúc thiết kế sẵn sàng cho các
provider khác sau này (Copilot, Grok, Cursor, ...) — mỗi provider là một adapter độc lập.

## 2. Quyết định từ brainstorm

| Chủ đề | Quyết định |
|---|---|
| Nguồn tham chiếu | cockpit-tools — port concept OAuth login, account store, switch/injection, quota |
| Vault secrets | Electron `safeStorage` (dùng OS keychain: DPAPI/Keychain/libsecret) — an toàn hơn PBKDF2 tự quản của cockpit |
| Account store | Bắt chước cockpit: index file + 1 file 1 account; secrets mã hoá, metadata plaintext |
| Claude switch | Mỗi account một config dir riêng + env `CLAUDE_CONFIG_DIR` khi spawn — không đụng `~/.claude` thật của user |
| Codex switch | Merge token vào `~/.codex/auth.json` (giữ field cũ, atomic write) — bắt buộc vì codex CLI đọc file này |
| Native agent | ProviderSettings giữ `keyRef` trỏ vào vault thay vì key plaintext; resolve lúc runtime qua vault |
| OAuth Claude | Luồng authorization-code + PKCE, redirect về `platform.claude.com` — user dán code từ URL (manual, như cockpit) |
| OAuth Codex | Authorization-code + PKCE + local callback server port 1455, header `User-Agent`/`originator` mô phỏng `codex_vscode` |
| Quota alert | Ngưỡng 90% + cooldown 5 phút + refresh scheduler 30–60 phút (như cockpit) |

## 3. Kiến trúc tổng thể

```
src/main/connections/
├── types.ts            # ProviderAccount, QuotaInfo, LoginState, ConnectionSummary (shared-style)
├── vault.ts            # safeStorage wrapper: encrypt/decrypt secrets (chỉ main process)
├── store.ts            # ConnectionsStore: index + per-account files + vault
├── oauth.ts            # helpers: PKCE (S256), local callback server, device/manual code flow
├── manager.ts          # ConnectionsManager: orchestrator + event emit + quota scheduler
├── quota.ts            # refresh quota theo provider, alert cooldown
└── providers/
    ├── claude.ts       # Claude OAuth login, credentials write, profile/usage query, spawn env
    ├── codex.ts        # Codex OAuth login, auth.json merge, quota query, spawn env
    └── apikey.ts       # API key vault CRUD + test connection
```

Renderer:

```
src/renderer/src/components/settings/ConnectionsTab.tsx   # tab mới trong SettingsDialog
src/renderer/src/components/settings/connections/          # sub-view per provider + modals
```

IPC — thêm vào `Channels` (không hardcode string):

```
connections:list            -> ConnectionProviderStatus[]   (danh sách provider + accounts + quota)
connections:login-start     (provider, mode) -> LoginStart  (loginId, authUrl, expiresIn)
connections:login-cancel    (loginId)
connections:login-submit    (loginId, code)  -> ProviderAccount   // claude manual paste code
connections:switch          (provider, accountId) -> void
connections:remove          (accountId)
connections:import          (provider, json) -> ProviderAccount
connections:api-key-save    (input) -> ProviderAccount
connections:api-key-test    (accountId) -> { ok, error? }
connections:quota-refresh   (provider?, accountId?) -> void
events: connections:changed, connections:login-progress, connections:quota-alert
```

## 4. Data model

```ts
export type ProviderId = 'claude' | 'codex' | 'apikey'

export type AuthMode = 'oauth' | 'api-key' | 'imported' | 'desktop'

export interface ConnectionSecrets {          // encrypted trong vault
  tokens?: { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number; lastRefresh: number }
  apiKey?: string
}

export interface ProviderAccount {
  id: string                 // uuid
  provider: ProviderId
  name: string               // email hoặc label
  authMode: AuthMode
  active: boolean            // account active của provider (1 per provider)
  createdAt: number
  lastUsed: number
  // credential metadata (không chứa secret)
  apiBaseUrl?: string
  apiKeyField?: string       // ANTHROPIC_API_KEY | ANTHROPIC_AUTH_TOKEN | OPENAI_API_KEY | ...
  extraEnv?: Record<string, string>
  // profile từ provider
  profile?: { email?: string; name?: string; orgName?: string; planType?: string; avatarUrl?: string }
  quota?: QuotaInfo
  quotaError?: string
  // per-provider
  claudeConfigDir?: string   // userData/connections/claude/<id>/ (đã tạo, chứa .credentials.json)
  codexAuthMode?: 'oauth' | 'apikey'
  tags?: string[]
  note?: string
}

export interface QuotaInfo {
  provider: ProviderId
  planType?: string
  periodStart?: string
  periodEnd?: string
  used?: number
  limit?: number
  remaining?: number
  raw?: unknown              // payload gốc (debug)
  refreshedAt: number
}

export interface ConnectionProviderStatus {
  provider: ProviderId
  accounts: ProviderAccount[]
  activeAccountId: string | null
  login?: LoginStart | null  // đang login dở
}

export interface LoginStart {
  loginId: string
  provider: ProviderId
  authUrl: string
  mode: 'browser-code' | 'callback'
  expiresIn: number
}
```

## 5. Luồng đăng nhập

### 5.1 Claude (authorization-code + PKCE, manual code paste)

Các endpoint (verify từ cockpit `src-tauri/src/modules/claude_account.rs`):

- Authorize: `https://claude.com/cai/oauth/authorize`
  - `client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e`, `response_type=code`,
    `redirect_uri=https://platform.claude.com/oauth/code/callback`,
    `scope=org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`,
    `code_challenge=S256`, `state=<random>`
- Token: `https://platform.claude.com/v1/oauth/token` (grant_type=`authorization_code`, PKCE verifier)
- Profile: `https://api.anthropic.com/api/oauth/profile` (Bearer, beta header `oauth-2025-04-20`)
- Usage: `https://api.anthropic.com/api/oauth/usage` (Bearer, beta header `oauth-2025-04-20`)
- Refresh: token endpoint với `refresh_token` grant

Luồng:

1. `login-start('claude')` → sinh PKCE verifier/challenge + state, lưu pending login, trả `authUrl`.
2. UI mở browser (`shell.openExternal`) → user đăng nhập Anthropic → redirect về
   `platform.claude.com/oauth/code/callback?code=...&state=...` → **user copy `code` từ URL** dán vào
   app (giống cockpit — không thể bắt callback vì redirect không phải localhost).
3. `login-submit(loginId, code)` → đổi code lấy tokens → fetch profile (email, planType) → tạo
   account → tạo `claudeConfigDir` + ghi `.credentials.json` (format Claude Code, xem §5.1.1) →
   set active → emit `connections:changed`.

#### 5.1.1 Format `.credentials.json` (Claude Code CLI)

```json
{
  "hasCompletedOnboarding": true,
  "oauthAccount": {
    "idToken": "<id_token>",
    "accessToken": "<access_token>",
    "refreshToken": "<refresh_token>",
    "lastRefresh": 1720000000000
  }
}
```

Ghi vào `claudeConfigDir` của account. Khi spawn `claude`, set env `CLAUDE_CONFIG_DIR=<dir>` — CLI
đọc credentials từ đây, không đụng `~/.claude` thật của user. Token hết hạn → refresh qua
`/v1/oauth/token` trước khi ghi lại.

Nếu Anthropic đổi format (chuyển Keychain, thêm field), fallback: spawn với env
`ANTHROPIC_AUTH_TOKEN=<access_token>` (+ `ANTHROPIC_BASE_URL` nếu relay) — không cần file.

#### 5.1.2 Import

- **Từ JSON**: chấp nhận `{ oauthAccount: {...} }` hoặc `{ tokens: {...}, email }` → tạo account.
- **API key**: `{ apiKey, name?, baseUrl?, apiKeyField? }` → `apiKeyField` mặc định `ANTHROPIC_API_KEY`
  nếu baseUrl là official Anthropic, ngược lại `ANTHROPIC_AUTH_TOKEN` (relay). Test key bằng gọi
  `/v1/messages` (1 token) trước khi lưu.

### 5.2 Codex (authorization-code + PKCE + local callback)

Các endpoint (verify từ cockpit `src-tauri/src/modules/codex_oauth.rs`):

- Authorize: `https://auth.openai.com/oauth/authorize`
  - `client_id=app_EMoamEEZ73f0CkXaXp7hrann`,
    `scope=openid profile email offline_access api.connectors.read api.connectors.invoke`,
    `redirect_uri=http://127.0.0.1:1455/callback`, PKCE S256, `state`
  - Header: `User-Agent: codex_vscode/0.146.0`, `originator: codex_vscode` (auth.openai.com yêu cầu)
- Token: `https://auth.openai.com/oauth/token` (authorization_code + PKCE; refresh_token grant)
- Quota: `https://chatgpt.com/backend-api/wham/usage`,
  `https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27`,
  `https://chatgpt.com/backend-api/subscriptions` (Bearer + UA `codex_vscode/0.146.0`)

Luồng:

1. `login-start('codex')` → mở local HTTP server trên port 1455 (nếu bận → báo lỗi `CODEX_OAUTH_PORT_IN_USE`),
   sinh PKCE/state, trả `authUrl`.
2. UI mở browser → user đăng nhập OpenAI → callback `http://127.0.0.1:1455/callback?code=...` → local
   server nhận code → `login-submit` (hoặc tự động hoàn tất luôn, emit event).
3. Đổi code lấy tokens → decode `id_token` (JWT payload: email, `https://api.openai.com/auth` claims,
   `account_id`) → tạo account → **switch** (ghi `~/.codex/auth.json`) → set active.

#### 5.2.1 Format `~/.codex/auth.json` (Codex CLI)

```json
{
  "auth_mode": "oauth",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": 1720000000000
}
```

- Switch = **merge** vào file hiện có (giữ các key lạ khác; atomic write qua temp file + rename —
  tái dùng pattern `atomic_write` của cockpit). Trước khi ghi, backup file gốc (nếu không phải do
  meow tạo) vào `userData/connections/codex/auth.json.backup`.
- API-key account: `{ "auth_mode": "apikey", "OPENAI_API_KEY": "sk-..." }`.
- Remove/Logout account đang active → restore backup (nếu có) hoặc xoá field meow đã merge.

### 5.3 API key vault (native agent)

- `ConnectionsStore.saveSecret(provider, keyId, secret)` → mã hoá safeStorage, lưu vào vault file.
- ProviderSettings trong `MeowSettings.providers[]` thêm field `keyRef?: string` (thay vì `apiKey`
  plaintext). `connectProvider()` hiện tại: nếu có apiKey truyền vào → lưu vault + set keyRef; nếu
  chỉ keyRef → giữ nguyên.
- `resolveAgentConfig()` đọc `keyRef` → vault.getSecret → apiKey thực (chỉ tồn tại trong main
  process memory khi resolve).
- UI ProvidersTab: hiển thị "key đã lưu (mã hoá)" thay vì ô nhập key mỗi lần; nút Test connection.
- Vault file: `userData/connections/vault.json` — map `keyRef -> base64(ciphertext)`.

## 6. Tích hợp spawn agent (PTY)

- `PtyManager.start(agentId, name, command, args, cwd, env?)` — thêm param `env` (merge với
  `process.env`, override).
- `index.ts startAgent()`: trước khi spawn, gọi `connections.resolveSpawnEnv(agent.templateId)`:
  - template `claude` → env `CLAUDE_CONFIG_DIR` của account Claude active (hoặc
    `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` nếu account là api-key/relay)
    + `extraEnv`.
  - template `codex` → env `OPENAI_API_KEY` (nếu account api-key) hoặc không cần (auth.json đã được
    switch ghi). Có thể thêm `CODEX_HOME` nếu account cần isolation — v1 dùng auth.json thật.
  - template `opencode`/khác → chưa map (bỏ qua).
- `AgentConfig` thêm optional `accountId?: string` — override account active cho agent đó (UI chọn
  account trong AddAgentDialog / Agent header). V1: mặc định dùng account active.

## 7. Quota monitoring

- **Claude**: `GET /api/oauth/usage` + `/api/oauth/profile` → planType, period, used/limit.
- **Codex**: `GET chatgpt.com/backend-api/wham/usage` (shape: `{ is_eligible, is_in_grace_period, usage, plan_type, ... }`)
  + `subscriptions`.
- Refresh: khi mở Connections tab, sau login/switch, scheduler 45 phút. Chỉ refresh account có token
  còn hạn (skew 5 phút như cockpit); token sắp hết → refresh token trước.
- Alert: `used/limit >= 0.9` hoặc `remaining < 5%` → `notification-service.show('[meow] Quota ...')`,
  cooldown 300 giây/account. Quota lỗi → `quotaError` hiển thị trong UI, không spam.

## 8. Security

- Chỉ main process truy cập vault (safeStorage); renderer chỉ nhận metadata + secret đã mask
  (`sk-…abcd`).
- Không expose `ipcRenderer`; không ghi plaintext token vào settings JSON.
- Ngoại lệ có chủ đích: `~/.codex/auth.json` (codex CLI bắt buộc đọc file này) — ghi kèm backup,
  xoá khi logout account.
- `safeStorage.isEncryptionAvailable() === false` (Linux thiếu keyring) → hiển thị cảnh báo, không
  tự fallback plaintext.
- OAuth state/PKCE verifier chỉ tồn tại trong memory, TTL 300s.

## 9. Constraints (theo AGENTS.md)

- IPC: chỉ dùng `Channels` từ `src/shared/ipc.ts`, không hardcode.
- Data bền: `userData/` (templates.json, workspaces.json...); log qua `log-manager`.
- Chỉ main spawn/kill process; renderer qua `window.api`.
- System messages từ main dùng tiếng Việt, prefix `[meow]`.
- Không comment thừa; giải thích quyết định phức tạp (OAuth headers, auth.json merge).
- `npm run typecheck` + `npm test` bắt buộc pass trước khi xong.

## 10. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Anthropic/OpenAI đổi OAuth client_id/endpoint | Constants tập trung trong provider adapter; note version CLI tương ứng (như cockpit cập nhật theo CLI) |
| Claude Code đổi format credentials (Keychain) | Fallback env `ANTHROPIC_AUTH_TOKEN`; test thủ công trên Windows trước release |
| `auth.json` bị codex CLI ghi đè khi user login bằng tay | Switch luôn merge + backup; account active lưu snapshot tokens để re-apply |
| Web chat ChatGPT đổi DOM (provider đang tạm tắt) | Connections chỉ quản lý profile; không phụ thuộc DOM |
| safeStorage không available (Linux) | Cảnh báo rõ ràng, vault vô hiệu hoá phần encrypt |

## 11. Phạm vi ngoài (v2 — thiết kế sẵn, chưa làm)

- Provider khác: GitHub Copilot, Grok CLI, Cursor, Windsurf, Trae (adapter mới, không đổi core).
- Multi-instance CLI (nhiều profile chạy song song như cockpit `*_instance.rs`).
- Wakeup tasks, 2FA, account groups, export/import hàng loạt.
- Quota cho provider native (OpenAI/Google usage API).
