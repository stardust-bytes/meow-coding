# Meow Coding — chatgpt-web: open visible browser on Cloudflare challenge — Plan

**Goal:** Khi chat với ChatGPT Web gặp Cloudflare (lúc load hoặc giữa turn), tự mở cửa sổ Chrome
visible để user verify; đợi composer quay lại rồi tiếp tục/retry. Tránh lỗi mơ hồ khi title không phải
"Just a moment...".

**Vấn đề hiện tại:** `runChatGptWebTurn` chỉ fallback khi `title.includes('just a moment')` (fragile).
Title CF khác (VD "Attention Required!", "Verify you are human") → `throw err`, không mở browser.
Không xử lý challenge xuất hiện giữa turn.

**Thay đổi** (`src/main/chatgpt-web/browser-worker.ts`):

1. `ChatGptWebPage` thêm `count(selector)` (wrapper thật dùng `page.locator().count()`).
2. `detectChallenge(page)`: detect bằng selectors CF (`iframe[src*="challenges.cloudflare.com"]`,
   `#challenge-form`, `.cf-challenge`, `#challenge-running`, `#turnstile-wrapper`,
   `[data-testid="cf-turnstile"]`, `form[action*="__cf_chl"]`) + URL (`challenges.cloudflare.com`,
   `__cf_chl`) + title regex.
3. `runTurnBody`:
   - Sau `goto`, poll chờ composer HOẶC challenge (30s): challenge → `onFallback('cloudflare')` +
     `recreate('visible')` + `goto` + `waitForSelector(composer)` → tiếp tục. Login → lỗi [meow].
   - Mỗi vòng poll giữa turn: nếu `detectChallenge` → fallback + recreate visible + chờ composer +
     **gửi lại prompt** rồi `continue`.
   - Tách `sendPrompt(page, prompt, effort)` (chọn effort + nhập + gửi), dùng cho load đầu và retry.

**Tests:** update `tests/unit/chatgpt-web-browser-worker.test.ts` (fakePage thêm `count`; thêm case
mid-turn challenge + case title lạ vẫn detect). Giữ case cloudflare/login/abort hiện có.

**Verify:** `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
