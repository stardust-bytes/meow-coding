# Provider Limits Redesign — Design Spec

Ngày: 2026-08-26 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Claude Code và opencode kết nối nhiều provider mà không cần setting context/output, và rất ít khi
dính lỗi `max_tokens exceeds` hay context overflow. Meow thì ngược lại: bắt buộc có
`maxContextTokens`/`maxOutputTokens` trong settings, và liên tục lỗi vì giới hạn không được đồng bộ
(catalog models.dev khai báo deepseek-v4-flash output 384k, nhưng API thật của ollama.com chỉ nhận
65536 → request gửi `max_tokens: 131072` → provider reject 400).

Spec này thay "một catalog tĩnh + một setting" bằng một **hệ thống phân giải giới hạn nhiều tầng**
theo mô hình *"trust the provider, verify by error"*: giới hạn thật được khám phá từ provider lúc
runtime, `max_tokens` chỉ gửi khi đã xác minh (không biết thì bỏ hẳn), và mọi lỗi giới hạn đều tự
sửa — retry với budget đúng, hoặc compact-and-retry — thay vì làm chết cả turn.

Ngoài phạm vi: probe request riêng để đo giới hạn, thay đổi IPC contract, thay đổi `compaction`
settings, `maxSteps`/subagent.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Mô hình | "Trust the provider, verify by error" — estimate là heuristic, provider là sự thật |
| Nguồn giới hạn (thứ tự ưu tiên) | learned (từ lỗi thật) → live `/models` metadata → AI SDK `getModelConfig` (Anthropic/Google) → catalog models.dev → default 128k |
| `max_tokens` khi không biết output | **Bỏ hẳn** (provider tự chọn) — không thể lỗi `max_tokens exceeds` |
| Tách wire vs reserve | wire = output đã xác minh (hoặc omit); reserve = wire ?? 32k, chỉ dùng cho compaction/footer |
| Cap trên wire | Chỉ áp `MAX_OUTPUT_HARD_CAP` (131072) cho output lấy từ **catalog** (claim có thể vô lý, vd 1M); learned/live/sdk là sự thật của endpoint → tin tưởng nguyên giá trị |
| Lỗi `max_tokens exceeds` | `withRetry` giảm budget (đã có) + `onReducedBudget` ghi learned output |
| Lỗi context overflow | Loop `forceCompact()` (bỏ qua threshold) → retry step; chặn bởi `MAX_COMPACT_PER_RUN` |
| Learned limits | Persist `userData/learned-limits.json`, key `baseUrl\|model`, debounced |
| Settings UI | Bỏ `maxContextTokens`/`maxOutputTokens` khỏi settings chính; thành override nâng cao (mặc định auto) |
| `maxContextTokens`/`maxOutputTokens` trong config | Optional override (`number \| undefined`); khi set → thắng resolver nhưng vẫn được bảo vệ bởi 2 lớp tự sửa |
| ContextFooter | Hiển thị limit thật từ resolver; output chưa xác minh → nhãn "auto" |
| Live `/models` | Fetch nền (không chặn register), cache trong session |
| Retry sau compact | Không tốn step (`steps++`) |

## 3. Kiến trúc

```
meow-agent-manager (sở hữu cfg, catalog, learnedLimits, createLlm)
        │ dựng LimitsService + LearnedLimitsStore
        ▼
LimitsService.resolveLimits(provider, model, baseUrl, apiKey)
        │  learned → live /models (nền) → sdk getModelConfig → catalog → default
        ▼
{ context: number, output: number | null }        // output null = omit max_tokens
        │
        ├── register(): contextTokens, wire output, reserve
        ├── getContextInfo(): limit thật cho footer
        └── loop deps: maxContextTokens, maxOutputTokens (wire), outputReserve
```

### Component mới

| Component | Vị trí | Trách nhiệm |
|---|---|---|
| `LimitsService` | `src/main/agent/limits.ts` | Hợp nhất nguồn giới hạn theo thứ tự ưu tiên; trả `{ context, output: number \| null }`; cache trong session + background refresh `/models`; `parseLiveModelsInfo`, `matchModel`, `classifyContextOverflowError`, `parseContextLimitFromError` |
| `LearnedLimitsStore` | `src/main/agent/learned-limits.ts` | Persist `userData/learned-limits.json`; key `baseUrl\|model`; `recordMaxTokensLimit`, `recordContextOverflow`, `get`; debounced write như `SessionStore` |

### Component sửa đổi

| Component | Thay đổi |
|---|---|
| `models-catalog.ts` | `fetchLiveModels` → `fetchLiveModelsInfo` trả thêm limits (`context_window`/`max_context_length`/`context_length`, `max_output_tokens`/`max_tokens`/`output_tokens`) |
| `llm.ts` | `RetryOptions.onReducedBudget(realLimit)` — fire khi `reduceBudgetForMaxTokensError` parse được, ở cả 2 nhánh (thrown + error-part); `createLlm` nhận thêm tham số |
| `loop.ts` | Tách `compact()` khỏi `compactIfOverThreshold`; thêm `forceCompact()` (bỏ threshold check); compact-on-reject ở cả nhánh catch lẫn error-part; dep `onContextOverflow(promptTokens)`; retry không `steps++` |
| `config.ts` | `maxContextTokens`/`maxOutputTokens` optional override; `resolveOutputTokens` giữ nguyên cho reserve |
| `meow-agent-manager.ts` | Wire `LimitsService` + `LearnedLimitsStore` vào `register()`/`getContextInfo()`/`refreshModelLimits()`; truyền `onMaxTokensRejected` + `onContextOverflow` |
| Renderer settings | Bỏ context/output khỏi settings chính; `ContextFooter` dùng limit thật |

## 4. Data flow

### Luồng 1 — Turn đầu với model mới (vd `deepseek-v4-flash` trên ollama-cloud)

1. `register()` → `resolveLimits('ollama-cloud', 'deepseek-v4-flash', baseUrl, apiKey)`.
2. Learned: miss. Live `/models`: fetch **nền** → nếu trả limits → dùng cho resolve sau.
3. SDK config: n/a (OpenAI-compatible). Catalog: output=384k (sai cho endpoint này) → wire = min(384k, cap) = 131072.
4. Request gửi `max_tokens: 131072` → provider reject 400.
5. `withRetry` → `reduceBudgetForMaxTokensError` parse 65536 → retry `max_tokens: 65536` → **thành công**. `onReducedBudget(65536)` → learned ghi `output: 65536` cho `ollama.com/v1|deepseek-v4-flash`.
6. **Mọi turn sau** → learned thắng → wire = 65536 → không lỗi lại. (Nếu `/models` nền trả về trước, turn đầu đã đúng luôn.)

### Luồng 2 — Context overflow (estimate sai cao)

1. Estimate nói còn dư, provider reject "prompt is too long" (400).
2. `classifyContextOverflowError(message)` → true. Loop gọi `forceCompact()` — bỏ qua threshold check.
3. `forceCompact()`: prune tool outputs → head/tail compaction (marker + summary + tail verbatim) → summary fail → `hardTruncate`. Chặn bởi `MAX_COMPACT_PER_RUN` (2).
4. `continue` → retry step với transcript đã compact → thành công. Không emit lỗi, không tốn step.
5. `onContextOverflow(promptTokens)` → learned ghi `context = promptTokens` (trần) → turn sau compact sớm hơn.

### Luồng 3 — Turn bình thường (limit đã biết)

1. `resolveLimits` → `{ context: 200k, output: 64k }`.
2. wire = 64k (gửi `max_tokens: 64000`), reserve = 64k.
3. `compactIfOverThreshold` dùng `usableContextTokens(200k, buffer, 64k)` như hiện tại.

### Luồng 4 — Model không có metadata (vd proxy lạ)

1. Learned miss, `/models` fail/không trả limits, SDK n/a, catalog miss.
2. `{ context: 128000, output: null }` → **không gửi `max_tokens`** → không thể lỗi `max_tokens exceeds`.
3. reserve = 32k cho compaction. Provider reject context → Luồng 2 tự sửa.

## 5. Error handling & self-healing

| Lỗi | Phát hiện | Xử lý | Kết quả |
|---|---|---|---|
| `max_tokens exceeds model's maximum output tokens (N)` | `reduceBudgetForMaxTokensError` (đã có) | `withRetry` giảm budget → retry + `onReducedBudget(N)` ghi learned | Không lỗi hiển thị; turn sau dùng N luôn |
| Context overflow ("prompt is too long", "context length exceeded", "maximum context length", "context_length_exceeded", "exceeds the context window", "Please reduce the length of the messages") | `classifyContextOverflowError` (mới) | Loop `forceCompact()` → retry step (chặn bởi `MAX_COMPACT_PER_RUN`) + `onContextOverflow(promptTokens)` ghi learned trần | Không lỗi hiển thị; turn sau compact sớm hơn |
| Mọi lỗi khác (401, 403, 404, 429 hết retry, ...) | `classifyLlmError` (đã có) | Giữ nguyên: emit `{ type: 'error' }` một lần | Như hiện tại |

- `onReducedBudget` ghi `output = realLimit` chỉ khi parse được; không ghi khi budget không giảm được nữa (`reduced < budget` đã chặn).
- `onContextOverflow` ghi `context = promptTokens` (trần: context thật ≤ kích thước prompt bị reject).

### Edge cases

1. **Một message duy nhất lớn hơn context thật**: `forceCompact` → head = toàn bộ, tail = [] → `fitHeadToBudget` cắt đôi → summary call có thể tự fail → `compactTranscript` trả null → `hardTruncate` → retry vẫn fail → `compactedThisRun` đạt `MAX_COMPACT_PER_RUN` → **emit lỗi thật** (không loop vô hạn).
2. **Compaction LLM call bị reject context**: `compactTranscript` bắt lỗi → null → `forceCompact` fall `hardTruncate` (không cần LLM) → retry có thể thành công.
3. **Offline / `/models` fail**: learned + catalog + default vẫn hoạt động; chỉ mất độ chính xác, không mất chức năng.
4. **Retry không tốn step**: `continue` sau force-compact không `steps++`.
5. **Bất biến**: mọi đường tự sửa đều bounded — `MAX_COMPACT_PER_RUN` (2) cho compact, `maxAttempts` (3) cho retry. Hết khả năng tự sửa → lỗi thật emit một lần.

## 6. Config & UI

- `maxContextTokens`/`maxOutputTokens` → optional override (`number | undefined`). `undefined` = auto. Khi set → thắng resolver, nhưng vẫn được bảo vệ bởi withRetry + compact-on-reject.
- `DEFAULT_MAX_CONTEXT_TOKENS` (128k) / `DEFAULT_MAX_OUTPUT_TOKENS` (32k) giữ nguyên, chuyển vai trò thành fallback của `LimitsService`.
- `resolveOutputTokens` giữ chữ ký — dùng cho **reserve**, không còn là nguồn wire value.
- Settings UI: bỏ `maxContextTokens`/`maxOutputTokens` khỏi form chính.
- `ContextFooter`: hiển thị limit thật từ resolver; output chưa xác minh → nhãn "auto".
- Không đổi: `getContextInfo`/`ContextInfo` shape, `compaction` settings, `maxSteps`, IPC contract.

## 7. Testing

| File test | Nội dung |
|---|---|
| `tests/unit/agent-limits.test.ts` (mới) | Precedence learned > live > sdk > catalog > default; override cap; `output: null` khi không biết; cache TTL; `parseLiveModelsInfo` (các tên field, thiếu field); `matchModel` (exact / `:0731` prefix / contains); `classifyContextOverflowError`; `parseContextLimitFromError` |
| `tests/unit/agent-learned-limits.test.ts` (mới) | Round-trip persist; debounce; key normalization; không ghi khi không parse được |
| `tests/unit/agent-loop.test.ts` (mở rộng) | Stub ném context-overflow attempt 1 → `replaceItems` được gọi + attempt 2 thành công + không emit error; chặn bởi `MAX_COMPACT_PER_RUN`; retry không tốn step |
| `tests/unit/agent-llm-retry.test.ts` (mở rộng) | `onReducedBudget` fire ở cả 2 nhánh; không fire khi không parse được |
| `tests/unit/agent-config.test.ts` (mở rộng) | Optional overrides; `resolveOutputTokens` vẫn đúng cho reserve |

Đảm bảo: 930 test hiện tại pass, `npm run typecheck` pass, `npm run build && npm run e2e` (16 test) pass.

## 8. Thứ tự triển khai (mỗi bước TDD, commit riêng)

1. `LearnedLimitsStore` + test.
2. `parseLiveModelsInfo` + `matchModel` + `classifyContextOverflowError` + test.
3. `LimitsService.resolveLimits` + test.
4. `llm.ts`: `onReducedBudget` hook + `createLlm` tham số mới + test.
5. `loop.ts`: tách `compact()`, `forceCompact()` + compact-on-reject + `onContextOverflow` dep + test.
6. `config.ts`: optional overrides + test.
7. `meow-agent-manager.ts`: wire vào register/getContextInfo/refreshModelLimits.
8. Renderer: bỏ context/output khỏi settings; ContextFooter dùng limit thật.
9. AGENTS.md đồng bộ + full suite + e2e + commit.
