# ChatGPT Web Session as Provider (Experimental): Design Spec

Ngày: 2026-08-07 · Trạng thái: chờ duyệt

## 1. Mục tiêu

- Cho phép native agent "meow" dùng **phiên đăng nhập ChatGPT web** (browser automation, không phải API key)
  làm một **provider tuỳ chọn**, bên cạnh các provider chính thống hiện có (anthropic/google/openai-compatible).
- Cơ chế port lại (không phụ thuộc runtime) từ dự án tham khảo `codex-chatgpt-web`
  (Playwright điều khiển Chrome thật đăng nhập chatgpt.com, gõ prompt vào composer, đọc DOM trả về).
- **Cách ly hoàn toàn** khỏi luồng provider chính thống: tắt mặc định, người dùng tự bật/đăng nhập,
  không đổi behavior/API của các provider hiện có.

## 2. Bối cảnh kỹ thuật (đã xác nhận trong repo)

- `src/main/agent/llm.ts` định nghĩa `LlmClient { stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> }`
  — đây là interface duy nhất mà `loop.ts`/`session.ts` cần từ một "LLM backend". `LlmStreamPart.kind` gồm
  `text | reasoning | tool-call | finish | error`.
- Điểm nối provider → llm client hiện tại: `meow-agent-manager.ts:673`
  `const llmClient = (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)`.
- `resolveAgentConfig()` (`agent/config.ts`) tách `model` dạng `"provider/model"`, tra `ProviderSettings` tương ứng.
  `provider` là string tự do — không cần đổi type/schema để thêm giá trị `chatgpt-web`.
- `codex-chatgpt-web` (repo tham khảo) chạy Playwright thật (không reverse-engineer API nội bộ), lưu
  `storageState` sau khi người dùng đăng nhập thủ công, dựng local HTTP server giả lập OpenAI Responses API,
  và nén toàn bộ conversation + hướng dẫn hành xử vào một prompt lớn gõ thẳng vào composer.
  Vì tích hợp của mình chạy **in-process**, ta bỏ hẳn tầng HTTP server + SSE bridge của họ.

## 3. Quyết định kiến trúc

| Chủ đề | Quyết định |
|---|---|
| Vị trí code | Module mới `src/main/chatgpt-web/*`, không đổi `agent/llm.ts` |
| Điểm nối duy nhất | `meow-agent-manager.ts`: nếu `resolved.provider === 'chatgpt-web'` → `new ChatGptWebLlmClient(...)` thay vì `createLlm(...)` |
| Interface | `ChatGptWebLlmClient implements LlmClient` — cùng `stream()` trả `AsyncGenerator<LlmStreamPart>`, loop.ts không cần biết backend |
| Phạm vi | Hỗ trợ tool-calling đầy đủ ngay từ v1 (không chỉ chat text) — meow agent gọi bash/read/write/edit... qua backend này |
| Browser engine | Chrome/Chromium độc lập qua `playwright-core` (`chromium` hệ thống hoặc do người dùng chỉ định đường dẫn), tách biệt hoàn toàn khỏi Chromium của Electron |
| "Full mode" (MCP tunnel) của repo gốc | **Không port** — `loop.ts` đã tự thực thi tool cục bộ; chỉ cần ChatGPT trả tool-call dạng text để parse |
| Local HTTP server / SSE bridge của repo gốc | **Không port** — gọi trực tiếp in-process, không qua HTTP loopback |
| Model catalog | 5 "model" tĩnh: `chatgpt-web/light|medium|high|xhigh|pro`, map vào effort menu của ChatGPT |
| Lazy load | Module `chatgpt-web/*` (và `playwright-core`) chỉ được `import()` khi tính năng bật + có agent chọn provider này — tắt/chưa login = không có Chrome nào được spawn |
| Mặc định | Tính năng **tắt theo mặc định**; `defaultProvider` không bao giờ tự đổi sang `chatgpt-web` |
| Vị trí UI | Tab Settings **riêng biệt** "ChatGPT Web (Experimental)", không trộn vào `ProvidersTab.tsx` |

## 4. Auth & session

- `browser-login.ts`: nút "Login with ChatGPT" → mở Chrome **hiển thị** (`launchPersistentContext`,
  dùng Chrome cài sẵn qua `chromeExecutablePath`) tới `chatgpt.com/?temporary-chat=true`.
- Người dùng tự đăng nhập thủ công (CAPTCHA/2FA nếu có). Phát hiện composer hiển thị → xác nhận đăng nhập thành công.
- `session-store.ts`: lưu `context.storageState()` vào `userData/chatgpt-web/storage-state.json` (mode 0600)
  + file `*.verified.json` (kết quả lần verify gần nhất: `{ authenticated, verifiedAt }`).
- Lần dùng sau: Chrome **headless**, nạp lại `storageState` đã lưu. Cookie hết hạn → lỗi rõ ràng, yêu cầu login lại
  (không tự retry/tự mở lại browser hiển thị mà không hỏi).

## 5. Prompt & giao thức tool-call

- `prompt.ts`: nén `system + messages + tool schema` (từ `LlmStreamOptions`) thành một khối JSON, kèm hướng dẫn
  ChatGPT hành xử đúng vai trò và **khi cần gọi tool phải xuất fenced block** dạng:
  ` ```tool_call\n{"name": "...", "input": {...}}\n``` ` — không tự ý "diễn" kết quả tool.
- Gõ vào composer qua `page.keyboard.insertText` (chia chunk nếu dài), verify gõ đúng trước khi gửi.
- Chọn effort level bằng cách click đúng menu item tương ứng, verify qua `aria-checked`.

## 6. Đọc & parse phản hồi

- `browser-worker.ts`: poll DOM vùng trả lời, phân biệt "đang stream" (chưa có nút copy / còn nút stop) và
  "đã xong" (ổn định qua settle-window), convert HTML → Markdown (`turndown`).
- `response-parser.ts`: quét text đã convert theo thứ tự xuất hiện —
  - text thường → `{ kind: 'text', text }`
  - khối ` ```tool_call...``` ` hợp lệ (JSON parse được, có `name`) → `{ kind: 'tool-call', toolName, toolCallId, toolInput }`
    (`toolCallId` tự sinh vì ChatGPT không cấp)
  - kết thúc turn → `{ kind: 'finish', finishReason: 'stop' }`
- `client.ts` (`ChatGptWebLlmClient.stream()`) gói toàn bộ luồng trên thành `AsyncGenerator<LlmStreamPart>` đúng
  contract của `LlmClient` — đây là toàn bộ bề mặt tiếp xúc với phần code hiện tại.

## 7. Xử lý lỗi / fail-closed

- Phát hiện dialog rate-limit của ChatGPT (`"Too many requests..."`) → yield `{ kind: 'error', error: '...' }`,
  **không** tự retry, không tự đổi effort level.
- DOM selector không khớp (ChatGPT đổi UI) → lỗi rõ ràng ngay lập tức, không silent-fail/không đoán.
- Giới hạn tối đa **3 tab/phiên song song** (hằng số trong `browser-worker.ts`) để tránh bị coi là spam.
- Mọi lỗi trả về qua `kind: 'error'` giống các provider khác — `loop.ts` xử lý y hệt, không cần nhánh riêng.

## 8. UI/Settings

- Tab mới "ChatGPT Web (Experimental)" trong Settings, tách khỏi `ProvidersTab.tsx`.
- Nội dung: banner cảnh báo (browser automation không chính thức, rủi ro vỡ khi ChatGPT đổi UI, rủi ro ToS),
  nút Login/Logout, trạng thái phiên, toggle bật/tắt (mặc định tắt).
- Khi bật + đã login: `chatgpt-web` xuất hiện trong `ModelPicker` như mọi provider khác (5 model = 5 effort level).
- Không đổi `MeowConfig`/`AgentConfig` schema — `provider`/`model` vẫn là string tự do như hiện tại.

## 9. Kiểm thử

- Unit: `response-parser.ts` (parse text/tool-call/finish từ mẫu markdown giả lập), `prompt.ts` (nén context đúng
  format, không cần Chrome thật) — chạy trong CI.
- `meow-agent-manager.ts`: test nhánh rẽ chọn `ChatGptWebLlmClient` khi `provider === 'chatgpt-web'`, dùng client
  giả lập qua `deps.createLlm`-style injection — đảm bảo không phá test hiện có cho anthropic/google/openai-compatible.
- `browser-login.ts`/`browser-worker.ts`: không unit test được (phụ thuộc DOM thật) → smoke-test thủ công có
  hướng dẫn trong docs (tương tự lệnh `doctor`/`browser check` của repo tham khảo).

## 10. Tiêu chí thành công

1. Tắt tính năng (mặc định) → không có Chrome nào spawn, không ảnh hưởng agent dùng provider chính thống.
2. Bật + login thành công → `chatgpt-web` chọn được trong `ModelPicker`, agent dùng nó chat + gọi tool
   (bash/read/write/edit) qua parser tool-call.
3. Cookie hết hạn / ChatGPT đổi UI / rate-limit → lỗi rõ ràng, không crash agent loop, không tự động retry.
4. Test unit + typecheck xanh; không có provider chính thống nào bị ảnh hưởng hành vi.
