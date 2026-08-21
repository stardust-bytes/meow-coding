# Model Router — Popup quản lý account + local gateway OpenAI-compatible: Design Spec

Ngày: 2026-08-21 · Trạng thái: chờ duyệt

> Nguồn tham chiếu: cockpit-tools `CodexApiServicePage` + `codex_local_access.rs` (gateway local
> OpenAI-compatible bind `127.0.0.1`, routing nhiều account theo strategy + coldown + health).
> Meow Coding port concept bằng Node `http` thuần trong main process (Approach A — đã duyệt), không
> bundle sidecar, không thêm dependency.

## 1. Mục tiêu

Đưa toàn bộ tính năng quản lý account + local gateway của cockpit-tools vào Meow Coding dưới dạng
**popup Model Router chuyên trách**, mở từ dropdown ở footer sidebar trái:

- Quản lý đa account Claude/Codex/API keys (chuyển nguyên tab Connections hiện tại vào đây).
- **Local gateway OpenAI-compatible** (`http://127.0.0.1:<port>/v1`) — agent CLI trong meow, native
  meow agent, và app ngoài đều có thể trỏ vào.
- **Auto-switch / routing** giữa các account khi account đang dùng hết quota hoặc bị rate-limit
  (bật/tắt được; khi tắt thì switch bằng tay qua nút Switch).
- **Quota view** + **request logs** lưu trên disk.

**Không ảnh hưởng providers hiện tại**: Providers tab (Anthropic/OpenAI-compatible) giữ nguyên;
gateway là ngã rẽ tự chọn — bật thì ai trỏ vào thì dùng, không bật thì mọi thứ như cũ. Native agent
**không tự thêm** provider gateway; user tự nhập base URL nếu muốn.

## 2. Quyết định từ brainstorm

| Chủ đề | Quyết định |
|---|---|
| Kiến trúc gateway | Node `http` server trong main process (Approach A) — không sidecar/binary ngoài |
| UI form | Popup modal **full-height** mở từ dropdown footer; sub-nav 4 tab (Accounts/Gateway/Quota/Logs) |
| Dropdown footer | Thay nút Settings bằng dropdown 2 mục: **Model Router** + **Settings** (không badge trạng thái) |
| Tab Connections cũ | **Gỡ khỏi Settings** — chuyển toàn bộ vào Accounts tab của Model Router |
| Scope gateway | Chỉ route **OpenAI-compatible** accounts: Codex (OAuth/API key) + API keys openai-compatible. Claude OAuth không qua gateway (spawn trực tiếp như cũ) |
| Routing strategy | `auto` (mặc định) / `random` / `single` / `quota-high-first` / `quota-low-first` / `expiry-soon-first` |
| Auto-switch | `strategy != 'single'` → gateway tự xoay account khi hết quota/bị block; `single` → luôn account active, switch tay qua nút |
| Coldown | 429/401/403/5xx → block account `coldownSeconds` (mặc định 300s); 2xx → reset health |
| Quota reserve | `quotaReservePercent` (mặc định 10%) — account gần hết quota xếp sau, không loại hẳn |
| Logs | Ghi `userData/gateway-logs/<yyyy-mm-dd>.jsonl`, xem trong Logs tab |
| Native agent gateway | Không tự thêm provider — user tự nhập base URL trong Providers tab |
| Port mặc định | 1480 (tránh xung đột 1455/3000) |

## 3. Kiến trúc

```
src/main/gateway/
├── config.ts         # GatewayConfig store (userData/gateway.json)
├── server.ts         # Node http server bind 127.0.0.1:port, auth Bearer apiKey
├── router.ts         # chọn account theo strategy + health/coldown + quota reserve
├── forward.ts        # gọi upstream OpenAI-compatible + relay streaming SSE
├── log-store.ts      # request logs → userData/gateway-logs/*.jsonl
└── manager.ts        # GatewayManager: start/stop, config, emit events
```

Renderer:

```
src/renderer/src/components/ModelRouter/
├── ModelRouterDialog.tsx   # modal full-height + sub-nav
├── AccountsTab.tsx         # (chuyển từ settings/ConnectionsTab.tsx)
├── GatewayTab.tsx          # bật/tắt + cấu hình + copy endpoint
├── QuotaTab.tsx            # usage từng account
└── LogsTab.tsx             # bảng request logs
src/renderer/src/components/Sidebar.tsx  # footer → dropdown Model Router + Settings
```

IPC — thêm vào `Channels`:

```
gateway:get-config            -> GatewayConfig
gateway:save-config           (GatewayConfig)
gateway:list-logs             (limit?) -> GatewayRequestLog[]
gateway:clear-logs            -> void
events: gateway:changed       (GatewayStatus)
```

`GatewayStatus = GatewayConfig & { running: boolean; actualPort: number | null }`

## 4. Data model

```ts
interface GatewayConfig {
  enabled: boolean
  port: number                    // mặc định 1480
  apiKey: string                  // user đặt, bắt buộc khi bật
  routingStrategy: RoutingStrategy
  coldownSeconds: number          // mặc định 300
  quotaReservePercent: number     // mặc định 10
}

type RoutingStrategy =
  | 'auto' | 'random' | 'single'
  | 'quota-high-first' | 'quota-low-first' | 'expiry-soon-first'

interface GatewayRequestLog {
  ts: number
  method: string
  path: string
  status: number
  accountId: string | null
  model: string | null
  durationMs: number
  tokensIn: number
  tokensOut: number
  error?: string
}
```

Account scope (dùng `ConnectionsStore` hiện có):

- **Codex** OAuth account → upstream `https://chatgpt.com/backend-api/codex/v1` (hoặc
  `https://api.openai.com/v1` theo account) + Bearer access token (từ vault).
- **Codex** API-key account → `OPENAI_API_KEY` + `apiBaseUrl` (mặc định `https://api.openai.com/v1`).
- **API key vault** account có `apiKeyField=OPENAI_API_KEY` hoặc base URL openai-compatible →
  dùng trực tiếp.
- Claude (OAuth/api-key) → **không** trong scope gateway (vẫn spawn trực tiếp).

## 5. Luồng gateway request

1. Client `POST http://127.0.0.1:<port>/v1/chat/completions` (hoặc `/v1/models`) với
   `Authorization: Bearer <gatewayApiKey>`.
2. Kiểm tra auth + cấu hình (nếu sai → 401; tắt → 503).
3. `router.select(model, body)`:
   - Filter: account có token/key; không bị health block; không có model mismatch (nếu account có
     model catalog).
   - Sort theo strategy (auto: quota remaining desc → lastUsed asc → plan tier desc).
   - Quota reserve: remaining < reserve% → xếp sau.
   - Trả account đầu tiên (hoặc null → 429 "no available account").
4. `forward`:
   - `GET /v1/models` → gộp model list từ các account khả dụng.
   - `POST /v1/chat/completions` → upstream với `Authorization: Bearer <account token>`, body giữ
     nguyên (stream/tools/max_tokens...). Relayed SSE nếu `stream: true`.
5. Ghi log (status, accountId, model, tokens, duration). Nếu status 429/401/403/5xx → health block
   account + coldown.

## 6. Health & coldown (auto-switch)

- `RuntimeAccountHealth { blockedUntil: number | null; lastError?: string }` giữ trong memory
  (GatewayManager).
- Block khi upstream trả 429/401/403/5xx (chỉ 429/5xx mới block — 401/403 báo cấu hình sai nhưng
  cũng block để tránh loop).
- Hết coldown → account quay lại vòng routing.
- Request 2xx → reset health.

## 7. UI chi tiết

### 7a. Sidebar footer → dropdown
```
<footer>
  <button anchor> ⚙ (icon Server/Route) </button>
  dropdown (portal, fixed):
    ▸ Model Router   → mở ModelRouterDialog
    ▸ Settings       → mở SettingsDialog (như cũ)
</footer>
```
Click ngoài / Escape đóng. Không badge trạng thái (đã duyệt "2 mục đơn giản").

### 7b. ModelRouterDialog — modal full-height + sub-nav

- **Accounts tab** = nội dung ConnectionsTab hiện tại (Claude Login/Import/+API key, Codex
  Login/Import/+API key, API Keys +Add key/Test) — di chuyển nguyên vẹn.
- **Gateway tab**:
  - Toggle bật/tắt; khi bật yêu cầu đặt gateway API key (nếu chưa có).
  - Endpoint hiển thị + nút Copy: `http://127.0.0.1:<port>/v1`.
  - Routing strategy dropdown, coldown (s), quota reserve (%).
  - Khi `single`: dropdown chọn account active (trong scope gateway).
- **Quota tab**: từng account — email, plan, usage bar (đã có `QuotaBar`), nút Refresh; auto refresh
  45 phút (QuotaMonitor hiện có).
- **Logs tab**: bảng ts/account/model/status/tokens/ms, nút Refresh + Clear (xóa file logs).

### 7c. Gỡ tab Connections khỏi SettingsDialog

- Xoá `ConnectionsTab` import + tab entry trong `SettingsDialog.tsx`.
- Xoá/move `settings/ConnectionsTab.tsx` → `components/ModelRouter/AccountsTab.tsx`.

## 8. Security

- Chỉ bind `127.0.0.1` (không expose mạng) — theo AGENTS.md.
- Gateway yêu cầu Bearer apiKey do user đặt; không tự sinh.
- Account token chỉ nằm trong vault (main process); gateway forward không ghi token vào log.
- Không ghi body request (chỉ metadata) vào log.

## 9. Constraints (theo AGENTS.md)

- IPC chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- Data bền: `userData/gateway.json`, `userData/gateway-logs/`.
- Chỉ main process spawn/kill process (gateway server là in-process, không spawn).
- System messages tiếng Việt prefix `[meow]`.
- `npm run typecheck` + `npm test` bắt buộc pass.
- Không thêm comment thừa.

## 10. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| OpenAI wire-format phức tạp (streaming, tools) | V1 forward nguyên body, chỉ đổi auth header; relay SSE nguyên vẹn — không parse lại |
| Codex upstream base URL khác nhau | Lưu `apiBaseUrl` per-account; mặc định theo account |
| Account hết quota giữa request | Health block + coldown + quota reserve; trả 429 rõ ràng khi hết account |
| Xung đột port | Port user cấu hình; báo lỗi rõ nếu EADDRINUSE |

## 11. Phạm vi ngoài (v2)

- Anthropic-compatible `/v1/messages` qua gateway (route Claude).
- Image generation `/v1/images/*` (cockpit có).
- Streaming token counting chính xác theo upstream usage chunk.
- Request replay / export.
