# ChatGPT Web Provider — Manual Smoke Test

Automated tests cover every pure function (prompt compiling, response parsing,
model catalog, session store, manager facade). They cannot cover real browser
automation. Run this checklist by hand after any change to
`src/main/chatgpt-web/browser-worker.ts` or `browser-login.ts`, and before
each release that touches this feature.

## Prerequisites
- Google Chrome installed locally (or set a custom path via Settings → ChatGPT
  Web → will be exposed once the config UI for `chromeExecutablePath` is
  added — until then, edit `<userData>/chatgpt-web/config.json` directly).
- A ChatGPT account you're willing to use for browser automation.

## 1. Selector check (do this first, and after any ChatGPT UI change)
1. Open `https://chatgpt.com/?temporary-chat=true` in Chrome, signed in.
2. Open DevTools → Elements and confirm each selector in
   `src/main/chatgpt-web/browser-worker.ts`'s `SELECTORS` still matches:
   composer, send button, effort menu trigger + menu items, stop button,
   copy button, answer root, rate-limit dialog container.
3. Update `SELECTORS` if anything drifted; re-run `npx vitest run tests/unit/chatgpt-web-browser-worker.test.ts`
   (still passes — it doesn't depend on the real selectors) then proceed to step 2.

## 2. Login flow
1. `npm run dev`, open Settings → "ChatGPT Web (Experimental)", click Enable.
2. Click "Login with ChatGPT". A visible Chrome window should open to
   chatgpt.com. Sign in manually.
3. Within 5 minutes of the composer becoming visible, the app should report
   "logged in" with a verified timestamp. If it times out, check the console
   for the exact error.

## 3. First turn (text only)
1. In the chat panel, pick an agent using the native `meow` template, open the
   model picker, and select `chatgpt-web / medium`.
2. Send a simple prompt ("what's 2+2?"). A headless Chrome should launch
   briefly; the answer should appear in the chat panel once ChatGPT finishes
   responding (there is no live token streaming for this provider — see the
   plan's Task 7 note).

## 4. Tool-call turn
1. Ask the agent to do something that requires a tool, e.g. "list the files in
   this project's root directory."
2. Confirm the agent actually runs `bash`/`glob` (visible as a tool-call card
   in the chat UI) rather than the raw `tool_call` JSON block leaking into the
   visible answer text.

## 5. Failure paths
1. Log out, then try sending a message on the chatgpt-web provider again —
   should fail with a clear "not logged into ChatGPT Web" error, not a crash.
2. (Optional, hard to trigger deliberately) If you hit ChatGPT's own
   rate-limit dialog, confirm the agent surfaces a clear rate-limit error
   instead of hanging or silently retrying.

## 6. Isolation check
1. Switch the same agent back to an anthropic/google/openai-compatible model
   and confirm it still works exactly as before — this feature must never
   affect the official providers.
2. With the chatgpt-web provider disabled (Settings toggle off), confirm no
   Chrome process is spawned by the app at all (check your OS process list).
