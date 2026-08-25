# Codex OAuth Local Proxy — Design Spec

Ngày: 2026-08-25 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Mở rộng Providers để meow-coding có thể dùng tài khoản ChatGPT/Codex đã đăng nhập OAuth làm
provider cho native chat. Bản đầu hỗ trợ:

- Đăng nhập nhiều tài khoản Codex bằng OAuth.
- Chọn một tài khoản Codex đang dùng để hiển thị model trong Model Picker của chat.
- Chạy native chat qua local OpenAI-compatible proxy, thay vì coi OAuth token là OpenAI API key.
- Giữ nguyên toàn bộ provider API key/base URL hiện có.

Claude Code và Antigravity chưa có luồng đăng nhập hay UI ở bản này. Kiến trúc account/provider
được thiết kế để có thể thêm adapter cho chúng sau này.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Transport chat | Local OpenAI-compatible proxy, không gọi trực tiếp endpoint OAuth không công khai từ Electron |
| Proxy | Sidecar xây từ CLIProxyAPI (MIT), chỉ bind `127.0.0.1`, kèm license/notice trong bản phát hành |
| OAuth | Authorization code + PKCE + callback loopback, mở bằng browser hệ thống |
| Nhiều account | Mỗi account có metadata riêng và credential nội bộ riêng trong proxy |
| Chọn account | Providers chọn một account Codex đang dùng; Model Picker chỉ hiện model của account đó |
| Routing | Mỗi native agent lưu account + model đã chọn; không tự chuyển sang account khác khi lỗi/quota |
| Secrets | Electron `safeStorage`; renderer và `meow.json` không nhận OAuth token |
| Codex CLI config | Không ghi hay sửa `~/.codex/auth.json` |

## 3. Kiến trúc

```
ProvidersScreen / ModelPicker
        │ IPC metadata only
        ▼
ConnectionsManager (main)
 ├── ConnectionsStore ── metadata index + safeStorage vault
 ├── CodexOAuthAdapter ── PKCE, callback, refresh token
 └── CodexProxyManager ── localhost sidecar lifecycle/config
        │ internal per-account proxy credential
        ▼
CLIProxyAPI sidecar (127.0.0.1:<random port>)
        │ OpenAI-compatible streaming + tool calls
        ▼
existing OpenAI-compatible LLM client → SessionRunner → ChatPanel
```

`ConnectionsManager` là điểm duy nhất tổng hợp account metadata, giải mã secret, và điều khiển
proxy. Renderer chỉ nhận trạng thái account đã mask. LLM của native agent tiếp tục dùng flow
`streamText`/`LlmClient` hiện tại, nhưng base URL sẽ là proxy local và credential sẽ được main
cấp theo account đã chọn.

## 4. Data model và persistence

Thêm các type shared cho provider account, login state và model ref có account:

```ts
type ConnectionProviderId = 'codex'

interface ProviderAccount {
  id: string
  provider: ConnectionProviderId
  email: string
  displayName: string
  active: boolean
  createdAt: number
  lastUsedAt: number
  status: 'ready' | 'refreshing' | 'expired' | 'error'
  error?: string
}

interface AccountModelRef {
  provider: string
  accountId?: string
  model: string
}
```

`userData/connections/index.json` giữ metadata account không nhạy cảm và active Codex account.
OAuth tokens được mã hóa bằng `safeStorage` trong vault do main process quản lý. Nếu encryption
không available, Codex OAuth bị vô hiệu hóa với thông báo rõ ràng; không fallback plaintext.

`AgentConfig`/model override được mở rộng để ghi `accountId` cùng provider và model. Provider
API key cũ không có `accountId`, nên cấu hình cũ tương thích hoàn toàn.

## 5. OAuth và account lifecycle

1. Người dùng bấm **Connect account** trong Codex provider card.
2. Main tạo `state`, PKCE verifier/challenge và callback loopback có TTL 5 phút; state chỉ ở
   memory trong thời gian login.
3. App mở URL authorization trong browser hệ thống. Callback xác thực state trước khi đổi code.
4. Main lấy token, suy ra email/account identifier, lưu account metadata và secret đã mã hóa.
5. Main refresh proxy config, đặt account mới active nếu đây là account đầu tiên, và emit event
   account thay đổi.
6. Khi token gần hết hạn, main refresh trước request/proxy reload. Refresh thất bại chuyển account
   sang `expired` hoặc `error`, không xóa token tự động.
7. Remove/logout xóa vault entry và metadata, reload proxy; nếu đó là active account thì chọn
   account còn lại hoặc không có account nào.

Callback port conflict, state mismatch, timeout, exchange failure và unauthorized model đều là
error hiển thị được, không chứa code/token.

## 6. Local proxy

Một `CodexProxyManager` quản lý một process sidecar cho app instance:

- Sidecar được đóng gói theo platform, chỉ listen `127.0.0.1` trên random free port.
- Main dựng config runtime từ vault và cấp credential local riêng cho từng account.
- File config runtime chứa credential plaintext bắt buộc cho process sidecar, chỉ tồn tại trong
  `userData/connections/runtime/<run-id>/`, bị xóa khi proxy dừng và được dọn lại lúc app khởi động
  sau crash. Nó không phải persistence source of truth; vault mã hóa vẫn là nguồn duy nhất.
- Main đợi health check trước khi tạo LLM client. Nếu process chết, manager restart một lần; lỗi
  lặp lại đi về chat kèm thông báo reconnect.
- Shutdown kill cả process tree và dọn runtime artifact.

Proxy trả OpenAI-compatible streaming response/tool calls, vì vậy `createOpenAICompatibleLlm`
có thể giữ nguyên đường đi message, tools, usage và session hiện tại. Account routing là explicit:
agent nào đã chọn account nào thì request của agent đó luôn dùng account đó. Bản đầu không có
round-robin, automatic failover hay quota routing.

## 7. UI và IPC

`ProvidersScreen` thêm card **Codex (ChatGPT OAuth)** với:

- Connect account, danh sách account, trạng thái, set active và remove/logout.
- Active account rõ ràng; account không ready không thể set active.
- Model fetch/status cho account active.

`ModelPicker` hiển thị models của active Codex account trong nhóm Codex. Khi user chọn model,
IPC lưu `{ provider: 'codex', accountId, model }` cho native agent. Label phải thể hiện đủ model
và account khi cần để không nhầm account.

IPC thêm nhóm `connections:*` thông qua `Channels`, gồm list status, start/cancel login, set
active account, remove account, refresh models và event state changed. API cũ
`provider:connect`/`provider:disconnect` giữ cho API-key providers.

## 8. Security

- Token, refresh token, local proxy credential không đi qua preload/renderer và không ghi vào
  `meow.json`.
- OAuth callback bind loopback, kiểm state, PKCE, TTL và không log query/code.
- Proxy không listen LAN; auth key của proxy là per-account và private to main process.
- Runtime proxy config được dọn khi shutdown/error cleanup và ở lần mở app tiếp theo. Failure
  cleanup cố gắng kill tree và delete artifact, nhưng không xóa vault/account metadata.
- Sidecar distribution bao gồm license/notice MIT của CLIProxyAPI.

## 9. Testing

- Unit: PKCE/state/callback validation, vault/account CRUD, active-account transitions, token
  refresh/error states và proxy config không làm lộ secret qua return value.
- Unit: native LLM resolution chọn đúng account-local URL/credential và xử lý text/tool-call/error
  stream như provider OpenAI-compatible.
- Integration: fake proxy server xác nhận routing đúng account và restart/error behavior.
- Renderer: Model Picker chỉ hiện model của active Codex account; update active account refreshes
  model list; account ID được lưu cùng model selection.
- E2E: OAuth callback fixture → account hiển thị trong Providers → chọn model → một native chat
  turn stream qua fake sidecar.
- Bắt buộc trước khi hoàn thành: `npm run typecheck`, `npm test`, và `npm run build && npm run e2e`
  cho thay đổi có ảnh hưởng end-to-end.

## 10. Out of scope

- Claude Code OAuth UI/runtime.
- Antigravity credential injection/UI/runtime.
- Quota dashboard, automatic account rotation/failover, account groups.
- Sửa global Codex CLI auth hoặc thay thế Codex CLI account của người dùng.
