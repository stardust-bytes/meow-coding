# Meow Coding — Context Usage Footer (theo model opencode): Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt

## 1. Bối cảnh & vấn đề

Auto-compaction đã hoạt động đầy đủ (`src/main/agent/loop.ts:264` `maybeCompact`, `src/main/agent/compact.ts`),
nhưng user **không nhìn thấy** mình đang dùng bao nhiêu context và còn cách ngưỡng auto-compact bao xa.
Thông tin token duy nhất hiện có là một dòng trong feed sau khi lượt chạy kết thúc
(`src/renderer/src/components/chat/ChatPanel.tsx:575-580`), sống trong React state, mất khi reload app
hoặc đổi session, và không có mẫu số để biết "23% hay 92%".

Tham khảo opencode `D:\Git\GitHub\opencode`:

- `packages/tui/src/routes/session/subagent-footer.tsx:35-53` — footer dưới prompt
- `packages/tui/src/component/prompt/index.tsx:262-281` — cùng logic, dùng cho prompt chính
- `packages/tui/src/feature-plugins/sidebar/context.tsx:19-35` — bản sidebar

Cách opencode tính:

```ts
const last = msg.findLast(m => m.role === "assistant" && m.tokens.output > 0)
const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning
             + last.tokens.cache.read + last.tokens.cache.write
const pct = model?.limit.context ? Math.round(tokens / model.limit.context * 100) : undefined
// hiển thị: `${Locale.number(tokens)} (${pct})` · cost tích luỹ cả phiên
```

Hai điểm cốt lõi: **tokens lấy từ assistant message cuối cùng** (không phải tổng tích luỹ — tổng tích luỹ
là chi phí, không phải mức chiếm dụng context), và **tokens được lưu trong chính message** nên reload vẫn còn.

## 2. Mục tiêu

1. Thêm một **block riêng dưới khu vực chat input** (dưới cả nút Send/Stop) hiển thị:
   `context <tokens> (<pct>%) · $<cost tích luỹ phiên>`.
2. Số liệu **bền qua reload / đổi session** — persist tokens vào assistant message.
3. **Cảnh báo màu** theo ngưỡng auto-compact thật của app, không dùng mốc % tuỳ tiện.
4. Không đoán bừa khi thiếu dữ liệu: không có context limit thì ẩn `%`.

Ngoài phạm vi: lệnh `/compact` thủ công, thay `estimateTokens` (char/4) bằng tokenizer thật,
sidebar/stats screen.

## 3. Thay đổi theo lớp

| Lớp | File | Thay đổi |
|---|---|---|
| LLM | `src/main/agent/llm.ts:93-104` | Map thêm `reasoningTokens`, `cachedInputTokens` từ `part.totalUsage` |
| Loop | `src/main/agent/loop.ts` | Gắn `tokens` vào assistant message khi persist; báo usage sau **mỗi step** |
| Manager | `src/main/meow-agent-manager.ts` | Getter `getContextInfo(agentId)`; emit event `usage` |
| IPC | `src/shared/ipc.ts`, `src/main/index.ts`, preload | Kênh mới `AgentGetContext: 'agent:get-context'` |
| Types | `src/shared/types.ts` | `MessageTokens`, `ChatMessage.tokens?`, `ContextInfo`, ChatEvent `usage` |
| Renderer | `ContextFooter.tsx` (mới), `ChatPanel.tsx`, `styles.css` | Block mới trong `.chat-composer` sau `<ChatInput>` |

## 4. Model dữ liệu

```ts
// src/shared/types.ts
export interface MessageTokens {
  input: number
  output: number
  total: number
  reasoning?: number
  cacheRead?: number
}

export interface ChatMessage {
  // …các field hiện có
  tokens?: MessageTokens        // optional → session cũ đọc lên vẫn hợp lệ
}

export interface ContextInfo {
  limit: number | null            // null khi không xác định được
  compactThreshold: number | null // null khi compaction.auto = false
  sessionCost: number             // usage.cost tích luỹ của session đang mở
}

// ChatEvent thêm:
| { type: 'usage'; agentId: string; tokens: MessageTokens; sessionCost: number }
```

Helper dùng chung (đặt cạnh `src/shared/types.ts`, ví dụ `src/shared/usage.ts`):

```ts
export function contextTokens(u: MessageTokens): number {
  return u.total > 0 ? u.total : u.input + u.output
}
```

**Lý do không cộng thẳng `cacheRead` như opencode:** mỗi provider quy ước khác nhau — Anthropic tách
cache read khỏi `input_tokens`, OpenAI gộp sẵn vào. Cộng vô điều kiện sẽ đếm trùng ở OpenAI.
Ta **lưu đủ breakdown** trong `MessageTokens` để sau này chỉnh công thức trong đúng một hàm,
không phải đổi schema hay migrate dữ liệu.

## 5. Luồng dữ liệu

```
finish part {tokens}  (mỗi step trong SessionRunner.run)
   │
   ├─► appendMessage({ …assistant msg, tokens })     → persist xuống session store
   ├─► onUsage(stepTokens) → store.addUsage(...)     → cost tích luỹ cập nhật ngay
   └─► emit { type:'usage', tokens, sessionCost }
                     │
ChatPanel ───────────┴──► setLastTokens / setSessionCost ──► <ContextFooter>
   │
   └─ loadTranscript(): quét ngược tìm assistant message cuối có tokens && output > 0
      loadContextInfo(): IPC AgentGetContext → { limit, compactThreshold, sessionCost }
```

`sessionCost` đi kèm trong cùng lời gọi IPC vì `SessionSummary` (`src/shared/types.ts:88`) không mang
`usage` — thêm một field vào summary sẽ kéo theo mọi chỗ list session, trong khi renderer chỉ cần cost
của **session đang mở**. Một kênh trả đủ ba số là đường ngắn nhất và không đụng contract khác.

**Đổi `onUsage` từ cuối-run sang mỗi-step** (`loop.ts:170-177` hiện gọi một lần với `runUsage`):
tổng cộng dồn không đổi, nhưng nếu user bấm Stop hoặc gặp lỗi giữa chừng thì chi phí đã tiêu vẫn
được ghi nhận. Event `done` giữ nguyên `tokens`/`cost` để không phá contract hiện tại.

`getContextInfo(agentId)` tái dùng nguyên logic đã có ở `meow-agent-manager.ts:540-543`:

```ts
const limit = modelLimits.get(`${provider}/${model}`)?.context ?? cfg.maxContextTokens ?? null
const compactThreshold = cfg.compaction.auto && limit ? limit - cfg.compaction.buffer : null
const sessionCost = store.getUsage(activeSessionId(agentId)).cost   // session.ts:198
```

Ba giá trị này đọc lại mỗi lần gọi (config có thể đổi trong Settings), không cache ở manager.

ChatPanel gọi `loadContextInfo()` khi: mount, đổi session, và sau khi đổi model/variant
(dùng chung effect đang reload `availableVariants`).

## 6. Component `ContextFooter`

File mới `src/renderer/src/components/chat/ContextFooter.tsx` — **thuần trình bày, không gọi IPC**,
nên test được bằng unit test thường:

```tsx
type Props = {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
}
```

Vị trí render: trong `.chat-composer`, **sau** `<ChatInput>` (`ChatPanel.tsx:725-731`) — tức nằm dưới
cả textarea lẫn nút Send/Stop, đúng như yêu cầu.

Các trạng thái hiển thị:

| Điều kiện | Hiển thị | Class |
|---|---|---|
| `tokens === null` | `context —` | `.context-footer` |
| có `tokens`, không có `limit` | `context 45,231` (ẩn %) | `.context-footer` |
| `tokens < 0.8 × compactThreshold` | `context 45,231 (23%) · $0.0421` | `.context-footer` |
| `tokens ≥ 0.8 × compactThreshold` | như trên, màu vàng | `.warn` |
| `tokens ≥ compactThreshold` | `context 184,900 (92%) · compacting soon` | `.danger` |
| `compactThreshold === null` | không đổi màu ở mọi mức | `.context-footer` |

- `%` luôn tính theo `limit` (mẫu số user hiểu được), còn màu tính theo `compactThreshold`.
- Số format bằng `toLocaleString()`, cost `$0.0000` (4 chữ số như code hiện tại), ẩn khi cost = 0.
- CSS dùng lại token màu sẵn có trong `src/renderer/src/styles.css` (`--text-dim`, `--green`),
  thêm biến cho vàng/đỏ theo bảng màu hiện hành.

Xoá khối `.chat-tokens` trong feed (`ChatPanel.tsx:575-580`) cùng CSS `styles.css:649-650` —
footer thay thế hoàn toàn, giữ cả hai là hai chỗ nói cùng một chuyện.

## 7. Xử lý lỗi & biên

- Offline / model không có trong catalog → `modelLimits` rỗng → fallback `cfg.maxContextTokens`;
  nếu vẫn không có thì `limit = null`, ẩn `%`, không đoán.
- Provider không trả usage (`tokens === undefined`) → không ghi `tokens` vào message, footer giữ
  giá trị cũ thay vì nhảy về `—`.
- Session cũ (message không có `tokens`) → quét ngược không thấy → hiện `—` cho tới lượt chạy kế tiếp.
- Sau compaction, transcript bị thay bằng `[marker, summary, ...tail]` (`loop.ts:300`) → không còn
  assistant message nào mang `tokens` → footer về `—` cho tới lượt gọi LLM kế tiếp. Chấp nhận được:
  đúng ngay sau step đầu tiên của lượt sau, và phản ánh thực tế context vừa được giải phóng.

## 8. Kiểm thử

- `tests/unit/context-usage.test.ts` (mới): `contextTokens()` với các tổ hợp usage; hàm chọn mức
  cảnh báo (normal/warn/danger) quanh biên `0.8 × threshold` và `threshold`; trường hợp
  `limit = null`, `compactThreshold = null`.
- `tests/unit/agent-loop.test.ts` (mở rộng): assistant message được persist kèm `tokens`;
  `onUsage` được gọi một lần cho mỗi step (không phải một lần cho cả run); event `usage` được emit.
- `tests/unit/ipc-contract.test.ts` (mở rộng): kênh `AgentGetContext` có trong Channels, preload và
  `ipcMain.handle` — theo đúng pattern đã dùng cho `AgentGetVariants`.
- Kiểm tra tay: chạy app, gửi vài lượt, xác nhận footer cập nhật ngay sau mỗi step; restart app và
  xác nhận số vẫn còn; hạ `maxContextTokens` trong Settings → Context xuống mức thấp để thấy footer
  chuyển vàng rồi đỏ và auto-compact kích hoạt.
