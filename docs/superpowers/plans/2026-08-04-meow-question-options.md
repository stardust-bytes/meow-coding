# Meow Coding — Hiển thị câu hỏi lựa chọn (multiple choice) theo opencode

**Goal:** Cho phép model hỏi câu hỏi **lựa chọn** và hiển thị các option để người dùng chọn (giống opencode), thay vì chỉ có ô nhập text. Tham khảo source opencode `D:\GitHub\opencode-1.18.11`:

- `packages/schema/src/question.ts` — `Question.Prompt { question, header, options: [{label, description}], multiple }`, `custom` (mặc định cho "Type your own answer").
- `packages/opencode/src/cli/cmd/run/footer.question.tsx` — render: option đánh số + description, ↑↓ chọn, Enter submit, **single-select submit ngay**, **multiple toggle `[✓]/[ ]` + Confirm**, kèm "Type your own answer".

**Phạm vi:** `src/shared/types.ts`, `src/main/agent/tools/types.ts`, `src/main/agent/tools/question.ts`, `src/main/agent/loop.ts`, `src/renderer/src/components/chat/ChatPanel.tsx`, `styles.css`. Không đổi IPC channel (tái dùng `prompt-request` + `respondPrompt`).

---

## Thiết kế

### shared/types.ts
```ts
export interface QuestionOption { label: string; description?: string }
export interface QuestionPrompt {
  question: string
  header?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}
```
Event `prompt-request` (kind `question`) thêm field: `options?`, `multiple?`, `custom?`.

### tools/types.ts
`ToolContext.ask(question: QuestionPrompt): Promise<string | null>`.

### question tool (`question.ts`)
Schema: `{ question, header?, options?: [{label, description?}], multiple?, custom? }`. `run` truyền nguyên `QuestionPrompt` vào `ctx.ask`; output `User answered: <answer>`.

### loop.ts
Callback `ask` của `ToolContext` phát `prompt-request` kind `question` kèm `options/multiple/custom`.

### Renderer (ChatPanel)
- `PendingPrompt` thêm `options/multiple/custom`.
- Nếu `options` có:
  - **Single**: click option → `respond(promptId, true, label)` ngay.
  - **Multiple**: click toggle `selectedOptions`; nút Send gửi `selectedOptions.join(', ')`.
  - Link "Type your own answer" (khi `custom !== false`) → hiện ô nhập text; Submit gồm cả custom text.
- Không `options` → giữ ô nhập text như cũ.
- Reset `selectedOptions`/custom khi respond/resetView.

### CSS
`.chat-options`, `.chat-option` (+`.selected`, `.custom`), `.chat-option-mark/label/desc` — flat, vuông, hover `--bg-hover`, selected `--bg-active` + viền trái accent.

## Kiểm thử
- `npm run typecheck`, `npm test`.
- `npm run build && npm run e2e`.
- Manual script Playwright: gửi `prompt-request` kind question kèm options → click option → xác nhận prompt đóng; multiple → toggle + Send.

---

## Task 1: shared + tool types + question tool + loop
- [ ] shared/types.ts: `QuestionOption`, `QuestionPrompt`, event fields.
- [ ] tools/types.ts: `ask(QuestionPrompt)`.
- [ ] question.ts: schema + run.
- [ ] loop.ts: emit options.
- [ ] typecheck.

## Task 2: Renderer + CSS
- [ ] ChatPanel: PendingPrompt + state + render options + handlers.
- [ ] styles.css: `.chat-options` block.
- [ ] typecheck + build.

## Task 3: Verify
- [ ] npm test.
- [ ] npm run build && npm run e2e.
- [ ] Script Playwright cho câu hỏi lựa chọn (single + multiple).
