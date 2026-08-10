import { readFileSync, writeFileSync } from 'node:fs'
const path = 'docs/superpowers/plans/2026-08-07-chatgpt-web-provider.md'
const content = readFileSync(path, 'utf8')
const append = `

> **Update 2026-08-07 (persistent profile + Cloudflare fallback):**
> The original smoke-test steps above still apply for selector drift detection.
> After applying the persistent-profile fix, also walk through the following
> 6-step procedure (from spec docs/superpowers/specs/2026-08-07-chatgpt-web-persistent-profile-design.md §10.2):
>
> 1. **Fresh install + login.** Open Settings → "Login ChatGPT Web". A visible Chrome opens; sign in manually; close it. Verify both userData/chatgpt-web/storage-state.json and userData/chatgpt-web/browser-profile/Cookies exist.
> 2. **Headless chat turn.** Send a message through the chatgpt-web provider. Chat flow opens a headless Chrome; response returns normally.
> 3. **Profile survives missing JSON.** Delete storage-state.json, keep browser-profile/. Send another message — it still works (browser-profile is the source of truth; ephemeral context loads from it).
> 4. **Fallback to visible on Cloudflare.** Corrupt browser-profile/Cookies (e.g., empty it). Send a message — a visible Chrome window pops up + the renderer toast "[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở." Solve the challenge; chat resumes.
> 5. **Logout wipes everything.** Logout from Settings. Verify both storage-state.json and browser-profile/ are deleted.
> 6. **Re-login creates fresh profile.** Login again from Settings. Verify a new browser-profile/ is created and the chat flow works.
`
writeFileSync(path, content + append)
console.log('OK')