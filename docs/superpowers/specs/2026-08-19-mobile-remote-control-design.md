# Meow Coding — Remote Control từ Mobile App (chat với agent + quản lý phiên): Design Spec

Ngày: 2026-08-19 · Trạng thái: chờ duyệt

## 0. Tóm tắt nhu cầu

Người dùng muốn điều khiển app desktop Meow Coding từ xa bằng một **app mobile native**
(Android + iOS) khi không ở cạnh máy. Phạm vi đã chốt qua brainstorming:

- **Gửi lệnh/prompt cho agent** — chat từ xa, xem agent trả lời realtime.
- **Quản lý phiên/workspace** — xem trạng thái agent, danh sách workspace/session, chuyển session.
- Chạy **qua internet** (không chỉ LAN).
- Xác thực: **mã pairing + phiên tin cậy** (lưu token trên phone).
- Hạ tầng: **relay server tự host** (hub-and-spoke WebSocket).
- Quy mô: **cá nhân trước, mở rộng sau** — server thiết kế sạch nhưng chưa cần DB/account phức tạp.

## 1. Kiến trúc tổng quan

```
┌──────────────┐   WSS (outbound)   ┌───────────────────┐   WSS (outbound)   ┌──────────────────┐
│ Desktop app  │ ─────────────────▶ │  Relay Server     │ ◀───────────────── │  Mobile app      │
│ (Electron)   │   (tls wss://)     │  (Node, VPS)      │   (tls wss://)     │  (React Native)  │
│ Meow Coding  │                    │  ws/uWebSockets   │                    │                  │
└──────────────┘                    └───────────────────┘                    └──────────────────┘
   │                                                        │
   ▼                                                        ▼
MeowAgentManager /                    không thấy dữ liệu thật — chỉ định tuyến
WorkspaceStore / PTY                  (forward tin nhắn giữa 2 đầu, không lưu)
```

**Nguyên tắc:**

- Cả desktop lẫn phone **chỉ kết nối outbound** tới relay — không cần mở port, không phụ thuộc NAT/router,
  hoạt động sau mọi firewall.
- Relay **chỉ định tuyến** (router): nhận message từ một phía, forward sang phía còn lại theo cặp phiên.
  Không lưu tin nhắn vào disk (chỉ log tối thiểu cho debug). Không hiểu nội dung (opaque payload).
- Trong giai đoạn đầu dữ liệu được bảo vệ bởi TLS (giữa client–relay) + mã pairing + session token.
  Chưa mã hóa end-to-end (relay nhìn thấy payload) — chấp nhận được cho usage cá nhân, ghi rõ ở mục 7.

## 2. Thành phần mới

### 2.1 Relay server (repo/folder mới: `server/` hoặc repo riêng `meow-relay`)

- Node.js + `ws` (hoặc `uWebSockets.js` nếu cần hiệu năng). Không dùng framework nặng.
- Chạy sau reverse proxy có TLS (Caddy/nginx) trên VPS, hoặc tự terminate TLS bằng cert.
- State trong memory: map `pairingCode → desktop socket`, map `desktopDeviceId ↔ mobileDeviceId` (một cặp).
- Message envelope bất định dạng nội dung:
  ```jsonc
  // client → relay
  { "kind": "hello", "role": "desktop" | "mobile", "deviceId": "...", "auth": "pairingCode" | "sessionToken" }
  { "kind": "cmd", "id": "uuid", "to": "desktop", "payload": { ...opaque... } }
  // relay → client
  { "kind": "cmd-result", "id": "uuid", "ok": true, "payload": { ...opaque... } }
  { "kind": "event", "payload": { ...opaque... } }   // ví dụ: agent:state, chat:stream
  ```
- Heartbeat ping/pong + đánh dấu offline; desktop ngắt mạng ngắn được kết nối lại, phone thấy trạng thái `desktop-offline`.

### 2.2 Desktop bridge (mới trong `src/main/remote/`)

- `RemoteRelayClient` — WS outbound (dùng `ws` đã có sẵn trong deps).
- Cấu hình (trong `userData/settings` hoặc file riêng): relay URL, deviceId, tùy chọn bật/tắt remote.
- Flow pairing (mô phỏng `BrowserBridge`):
  1. Desktop sinh mã pairing 6 số, TTL ~5 phút, hiển thị trong UI (main gửi event lên renderer).
  2. Phone nhập mã → gửi `hello` với `auth=pairingCode`.
  3. Desktop xác nhận mã → phát hành `sessionToken` (random, dài) cho phone; phone lưu lại.
  4. Lần sau phone `hello` với `auth=sessionToken` → desktop kiểm tra token còn hợp lệ, tự động paired.
  5. Desktop có thể thu hồi toàn bộ phiên tin cậy (nút "Đăng xuất thiết bị từ xa").
- Nhận `cmd` từ relay → gọi vào các service main hiện có:
  - `WorkspaceStore` → list workspace.
  - `MeowAgentManager` → `listAgents`, `listSessions`, `createSession`, `switchSession`, `renameSession`.
  - Chat: gửi prompt vào agent session qua cơ chế có sẵn của `meow-agent-manager`, subscribe event
    `chat:*` (stream token / transcript) rồi forward lên relay.
- Mọi `cmd` đều đi qua **gate phạm vi an toàn** (mục 4).

### 2.3 Protocol types (mới trong `src/shared/remote-types.ts`)

- `RemoteEnvelope`, `RemoteCmd`, `RemoteCmdResult`, `RemoteEvent`, `RemoteStatus`.
- Các command name: `workspace:list`, `agent:list`, `agent:state`, `session:list`, `session:switch`,
  `session:create`, `session:rename`, `chat:send`.
- Các event: `agent:state`, `session:changed`, `chat:stream`, `chat:done`, `desktop:offline/online`.
- **Tái sử dụng type có sẵn** từ `src/shared/types.ts` (`SessionSummary`, `WorkspaceSummary`, `ChatMessage`...)
  — không định nghĩa lại.

### 2.4 Mobile app (repo mới `meow-mobile`)

- **React Native** (đề xuất) — cùng TypeScript + React với codebase hiện tại; có thể share type bằng
  package/shared subpath (hoặc copy script sinh từ `src/shared`).
- Thay thế hợp lý: Flutter (nếu team thích Dart hơn) — quyết định khi vào plan.
- Màn hình ban đầu:
  - **Connect**: nhập relay URL + mã pairing / tự động nối lại bằng session token.
  - **Agents**: danh sách agent + trạng thái (idle/running), workspace hiện tại.
  - **Chat**: gửi prompt, xem stream token realtime + transcript, chuyển session.
- WebSocket client: `react-native-quick-websocket` hoặc thư viện phù hợp; tự reconnect + retry pairing.

## 3. Flow chính

### 3.1 Pairing lần đầu

```
Desktop mở "Remote" → bật relay → sinh mã 123456 (TTL 5')
Phone: nhập relay URL + mã → hello(pairingCode)
Relay: forward tới desktop
Desktop: kiểm tra mã → ok → sinh sessionToken → hello-reply(token) → UI tắt mã
Phone: lưu token (Keychain/Keystore), vào màn Agents
```

### 3.2 Chat từ xa

```
Phone: cmd chat:send { agentId, sessionId, text }
Relay: forward → Desktop: gate phạm vi an toàn → gọi MeowAgentManager chat
Desktop: events chat:stream (token) → relay → phone hiện realtime
Desktop: chat:done (kết thúc turn, kèm usage/todo) → phone cập nhật transcript
```

### 3.3 Quản lý phiên

```
Phone: cmd session:list { agentId } → desktop trả SessionSummary[]
Phone: cmd session:switch { agentId, sessionId } → desktop trả SessionSummary | null
Desktop: event session:changed → push lên phone (nếu phone đang mở agent đó)
```

## 4. Phạm vi an toàn (safety gate)

Mặc định **chỉ expose** (không cần xác nhận):

- Đọc: `workspace:list`, `agent:list`, `agent:state`, `session:list`.
- Gửi prompt: `chat:send` — nhưng agent vẫn chạy permission model hiện có (tool permission 'ask'
  sẽ hỏi trên desktop như bình thường).
- Đổi session không phá hủy: `session:switch`, `session:create`, `session:rename`.

**Bắt buộc bật switch "Cho phép điều khiển từ xa"** trên desktop mới chấp nhận bất kỳ kết nối nào
(mặc định tắt).

Lệnh nguy hiểm (kill agent, xóa workspace/session, thay đổi config) — **chưa đưa vào phase 1**; khi đưa
vào phải: bật thêm tùy chọn riêng + xác nhận popup trên desktop từng lần + log audit.

## 5. Bảo mật

- TLS bắt buộc (relay sau Caddy/nginx hoặc cert riêng); relay từ chối kết nối không TLS.
- Pairing code 6 số, TTL 5 phút, giới hạn số lần thử sai (lockout ngắn).
- `sessionToken`: ít nhất 256-bit ngẫu nhiên, lưu main-process-only trên desktop (không vào renderer),
  lưu Keychain/Keystore trên phone. Desktop thu hồi được.
- Relay không biết nội dung command/event (opaque payload) — nhưng *có thể thấy* vì chưa E2E encryption;
  ghi rõ trong README. Giảm rủi ro: relay chỉ cho 1 cặp device kết nối cùng mã.
- Rate-limit cơ bản trên relay (đơn giản, per-IP counter) để tránh brute-force pairing.
- Tuân thủ quy ước codebase: chỉ main process mở socket; renderer truy cập qua IPC (channel mới
  `Remote*` trong `src/shared/ipc.ts` — không hardcode string).

## 6. Cấu trúc đề xuất

```
src/main/remote/
  remote-relay-client.ts   // WS outbound + reconnect + heartbeat
  remote-pairing.ts        // sinh/xác thực mã, phát hành/thu hồi session token
  remote-commands.ts       // map command name → handler (gọi WorkspaceStore/MeowAgentManager)
  remote-safety.ts         // safety gate + settings
src/shared/remote-types.ts // envelope + command/event types
server/                    // relay server (Node + ws), triển khai độc lập
  index.ts, config.ts, README.md
meow-mobile/               // React Native app (repo riêng khi vào plan)
```

IPC thêm vào `src/shared/ipc.ts`: `RemoteGetStatus`, `RemoteSetEnabled`, `RemoteGetPairingCode`,
`RemoteRevokeTokens`, `EventRemoteStatus` (kèm `AgentApi` methods tương ứng).

## 7. Rủi ro / quyết định mở

- **Chưa E2E encryption** → phase 2 có thể thêm session key (ECDH) trao đổi trong lúc pairing; payload
  được mã hóa trước khi gửi lên relay, relay chỉ thấy ciphertext. Giữ envelope tương thích ngược.
- **Mobile chat UX**: agent hỏi (prompt question / permission) từ xa → phase 1 hiển thị câu hỏi trên
  phone như notification "cần xác nhận trên desktop"; phase 2 mới cho trả lời ngay trên phone (cần đánh
  giá rủi ro permission 'ask').
- **Reconnect khi desktop sleep**: desktop tự reconnect + nối lại command đang chờ (timeout + báo lỗi);
  phone hiển thị `desktop-offline`.
- **Nhiều phone cùng lúc**: relay hỗ trợ nhiều mobile socket nhưng chỉ 1 cặp active; phase sau mở rộng
  nhiều device + account.

## 8. Kế hoạch phase (sơ bộ)

1. **Phase 0**: relay server + protocol types + desktop bridge (pairing + list workspace/agent/session).
2. **Phase 1**: chat từ xa (chat:send + stream event) + app mobile tối thiểu (connect, agents, chat).
3. **Phase 2**: câu hỏi/permission từ xa, E2E encryption, audit log, lệnh nguy hiểm có xác nhận.

## 9. Tiêu chí thành công

- Từ điện thoại (ngoài mạng nhà) gửi prompt và nhận câu trả lời realtime từ agent trên desktop.
- Xem được danh sách workspace/agent/session, chuyển session từ phone.
- Kết nối lại tự động khi desktop lên mạng lại; token phiên tin cậy không phải nhập lại mã pairing.
- Tắt switch "Cho phép điều khiển từ xa" → mọi kết nối từ phone bị từ chối ngay lập tức.
