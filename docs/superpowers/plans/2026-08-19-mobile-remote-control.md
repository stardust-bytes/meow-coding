# Meow Coding — Mobile Remote Control (Desktop bridge + Relay server): Implementation Plan

Ngày: 2026-08-19 · Spec gốc: `docs/superpowers/specs/2026-08-19-mobile-remote-control-design.md`

## 0. Tách scope

Spec gốc gồm 3 subsystem độc lập: **relay server**, **desktop bridge**, **mobile app**. Theo nguyên tắc
"mỗi plan tạo ra phần mềm chạy được và test được", chia làm 2 plan:

- **Plan này**: relay server + desktop bridge + protocol types + desktop UI tối thiểu. Test được
  end-to-end bằng **fake mobile client** (WS client trong integration test) — không cần điện thoại thật.
- **Plan sau (chưa viết)**: app mobile React Native (`meow-mobile`, repo riêng) tiêu thụ cùng protocol.
  Chỉ viết sau khi plan này xong, để contract đã ổn định.

Không làm gì trong plan này: mobile app, E2E encryption, trả lời question/permission từ phone,
lệnh nguy hiểm (kill agent, xóa workspace/session).

## 1. Quyết định kiến trúc (tóm tắt từ spec)

- Desktop và phone **cùng kết nối outbound** tới relay (WSS). Relay chỉ định tuyến, payload opaque.
- Xác thực: pairing code 6 số (TTL 5 phút, max 5 lần thử sai) → desktop phát `sessionToken` (256-bit).
  Phone lưu token, lần sau xài lại. Desktop thu hồi được.
- Mọi lệnh từ phone đi qua **safety gate**: nếu `enabled=false` → từ chối. Chỉ expose đọc + chat:send
  + session không phá hủy.
- Chỉ main process mở socket; renderer qua IPC (channel mới `Remote*` — không hardcode string).
- Thông báo system-style từ main dùng tiếng Việt, prefix `[meow]`.

## 2. File structure

### Mới

```
src/shared/remote-types.ts          // protocol types + RemoteStatus (pure types, KHÔNG import Node)
src/main/remote/remote-settings.ts  // JsonStore wrapper: { enabled, relayUrl, deviceId, sessionToken? }
src/main/remote/remote-pairing.ts   // sinh/xác thực code, issue/validate/revoke token (pure logic)
src/main/remote/remote-commands.ts  // dispatcher command name → handler (workspace/agent/session/chat)
src/main/remote/remote-relay-client.ts // WS outbound: hello, reconnect, heartbeat, pairing, cmd routing
src/main/remote/remote-manager.ts   // orchestrator: settings + pairing + client + status events
server/package.json                 // relay server (npm package riêng, deps: ws)
server/tsconfig.json
server/index.ts                     // relay: rooms code→desktop, link desktop↔mobile, forward
server/README.md                    // hướng dẫn chạy + reverse proxy TLS (Caddy)
src/renderer/src/components/settings/RemoteTab.tsx  // UI settings: toggle, relay URL, pairing code
tests/unit/remote-pairing.test.ts
tests/unit/remote-commands.test.ts
tests/integration/remote/relay-flow.test.ts
```

### Sửa

```
src/main/meow-agent-manager.ts   // thêm public listAgents(): AgentConfig[]
src/shared/ipc.ts                // + Channels.RemoteGetStatus/RemoteSetEnabled/RemoteSetRelayUrl/
                                 //   RemoteStartPairing/RemoteRevokeToken/EventRemoteStatus
                                 // + AgentApi methods tương ứng
src/preload/index.ts             // + window.api.remote* + onRemoteStatus
src/main/index.ts                // + khởi tạo RemoteManager, setOnEvent composition, IPC handlers, dispose
src/renderer/src/components/settings/SettingsDialog.tsx // + tab 'remote'
package.json                     // + "typecheck:server" script (tsc -p server/tsconfig.json)
                                 //   và thêm vào script "typecheck"
```

## 3. Protocol (đóng băng trong `src/shared/remote-types.ts`)

Envelope JSON qua WS. `cmd`, `cmd-result`, `event` có payload **opaque** — relay không đọc.

```ts
// client → relay
{ type: 'hello', role: 'desktop' | 'mobile', deviceId: string, auth?: string }
  // mobile: auth = pairing code 6 số HOẶC sessionToken
  // desktop: auth = undefined (relay tin deviceId — ràng buộc thật nằm ở mobile→desktop)
{ type: 'pairing-start', code: string, ttlMs: number }        // desktop → relay
{ type: 'cmd', id: string, cmd: RemoteCommandName, params: Record<string, unknown> } // mobile → relay
{ type: 'ping' } / { type: 'pong' }

// relay → client
{ type: 'pair-result', ok: boolean, token?: string, error?: string }  // desktop → relay → mobile
{ type: 'cmd-result', id: string, ok: boolean, result?: unknown, error?: string } // desktop → mobile
{ type: 'event', event: RemoteEvent }                          // desktop → mobile
{ type: 'desktop-status', online: boolean }                    // relay → mobile
```

```ts
export type RemoteCommandName =
  | 'workspace:list' | 'agent:list' | 'agent:state'
  | 'session:list' | 'session:switch' | 'session:create' | 'session:rename'
  | 'chat:send'

export type RemoteEvent =
  | { type: 'agent:state'; agentId: string; running: boolean; background: boolean }
  | { type: 'session:changed'; agentId: string }
  | { type: 'chat:event'; event: ChatEvent }        // tái sử dụng ChatEvent từ ./types

export interface RemoteStatus {
  enabled: boolean
  connected: boolean
  paired: boolean            // đã có mobile liên kết
  deviceId: string
  pairingCode?: string
  pairingExpiresAt?: number
  mobileOnline?: boolean
  error?: string
}
```

## 4. Các task

Quy ước mỗi task: viết test trước (đỏ) → code (xanh) → chạy test + typecheck → commit.
Lệnh test: `npx vitest run <file>`. Typecheck đầy đủ: `npm run typecheck && npm test`.

---

### Task 1 — Protocol types

**Tạo `src/shared/remote-types.ts`**: đúng như section 3. Import `ChatEvent` từ `'./types'`.
KHÔNG import Node/Electron. Xuất thêm `RemoteHello`, `RemotePairingStart`, `RemotePairResult`,
`RemoteCmd`, `RemoteCmdResult`, `RemoteEventMsg`, `RemoteEnvelope` (union) để dùng chung cả 2 phía.

**Kiểm tra**: `npm run typecheck` pass (file nằm trong include của cả 3 tsconfig).

**Commit**: `feat(remote): shared protocol types`

---

### Task 2 — RemoteSettingsStore + RemotePairing (TDD)

**Tạo `src/main/remote/remote-settings.ts`**:
```ts
export interface RemoteSettings {
  enabled: boolean
  relayUrl: string
  deviceId: string
  sessionToken?: string
}
export class RemoteSettingsStore {
  constructor(private store: JsonStore<RemoteSettings>) {}
  load(): RemoteSettings  // default: { enabled:false, relayUrl:'', deviceId: randomUUID() } — lưu lại nếu thiếu
  save(s: RemoteSettings): void
}
```
Dùng `createJsonStore<RemoteSettings>` (pattern như `workspaces.json` trong index.ts). Lưu tại
`userData/remote.json`.

**Tạo `src/main/remote/remote-pairing.ts`** — class `RemotePairing` thuần (không IO):
- `startPairing(): { code: string; expiresAt: number }` — code 6 số (crypto randomInt), TTL 5 phút,
  chỉ 1 code active.
- `validatePairingCode(code: string): boolean` — max 5 lần thử sai trong TTL → lockout 30s (trả false).
- `setToken(token: string): void` — nạp token đã lưu (khởi động lại app).
- `issueToken(): string` — `randomBytes(32).toString('hex')` (256-bit), lưu nội bộ.
- `validateToken(token: string): boolean` — constant-time compare (`timingSafeEqual`), sau 2 lần sai cũng lockout nhẹ.
- `revokeToken(): void`.
- `reset(): void` — hết pairing (tắt remote).

> **Token persistence**: `RemotePairing` là in-memory, nhưng `sessionToken` phải sống qua restart để
> phone không phải pair lại. Khi `issueToken()` → `RemoteManager` lưu token vào `RemoteSettingsStore`
> (`sessionToken` field). Khi app khởi động, `RemoteManager` đọc token từ store và gọi
> `pairing.setToken(stored)` trước khi relay client connect.

**Test `tests/unit/remote-pairing.test.ts`**:
- code đúng 6 chữ số, expiresAt ≈ now+5min; code sai trả false; sau 5 lần sai → khóa tới hết lockout;
  issue → validate đúng true, sai false; revoke → false; validateToken không nhạy timing (smoke).
- validatePairingCode/validateToken không phụ thuộc thời gian thực (inject `now()` và `sleep()` qua
  constructor deps để test lockout nhanh — pattern giống `BridgeDeps`).

**Kiểm tra**: `npx vitest run tests/unit/remote-pairing.test.ts && npm run typecheck`.

**Commit**: `feat(remote): settings store + pairing code/token logic`

---

### Task 3 — Relay server

**Tạo `server/package.json`**:
```jsonc
{
  "name": "meow-relay",
  "private": true,
  "type": "module",
  "scripts": { "start": "node index.ts --experimental-strip-types 2>/dev/null || node --run start" },
  "dependencies": { "ws": "^8.21.3" }
}
```
> Ghi chú: nếu Node chưa hỗ trợ chạy TS trực tiếp, dùng `tsx` làm devDep (`"start": "tsx index.ts"`).
> Quyết định khi implement — mục tiêu là `npm start` chạy được server.

**Tạo `server/tsconfig.json`**: `composite`, `module ESNext`, `moduleResolution Bundler`, `strict`,
`include: ["*.ts"]`, `types: ["node"]` (dùng `@types/ws`, `@types/node` từ root node_modules — server
nằm trong cùng repo nên hoisted). Không thêm vào references của tsconfig root (tránh phá build electron).

**Tạo `server/index.ts`** — `WebSocketServer` (dùng `ws`), log tối thiểu:
- State in-memory: `desktop: { ws, deviceId } | null`, `mobile: { ws, deviceId, paired: boolean } | null`,
  `pairingCode → { desktopWs, expiresAt }` (TTL check khi mobile hello).
- Handle:
  - `hello {role:'desktop'}` → nếu có desktop cũ → close cũ; lưu desktop; nếu mobile đang connected →
    gửi mobile `{type:'desktop-status', online:true}`.
  - `pairing-start {code}` → lưu `pairingCode[code] = { desktopWs, expiresAt: now+ttlMs }` (server chỉ
    dùng để route hello; desktop vẫn là nơi validate).
  - `hello {role:'mobile', auth}` → nếu có desktop connected → **luôn forward hello tới desktopWs**
    (dù auth là code hay token — desktop là nơi duy nhất validate), chờ desktop trả `pair-result` →
    forward về mobile; nếu ok → `mobile.paired = true` (xóa pairingCode nếu là code). Điều này cho phép
    phone reconnect bằng token sau khi desktop restart.
    Nếu không có desktop → gửi mobile `{type:'desktop-status', online:false}`.
  - `pair-result` (desktop → relay) → forward tới mobile; cập nhật `mobile.paired = msg.ok`; nếu ok,
    xóa pairingCode.
  - `cmd` (mobile → relay) → forward tới desktop nếu `mobile.paired` và desktop online.
  - `cmd-result` / `event` (desktop → relay) → forward tới mobile (event chỉ khi paired).
  - `ping` → `pong`.
- Heartbeat: `setInterval` 30s ping cả 2 socket; socket không pong → terminate + cập nhật status
  (desktop offline → báo mobile).
- Port từ env `PORT` (default 3928); bind `0.0.0.0` (đứng sau reverse proxy TLS).
- `process.on('SIGINT')` → close sạch.

**Tạo `server/README.md`**: chạy `npm install && npm start`; deploy VPS với Caddy:
```
meow-relay.example.com {
    reverse_proxy 127.0.0.1:3928
}
```
Lưu ý bảo mật: relay thấy payload (chưa E2E), chỉ dùng cho 1 cặp desktop–mobile.

**Test**: không có test riêng cho server — được phủ bởi integration test Task 5 (server chạy thật
trên port 0 trong test).

**Commit**: `feat(remote): standalone ws relay server`

---

### Task 4 — RemoteCommands dispatcher (TDD)

**Sửa `src/main/meow-agent-manager.ts`**: thêm public method (đặt cạnh `addAgent`):
```ts
listAgents(): AgentConfig[] {
  return [...this.agents.values()]
}
```

**Tạo `src/main/remote/remote-commands.ts`**:
```ts
export interface RemoteCommandContext {
  meowAgent: Pick<MeowAgentManager, 'listAgents'|'listSessions'|'createSession'|'switchSession'|
    'renameSession'|'send'|'isRunning'|'isBackground'>
  workspaceStore: Pick<WorkspaceStore, 'list'>
  isEnabled(): boolean
}
export async function dispatchRemoteCommand(
  name: RemoteCommandName,
  params: Record<string, unknown>,
  ctx: RemoteCommandContext
): Promise<RemoteCmdResult>
```
Map:
- `workspace:list` → `workspaceStore.list()`
- `agent:list` → `meowAgent.listAgents().map(a => ({ id, name, cwd, kind }))` — chỉ expose 4 field
  (không lộ apiKey/model đầy đủ).
- `agent:state` (params `{agentId}`) → `{ running: isRunning, background: isBackground }`
- `session:list` (params `{agentId}`) → `listSessions(agentId)`
- `session:create` (`{agentId}`) → `createSession(agentId)`
- `session:switch` (`{agentId, sessionId}`) → `switchSession(agentId, sessionId)`
- `session:rename` (`{agentId, sessionId, title}`) → `renameSession(agentId, sessionId, title)`
- `chat:send` (`{agentId, text}`) → validate `text` non-empty → `await meowAgent.send(agentId, text)`
  → trả `{ queued: true }` (agent đang chạy sẽ xếp hàng — hành vi có sẵn của `send()`).

**Safety gate đặt ở ĐẦU hàm**: `if (!ctx.isEnabled()) return { ok:false, error:'remote disabled' }`.
Unknown command → `{ ok:false, error:'unknown command' }`. Agent không tồn tại → error rõ ràng.

**Test `tests/unit/remote-commands.test.ts`**: fake context (object literal) — không cần MeowAgentManager
thật:
- disabled → mọi command trả `remote disabled`, không gọi gì.
- workspace:list / agent:list trả đúng data từ fake.
- chat:send gọi `send` với đúng agentId+text; text rỗng → error.
- session:switch gọi với đúng tham số; agent không tồn tại (fake `listSessions` throw hoặc trả []) → error.
- unknown command → error.

**Kiểm tra**: `npx vitest run tests/unit/remote-commands.test.ts && npm run typecheck`.

**Commit**: `feat(remote): remote command dispatcher with safety gate`

---

### Task 5 — RemoteRelayClient (TDD với integration test)

**Tạo `src/main/remote/remote-relay-client.ts`**:
```ts
export interface RelayClientDeps {
  url: string                       // wss://... (dev test dùng ws://127.0.0.1:port)
  deviceId: string
  pairing: RemotePairing
  dispatch: (name: RemoteCommandName, params: Record<string, unknown>) => Promise<RemoteCmdResult>
  now?: () => number
  wsImpl?: new (url: string) => WebSocket   // inject cho test (mặc định `ws`)
}
```
- `connect(): void` — mở WS; on open → gửi `{type:'hello', role:'desktop', deviceId}`; on message:
  - `hello` (mobile forwarded, có `auth`) → `pairing.validatePairingCode(auth)` hoặc
    `pairing.validateToken(auth)` (phân biệt: /^\d{6}$/ là code) → gửi
    `{type:'pair-result', ok, token? : pairing.issueToken(), error?}`; ok → set paired=true,
    emit status.
  - `cmd` → `await dispatch(cmd, params)` → gửi `cmd-result`.
- `sendEvent(e: RemoteEvent): void` — chỉ gửi khi paired.
- `startPairing(): { code, expiresAt }` — `pairing.startPairing()` + gửi `pairing-start {code, ttlMs}`.
- `revokeToken(): void` — `pairing.revokeToken()` + set paired=false + emit status.
- Reconnect: backoff 1s→2s→5s→10s→30s (cap), reset khi open; heartbeat ping 30s, pong timeout → close
  để reconnect.
- `onStatusChange(cb: (s: RelayStatus) => void): () => void`; `close(): void` (dừng timer, đóng ws).
- `RelayStatus = { connected: boolean; paired: boolean; error?: string }`.

**Tạo `tests/integration/remote/relay-flow.test.ts`** (pattern: `tests/integration/browser/bridge-flow.test.ts`):
- Helper `startRelay()`: import `server/index.ts`, export hàm `createRelayServer({ port: 0 })` trả
  `{ wss, port, close() }` — **cần export hàm này từ server/index.ts** (server testable).
- Helper `fakeMobile(port)`: WS client:
  1. connect → gửi `hello {role:'mobile', deviceId:'phone-1', auth: CODE}`.
  2. nhận `pair-result` (ok, có token) → lưu token.
- Test 1 **pair flow**: desktop `RemoteRelayClient` connect + `startPairing()` → fakeMobile pair bằng
  code → nhận token; client.status.paired === true; fakeMobile gửi `cmd workspace:list` → nhận
  `cmd-result` với result từ fake dispatch.
- Test 2 **token reuse**: desktop mới (reconnect, cùng deviceId, pairing mới) → fakeMobile gửi
  `hello {auth: token cũ}` → pair-result ok (desktop validate token từ RemotePairing đã issue trước).
- Test 3 **event forward**: client gửi `sendEvent({type:'agent:state',...})` → fakeMobile nhận `event`.
- Test 4 **desktop offline**: close client → fakeMobile nhận `desktop-status {online:false}` (hoặc
  `pair-result` báo lỗi khi desktop chưa connect).
- Test 5 **sai code**: fakeMobile pair code sai → `pair-result {ok:false}`.

**Kiểm tra**: `npx vitest run tests/integration/remote/relay-flow.test.ts && npm run typecheck`.

**Commit**: `feat(remote): outbound relay client with pairing/reconnect`

---

### Task 6 — RemoteManager + IPC + preload + wiring (TDD nhẹ)

**Tạo `src/main/remote/remote-manager.ts`** — ghép nối:
```ts
export interface RemoteManagerDeps {
  store: RemoteSettingsStore
  pairing: RemotePairing
  context: RemoteCommandContext
  onAgentEvent?: (e: ChatEvent) => void     // forward agent events ra relay
  wsImpl?: ...                               // pass-through tới RelayClient
}
export class RemoteManager {
  getStatus(): RemoteStatus
  setEnabled(enabled: boolean): void         // save + connect/disconnect relay client
  setRelayUrl(url: string): void             // save + reconnect nếu đang enabled
  startPairing(): { code: string; expiresAt: number } | null   // null nếu chưa enabled/connected
  revokeToken(): void
  handleAgentEvent(e: ChatEvent): void       // map sang RemoteEvent rồi sendEvent
  onStatusChange(cb: (s: RemoteStatus) => void): () => void
  dispose(): void
}
```
- Khởi tạo: `pairing.setToken(store.load().sessionToken ?? '')` — nạp token đã lưu (note Task 2).
- Khi nhận token mới từ RelayClient (pair ok) → `store.save({ ...s, sessionToken: token })`.
- `revokeToken()` → `pairing.revokeToken()` + xóa `sessionToken` khỏi store.
- `handleAgentEvent` mapping: `turn-started` → `agent:state {running:true}`; `done`/`error` →
  `agent:state {running:false}`; còn lại → `chat:event {event: e}`.
- `setEnabled(false)` → close client, revoke pairing (reset), paired=false.
- Status listeners: merge từ RelayClient status + enabled + pairing code.

**Sửa `src/shared/ipc.ts`**:
```ts
RemoteGetStatus: 'remote:get-status',
RemoteSetEnabled: 'remote:set-enabled',
RemoteSetRelayUrl: 'remote:set-relay-url',
RemoteStartPairing: 'remote:start-pairing',
RemoteRevokeToken: 'remote:revoke-token',
EventRemoteStatus: 'remote:status',
```
+ AgentApi: `getRemoteStatus(): Promise<RemoteStatus>`, `setRemoteEnabled(enabled: boolean): Promise<void>`,
`setRemoteRelayUrl(url: string): Promise<void>`, `startRemotePairing(): Promise<{code, expiresAt} | null>`,
`revokeRemoteToken(): Promise<void>`, `onRemoteStatus(cb): () => void`.

**Sửa `src/preload/index.ts`**: implement 6 method trên (pattern `getBrowserStatus`/`onBrowserStatus`
dòng 124–132).

**Sửa `src/main/index.ts`**:
- Import RemoteManager/RemoteSettingsStore/RemotePairing/dispatchRemoteCommand.
- Khởi tạo trong constructor (cạnh `browserBridge`, dòng ~69):
```ts
const remoteStore = new RemoteSettingsStore(createJsonStore(path.join(app.getPath('userData'), 'remote.json')))
remote = new RemoteManager({
  store: remoteStore,
  pairing: new RemotePairing(),
  context: {
    meowAgent: this.meowAgent,
    workspaceStore: this.workspaces,
    isEnabled: () => remoteStore.load().enabled
  }
})
```
  (đặt sau khi `meowAgent` đã khởi tạo — nếu constructor order không cho phép, khởi tạo trong
  `init()`/`whenReady`; chọn vị trí không phá vỡ order hiện có.)
- Composition `setOnEvent` (dòng ~170): thêm `mainApp.remote?.handleAgentEvent(event)` ngay trước
  `win?.webContents.send(Channels.EventChat, event)`.
- IPC handlers (cạnh dòng 622–628): 5 handle + push `EventRemoteStatus` qua
  `remote.onStatusChange(info => win?.webContents.send(Channels.EventRemoteStatus, info))`.
- `before-quit`/quit path (dòng ~670): gọi `remote.dispose()` cạnh `browserBridge.close()`.

**Unit test**: thêm `tests/unit/remote-manager.test.ts` — `handleAgentEvent` map đúng event
(turn-started → agent:state running true; text-delta → chat:event); `setEnabled(false)` reset paired;
`startPairing` trả null khi disabled. Fake deps, không cần WS thật.

**Kiểm tra**: `npx vitest run tests/unit/remote-manager.test.ts && npm run typecheck && npm test`.

**Commit**: `feat(remote): manager + IPC + preload wiring`

---

### Task 7 — Renderer UI: RemoteTab trong Settings

**Tạo `src/renderer/src/components/settings/RemoteTab.tsx`** (model theo `ChatGptWebTab.tsx`):
- Toggle "Allow remote control" → `window.api.setRemoteEnabled(!enabled)`.
- Input relay URL (wss://...) → `setRemoteRelayUrl` (blur/save).
- Khi enabled: nút "Start pairing" → `startRemotePairing()` → hiện code 6 số + đếm ngược TTL
  (local state từ `pairingExpiresAt`).
- Nút "Revoke trusted devices" → `revokeRemoteToken()`.
- Status line từ `onRemoteStatus` (subscribe/unsubscribe trong useEffect): connected / paired /
  mobileOnline / error. Label tiếng Anh (quy ước UI).
- Loading/error handling đơn giản.

**Sửa `SettingsDialog.tsx`**: thêm `'remote'` vào `TabId`, thêm `RemoteTab` vào `TABS`
(label: `Remote Control`), render `{tab === 'remote' && <RemoteTab />}` (không phụ thuộc draft).

**Kiểm tra**: `npm run typecheck` (web pass) + `npm run build` chạy được.

**Commit**: `feat(remote): settings UI for remote control`

---

### Task 8 — Typecheck script + README + verification

**Sửa `package.json`**: `"typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.extension.json && npm run typecheck:server"` và thêm
`"typecheck:server": "tsc --noEmit -p server/tsconfig.json"`. (Server TS nằm trong repo nên typecheck
phải phủ — giữ `noEmit` để không sinh output build electron.)

**Tạo `docs/superpowers/plans/2026-08-19-mobile-remote-control` mục mới?** — không; tạo
`docs/remote-control.md` ngắn: kiến trúc 1 đoạn, cách chạy relay (`server/README.md`), cách bật remote
trên desktop, link tới spec + plan.

**Verification cuối (bắt buộc)**:
```
npm run typecheck
npm test
npm run build
```
(Chạy `npm run build && npm run e2e` chỉ nếu e2e bị ảnh hưởng — SettingsDialog tab mới có thể đổi DOM
e2e; kiểm tra `tests/e2e` có test settings không, nếu có thì chạy.)

**Commit**: `docs(remote): usage README + typecheck coverage for server`

## 5. Checklist ràng buộc (đối chiếu AGENTS.md)

- [ ] Không hardcode channel string — dùng `Channels.Remote*`.
- [ ] `src/shared/remote-types.ts` không import Node/Electron.
- [ ] Chỉ main process mở socket (relay client nằm trong main; renderer chỉ qua `window.api`).
- [ ] Thông báo từ main prefix `[meow]` + tiếng Việt (nếu có push notification).
- [ ] Không thêm comment thừa.
- [ ] Agent thoát/xử lý: relay client `dispose()` đóng WS sạch khi app quit — không để timer mồ côi.
- [ ] Relay bind — dev bind `0.0.0.0` nhưng README bắt buộc reverse proxy TLS (không để plain ws ra
  internet công khai).
