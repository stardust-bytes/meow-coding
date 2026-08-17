# Giảm token tiêu thụ so với opencode — Design spec

Ngày: 2026-08-17 · Trạng thái: approved

## Vấn đề

Người dùng nhận thấy làm việc với Meow Coding tiêu tốn nhiều token hơn opencode
trên cùng model. Phân tích so sánh với source opencode (`provider/transform.ts`,
`session/overflow.ts`, `session/compaction.ts`) tìm ra các điểm khác biệt.

## Nguyên nhân gốc

1. **Không có prompt caching (lớn nhất)** — `src/main/agent/llm.ts` không đặt
   `cacheControl` cho Anthropic. opencode đặt `cacheControl: {type:"ephemeral"}`
   trên 2 system messages + 2 messages cuối mỗi request → phần prefix ổn định
   được đọc từ cache (0.1× thay vì 1.0× input price). Với session dài nhiều tool
   call, meow trả full input price mỗi turn.
2. **Usage/cost ghi thiếu** — `onUsage` hardcode `cacheRead: 0, cacheWrite: 0`;
   `toMessageTokens` bỏ `cacheCreationInputTokens` → UI hiển thị token/cost không
   phản ánh cache (kể cả khi cache tồn tại).
3. **Compaction ước lượng bằng `chars/4`** — `estimateUsage` dưới-ước lượng token
   thật của JSON → compact trễ → giữ nhiều context → tốn input token mỗi turn.
   opencode dùng token thật model trả về (`tokens.input + output + cache.read +
   cache.write`) so với `model.limit.context`.
4. **System prompt nặng** — base prompt có câu dư thừa "use the search tools
   extensively"; `skillListText` có preamble dài. Toàn bộ `system` gửi lại mỗi
   request.
5. **Tool descriptions dài** — bash/browser/office mô tả nhiều câu thừa, gửi mỗi
   request (cache sẽ giảm tác động sau #1).
6. **Fallback `maxContextTokens = 200k`** — khi model không có limit trong
   models.dev catalog, dùng 200k có thể vượt context thật của model (128k) →
   compaction không kích hoạt đúng lúc.

## Thiết kế

### #1 Prompt caching (Anthropic) — `src/main/agent/llm.ts`

- Helper `withCacheBreakpoints(messages, provider)`: với `provider === 'anthropic'`,
  gắn `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }`
  vào message đầu tiên và message cuối cùng. Provider khác giữ nguyên (OpenAI/
  DeepSeek/Gemini tự cache prefix; gửi `cache_control` thừa có thể gây lỗi).
- `stream()`: `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } },
  ...variantOptions }` → cache system prompt.
- Giới hạn SDK: tối đa 4 cache breakpoints/request (ta dùng 3: system + đầu + cuối).

### #2 Wire cache vào usage/cost

- `shared/types.ts`: thêm `cacheWrite?: number` vào `MessageTokens`.
- `llm.ts` `toMessageTokens`: map `cacheCreationInputTokens` → `cacheWrite`
  (hiện đang bỏ qua); `SdkUsage` thêm `cacheCreationInputTokens`.
- `meow-agent-manager.ts`:
  - `onUsage`: dùng `tokens.cacheRead ?? 0`, `tokens.cacheWrite ?? 0` thay vì hardcode 0.
  - `computeCost`: truyền đủ `input/output/cacheRead/cacheWrite` vào `calcCost`
    (hàm đã hỗ trợ cacheRead/cacheWrite pricing).

### #3 Compaction dùng token thật — `src/main/agent/loop.ts`, `token.ts`

- SessionRunner lưu `lastTokens?: MessageTokens` từ `finish` part mỗi turn.
- `maybeCompact`: khi có `lastTokens`, dùng
  `tokens.total || (input + output + cacheRead + cacheWrite)` so với `usable`;
  fallback `estimateUsage` khi chưa có turn nào (hoặc total = 0).
- `token.ts`: `CHARS_PER_TOKEN` 4 → 3.5.

### #4 Gọn system prompt — `config.ts`, `skill.ts`

- Bỏ câu "You are encouraged to use the search tools extensively both in parallel
  and sequentially." khỏi system prompt mặc định.
- `skillListText`: thay preamble dài bằng 1 câu ngắn gọn; giữ name + description.

### #5 Gọn tool descriptions — `src/main/agent/tools/*.ts`

- Rút gọn description dài: `bash` (nén đoạn Windows), `browser_*`, `office`.
- Không cắt schema.

### #6 Fallback context — `config.ts`

- `DEFAULT_MAX_CONTEXT_TOKENS`: 200000 → 128000 (chỉ là fallback khi model
  không có limit trong catalog).

## Phạm vi ngoài

- Không đổi cơ chế compaction hiện có (keepTokens/tailTurns/prune) trừ overflow check.
- Không đổi luồng PTY / renderer / browser extension.
- Không đổi default permission.

## Kiểm thử

- Unit: `agent-llm.test.ts` (cache breakpoints — anthropic có, others không;
  toMessageTokens map cacheWrite), `agent-loop.test.ts` (overflow dùng token thật),
  `agent-usage.test.ts`, `agent-config.test.ts` (default 128k), `agent-skill.test.ts`
  (skillListText), `agent-tools*.test.ts` (description không rỗng).
- Bắt buộc: `npm run typecheck` + `npm test` pass.
