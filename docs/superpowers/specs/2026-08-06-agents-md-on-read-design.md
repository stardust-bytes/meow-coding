# Meow Coding — Auto-attach AGENTS.md when the LLM reads files (opencode-style) — Design

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

Bỏ cơ chế "nhồi toàn bộ AGENTS.md vào system prompt mọi turn". Thay bằng cơ chế giống opencode:
khi LLM **đọc/ghi file** qua tool (`read`/`edit`), main **tự động attach** các AGENTS.md gần file đó
(walk up tới git root) vào message LLM tiếp theo — để LLM "quét AGENTS.md khi vận hành" thay vì
nhận sẵn tất cả nội dung trong mỗi message.

## 2. Hiện trạng

- `src/main/agent/instructions.ts` `loadInstructions` + `instructionsText`: nhồi nội dung AGENTS.md
  (root + walk-up + userData) vào **system prompt** — mọi turn đều mang theo, tốn context.
- Tool `read`/`edit` không attach gì; LLM chỉ có AGENTS.md trong system prompt.
- `/sp-*` templates có `@AGENTS.md` (expand qua `expandReferences`, đã walk-up từ commit `300d9ef`).

## 3. Thiết kế mới

### 3a. Hook vào SessionRunner (`src/main/agent/loop.ts`)

- Track các file LLM đã đọc trong turn: khi tool `read`/`edit` chạy, ghi file path vào
  `readFiles: Set<string>` (per-turn, trong `run()`).
- Khi build LLM messages cho **turn kế tiếp** (`buildMessages`), với mỗi file đã đọc:
  - Walk up từ thư mục file tới git root (dừng ở `.git`/home, giống `loadInstructions`).
  - Tìm tất cả `AGENTS.md` trên đường đi, đọc nội dung (dedupe 1 lần/turn/file).
  - Chèn vào message: `Instructions from: <path>\n<content>`.
- Cơ chế chèn: nối vào **user message** cuối (hoặc thêm message phụ trước câu hỏi) — quyết định khi
  implement; mục tiêu là LLM nhận được context trước khi trả lời.
- Reset `readFiles` mỗi turn.

### 3b. System prompt chỉ còn pointer

- `meow-agent-manager.ts` `register()`: `system:` = `resolved.systemPrompt + modeNote + SKILL_LIST + INSTRUCTION_POINTER`.
- `INSTRUCTION_POINTER` (tiếng Anh, trong `instructions.ts`):
  > "Project rules live in AGENTS.md files. When you read or edit a file, relevant AGENTS.md files
  > (walking up from that file to the repo root) are attached automatically. Read @AGENTS.md at the
  > project root if you need the top-level rules before working."
- `loadInstructions` giữ nguyên logic tìm file (dùng cho attach), nhưng **không còn nhồi nội dung**
  vào system prompt qua `instructionsText` — thay bằng pointer.

### 3c. Giữ nguyên

- `expandReferences` `@AGENTS.md` trong `/sp-*` (vẫn hoạt động khi user gõ trực tiếp).
- Các tool khác (glob/grep/bash) không trigger attach — chỉ `read`/`edit`.
- `CLAUDE.md` cũng được quét (giữ trong `INSTRUCTION_FILES`).

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/main/agent/loop.ts` | Track readFiles; attach AGENTS.md vào messages khi build |
| `src/main/agent/instructions.ts` | Thêm `INSTRUCTION_POINTER`; `instructionsText` → pointer (giữ `loadInstructions` cho attach) |
| `src/main/agent/tools/read.ts` | Trả về path file đã đọc (qua toolCtx callback `onFileRead`) |
| `src/main/agent/tools/edit.ts` | Tương tự |
| `src/main/agent/tools/types.ts` | Thêm `onFileRead?: (path: string) => void` vào `ToolContext` |
| `src/main/meow-agent-manager.ts` | `system:` dùng pointer thay vì nhồi instructions |
| Tests | `agent-loop.test.ts` (attach khi read), `agent-instructions.test.ts` (pointer), `agent-message.test.ts` |

## 5. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS (test mới: read file → message kế có AGENTS.md; không read → không có; dedupe)
- `npm run build && npm run e2e` — PASS
- Manual: gõ prompt yêu cầu đọc file trong subdir → tool read → message sau có AGENTS.md module + root.

## 6. Out of scope

- Attach AGENTS.md cho tool bash/glob/grep (chỉ read/edit).
- Config UI toggle cho cơ chế này.
