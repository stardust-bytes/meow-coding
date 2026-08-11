# Meow Coding — Align AGENTS.md handling with opencode — Design

Ngày: 2026-08-11 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

LLM trong meow rất ít khi chủ động quét/đọc AGENTS.md, nhất là các file module-level nằm trong
thư mục con của project. Đối chiếu với opencode (`D:\GitHub\opencode`): chỗ nào giống thì giữ,
chỗ nào khác thì chỉnh cho giống, chỗ nào opencode không có thì bỏ.

Mục tiêu cụ thể:
- System prompt chỉ nhúng global + root-level AGENTS.md (1 loại ưu tiên), giống opencode.
- Attach-on-read nhét AGENTS.md vào chính output của tool `read` dạng `<system-reminder>`,
  dedupe cross-message, chỉ trigger ở `read` (bỏ `edit`).
- Base system prompt thêm câu khuyến khích dùng search tools (giống opencode default.txt).
- Giữ nguyên `@AGENTS.md` trong command templates (file reference → content như `@file` khi chat).

## 2. Cơ chế opencode (đối chiếu)

Nguồn: `D:\GitHub\opencode\packages\opencode\src\session\instruction.ts`,
`src\tool\read.ts`, `src\session\prompt.ts`, `src\session\prompt\default.txt`.

### 2a. System prompt (`Instruction.system`)

- Global: file đầu tiên tồn tại trong
  `[~/.config/opencode/AGENTS.md, ~/.claude/CLAUDE.md]` → `Instructions from: <path>\n<content>`.
- Project: `findUp('AGENTS.md' | 'CLAUDE.md' | 'CONTEXT.md', directory, worktree)` — ưu tiên
  **một loại** (AGENTS.md > CLAUDE.md > CONTEXT.md), lấy tất cả match của loại đầu tiên tìm thấy
  trên đường walk-up tới worktree root. Không nhúng module-level AGENTS.md vào system prompt.

### 2b. Attach-on-read (`Instruction.resolve` + `tool/read.ts`)

- Khi model `read` 1 file: walk up từ thư mục file tới project root; mỗi dir tìm file instruction
  đầu tiên (`find`); nối vào **chính output của read**:
  ```
  <system-reminder>
  Instructions from: <path>
  <content>
  </system-reminder>
  ```
- Dedupe:
  - Per-message: `claims: Map<MessageID, Set<string>>`.
  - Cross-message: `extract(messages)` đọc metadata `loaded` từ các tool-result read trước đó;
    không attach lại file nào đã từng đính kèm.
- Skip file đã có trong system prompt (`sys.has(found)`).
- Chỉ trigger ở `read` — không trigger ở `edit`/`write`.

### 2c. Command `@file` reference

- `resolvePromptParts` → `ConfigMarkdown.files(template)`: `@file` trong template command thành
  `{ type: 'file', url: file://... }` — model nhận content như `@file` khi chat. Không liên quan
  đến instruction attach.

### 2d. Base prompt (default.txt:72)

> "Use the available search tools to understand the codebase and the user's query. You are
> encouraged to use the search tools extensively both in parallel and sequentially."

Không nhắc AGENTS.md trong base prompt — việc quét chủ động đến từ template `/sp-*` + skills.

## 3. Thiết kế mới cho meow

### 3a. System prompt: global + root-level, 1 loại ưu tiên (`src/main/agent/instructions.ts`)

- **Global (home dir, thay userData):** đọc file đầu tiên tồn tại trong
  `[~/.config/meow/AGENTS.md, ~/.claude/CLAUDE.md]`. Bỏ tham số `userDataDir` khỏi
  `loadInstructions(cwd)`; `meow-agent-manager.ts` bỏ truyền `this.deps.userInstructionsDir`.
- **Project (walk up từ cwd tới git root/home):** ưu tiên **một loại** — 2 pass:
  1. Pass 1: walk-up, kiểm tra có tồn tại bất kỳ `AGENTS.md` nào trên đường đi không.
  2. Pass 2: nếu có → chỉ collect các `AGENTS.md`; nếu không → collect các `CLAUDE.md`.
  Bỏ CONTEXT.md (opencode đánh dấu deprecated).
- Giữ format `Instructions from: <path>\n<content>` (đã giống opencode).
- `instructionFilesForFile` giữ nguyên logic walk-up (tới git root/home), dùng cho read tool.

### 3b. Attach-on-read: nhét vào read output, dedupe cross-message (`loop.ts` + `tools/read.ts`)

- **Bỏ** `attachInstructions()` + `readFiles` tracking trong `SessionRunner` (`loop.ts`): không còn
  user message riêng "Relevant project instructions".
- **Thay `ctx.onFileRead` bằng callback mới trong `ToolContext`** (đổi contract, không phá tool khác):
  ```
  onFileRead?(filePath: string): string  // trả reminder text (rỗng nếu không có/đã attach)
  ```
  `SessionRunner` implement callback: walk up từ thư mục file tới git root/home, tìm file
  instruction đầu tiên mỗi dir (AGENTS.md ưu tiên, CLAUDE.md fallback — giống `instructionFilesForFile`
  với single-type priority), bỏ qua file đã attach, thêm path vào `Set<string>` đã-attach, trả về
  `<system-reminder>...` text.
- **Tool `read`** (`src/main/agent/tools/read.ts`): sau khi đọc nội dung, gọi
  `ctx.onFileRead?.(full)`; nếu trả về text non-empty thì nối vào cuối output:
  ```
  <system-reminder>
  Instructions from: <path>
  <content>
  </system-reminder>
  ```
  `edit.ts`: **bỏ** `ctx.onFileRead?.(full)` (chỉ read trigger).
- **Dedupe cross-message:** `Set<string>` đã-attach sống trong `SessionRunner` (theo session),
  không reset mỗi turn — skip file đã đính kèm trong toàn bộ transcript. Skip file đã có trong
  system prompt (so với path set của `loadInstructions`).

### 3c. Base prompt: khuyến khích search tools (`src/main/agent/config.ts`)

Thêm nguyên văn vào `DEFAULT_MEOW_CONFIG.agents.meow.systemPrompt` (cuối đoạn hiện tại):

> "Use the available search tools to understand the codebase and the user's query. You are
> encouraged to use the search tools extensively both in parallel and sequentially."

### 3d. Giữ nguyên

- `@AGENTS.md` trong command templates: `expandReferences` (`references.ts`) giữ nguyên — expand
  content như `@file` khi chat (đã giống opencode).
- Template `/sp-*` trong `SUPERPOWERS_COMMANDS` (`commands.ts`): giữ nguyên dòng
  "Read any relevant module-level `AGENTS.md` files...".

## 4. Chi tiết thay đổi file

| File | Thay đổi |
|---|---|
| `src/main/agent/instructions.ts` | `loadInstructions(cwd)` bỏ `userDataDir`; đổi global sang home dir; project chỉ 1 loại ưu tiên (2-pass AGENTS.md > CLAUDE.md), bỏ CONTEXT.md; `instructionFilesForFile` thêm single-type priority + tham số skip-set |
| `src/main/agent/tools/types.ts` | `ToolContext.onFileRead` đổi kiểu: `(filePath: string) => string` (trả reminder text, rỗng nếu không có/đã attach) |
| `src/main/agent/tools/read.ts` | Sau khi đọc, gọi `ctx.onFileRead?.(full)`, nối text non-empty vào output dạng `<system-reminder>`; bỏ dùng trực tiếp `instructionFilesForFile` |
| `src/main/agent/loop.ts` | Bỏ `attachInstructions()` + `readFiles` + `instructionFilesForFile` import; implement callback `onFileRead` cho ToolContext với dedupe `Set<string>` cross-message + skip system-prompt paths |
| `src/main/agent/tools/edit.ts` | Bỏ `ctx.onFileRead?.(full)` |
| `src/main/meow-agent-manager.ts` | Bỏ truyền `userInstructionsDir` vào `loadInstructions`; bỏ field `userInstructionsDir` khỏi deps nếu không dùng nơi khác |
| `src/main/index.ts` | Bỏ truyền `userInstructionsDir: app.getPath('userData')` |
| `src/main/agent/config.ts` | Thêm câu search-tools vào default systemPrompt |

Ghi chú thêm:
- **Skip đọc chính file instruction:** nếu model `read` đúng file `AGENTS.md`/`CLAUDE.md` thì không
  attach chính file đó làm reminder (tránh lặp) — giống opencode `found === target`.
- **Compaction:** khi transcript bị compact (nén lịch sử), các AGENTS.md đã attach trong phần bị nén
  có thể "mất dấu" — chấp nhận (opencode cũng skip `time.compacted`). Không reset `Set` đã-attach
  khi compact.

## 5. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS; cập nhật/viết test mới:
  - `instructions.ts`: loadInstructions chỉ lấy AGENTS.md khi tồn tại (bỏ CLAUDE.md song song);
    global từ home dir (không còn userData).
  - `read.ts`: đọc file trong subdir → output có `<system-reminder>` + `Instructions from: <path>`;
    file không có instruction gần → không có reminder; file đã attach → không attach lại.
- `npm run build && npm run e2e` — PASS
- Manual: `/sp-brainstorming` trong project có module-level AGENTS.md → model tự glob/grep/read
  AGENTS.md; đọc file trong subdir → tool output có reminder.

## 6. Out of scope

- Attach-on-read cho tool `edit`/`write` (bỏ, theo opencode).
- Config UI toggle cho cơ chế này.
- Hỗ trợ `CONTEXT.md` (opencode deprecated).
