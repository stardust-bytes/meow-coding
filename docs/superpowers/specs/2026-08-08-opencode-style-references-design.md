# Meow Coding — Opencode-style references & slash args : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Điều chỉnh hành vi reference (`@file`, `@AGENTS.md`) và slash command của native Meow agent theo
đúng cách opencode làm, để:

1. **`$ARGUMENTS` giữ nguyên format** — nội dung sau slash không bị flatten (mất newline/thụt lề/code
   block) khi ghép vào template.
2. **AGENTS.md được gắn vào mọi turn chat** — walk-up từ cwd của agent tới project root (giống
   `Instruction.system()` của opencode), không chỉ khi model đọc file (attach-on-read đã có).
3. **Bỏ cap 32KB cho AGENTS.md/CLAUDE.md** — đọc toàn bộ như opencode; file thường bị cắt được
   hướng dẫn đọc tiếp (giống `Use offset=... to continue`).
4. **Fix `expandReferences` chạy 2 lần** — hiện tại `resolveCommand` expand rồi `runTurn` expand lại
   → nội dung phình/trùng.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| `$ARGUMENTS` | Renderer truyền **raw string** sau tên command (không trim/split) qua IPC; `resolveCommandTemplate` thay `$ARGUMENTS` bằng nguyên trạng. Placeholder số `$1..$n` vẫn tách bằng regex quote-aware (giống opencode `argsRegex`). |
| IPC contract | `runCommand(agentId, name, args: string)` — đổi type `string[]` → `string` ở `src/shared/ipc.ts`, `preload`, main handler. |
| AGENTS.md mọi turn | Thay `INSTRUCTION_POINTER` (chữ chỉ dẫn) bằng **nội dung thật** `instructionsText(loadInstructions(cwd, userDataDir))` trong system prompt. Format `Instructions from: <path>\n<content>` (đã có). |
| Attach-on-read | **Giữ nguyên** `loop.ts attachInstructions()` (module-level khi model đọc/ghi file) — đã hoạt động đúng như opencode. |
| Cap dung lượng | AGENTS.md/CLAUDE.md: **bỏ cap** (đọc toàn bộ). File `@` thường: cap **50KB** (khớp `MAX_BYTES = 50*1024` opencode) + hướng dẫn đọc tiếp. |
| Double expand | Bỏ `expandReferences` trong `resolveCommand` (giữ `resolveShell`); `runTurn` là nơi expand duy nhất. |
| System prompt cache | Prompt được build ở `register()`; refresh khi đổi model/variant/agent. Không tự reload khi AGENTS.md đổi giữa chừng (chấp nhận cho v1, ghi rõ). |

## 3. Kiến trúc / luồng dữ liệu

### 3.1 Slash command — `$ARGUMENTS` nguyên trạng

```
Renderer ChatPanel.send():
  m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  window.api.runCommand(agentId, m[1], m[2] ?? '')          ← raw string

Main MeowAgentManager.runCommand(agentId, name, args: string)
  └─ resolveCommand(command, args, {cwd, commands})
       ├─ resolveCommandTemplate: $ARGUMENTS → args (nguyên trạng)
       │                         $1..$n → tokenize quote-aware
       ├─ resolveShell (giữ nguyên)
       └─ (bỏ expandReferences — chuyển về runTurn)
  └─ send(agentId, text)
       └─ runTurn → expandReferences (1 lần) → lưu user message → runner.run()
```

### 3.2 AGENTS.md gắn mọi turn — system prompt

```
register(agent):
  system = resolved.systemPrompt
         + modeNote
         + instructionsText(loadInstructions(agent.cwd, userDataDir))   ← thay INSTRUCTION_POINTER
         + skillListText(skills)
runner.run() → llm.stream({ system, messages })
```

Turn đầu gọi `/sp-brainstorming <yêu cầu>` → model nhận đủ AGENTS.md root + ancestor của cwd trong
system prompt, kèm yêu cầu user (nguyên trạng) trong user message.

## 4. Thành phần / file

| File | Thay đổi |
|---|---|
| `src/renderer/src/components/chat/ChatPanel.tsx` | Gửi `m[2] ?? ''` thay vì `m[2].trim().split(/\s+/)`. |
| `src/shared/ipc.ts` | `AgentApi.runCommand` — `args: string`. |
| `src/preload/index.ts` | Pass-through `args: string`. |
| `src/main/index.ts` | Handler `ChatRunCommand` nhận `args: string`. |
| `src/main/agent/commands.ts` | `resolveCommandTemplate` nhận raw string; `$ARGUMENTS` nguyên trạng; `$1..$n` quote-aware tokenize; bỏ `expandReferences` trong `resolveCommand`. |
| `src/main/agent/references.ts` | Bỏ cap cho AGENTS.md/CLAUDE.md; file thường cap 50KB + hint `use the read tool with offset`; chuẩn hóa hằng số. |
| `src/main/agent/instructions.ts` | Không đổi logic (hàm có sẵn được dùng); có thể thêm helper `isInstructionFile` nếu cần dùng chung. |
| `src/main/meow-agent-manager.ts` | `runCommand` type `args: string`; system prompt dùng `instructionsText(loadInstructions(...))` thay `INSTRUCTION_POINTER`. |
| `src/main/agent/tools/read.ts` | Giữ offset/limit + hint phân trang (đã có); chỉ kiểm tra nhất quán với cap mới. |

## 5. Chi tiết kỹ thuật

### 5.1 `resolveCommandTemplate(template, args: string)`

- `$ARGUMENTS` → thay bằng `args` nguyên trạng (giữ newline, thụt lề, code block).
- `$N` (N ≥ 1) → tokenize `args` bằng regex quote-aware:
  `/(?:[^\s"']+|"[^"]*"|'[^']*')/g`; placeholder có chỉ số cao nhất được tham chiếu vẫn slurp phần
  còn lại của args (giữ behavior cũ của meow).
- Không có placeholder trong template → không đổi (chỉ `$ARGUMENTS` mới thay).

### 5.2 Cap dung lượng trong `expandReferences`

- Nhận diện instruction file bằng basename ∈ {`AGENTS.md`, `CLAUDE.md`} → đọc toàn bộ.
- File khác: nếu `content.length > 50 * 1024` → cắt + append:
  `\n...(truncated at 50KB — use the read tool with offset to read the rest)`.
- Giữ nguyên behavior walk-up tìm file (đã có, khớp `loadInstructions`).

### 5.3 System prompt — gắn AGENTS.md

- `instructionsText(loadInstructions(cwd, userDataDir))` trả chuỗi:
  ```
  Instructions from: <path1>
  <content1>

  Instructions from: <path2>
  <content2>
  ```
- `INSTRUCTION_POINTER` không còn được dùng cho system prompt (có thể xóa export hoặc giữ cho
  tương thích — quyết định khi implement).

## 6. Kiểm thử

- **Unit** (`tests/unit/`):
  - `agent-commands.test.ts`: `resolveCommandTemplate` với raw string (newline giữ nguyên), `$1..$n`
    quote-aware, `resolveCommand` không còn expand references.
  - `agent-references.test.ts`: AGENTS.md đọc toàn bộ (file > 32KB vẫn full); file thường cắt 50KB +
    hint đọc tiếp; cases cũ không đổi.
  - `agent-instructions.test.ts`: `instructionsText(loadInstructions(...))` — không đổi hành vi.
  - `parse-command-input.test.ts`: giữ nguyên (parse không đổi).
- **Typecheck** (`npm run typecheck`) pass.
- **Unit + integration** (`npm test`) pass.
- **E2E**: nếu ảnh hưởng (`npm run build && npm run e2e`).

## 7. Tiêu chí thành công

- Gõ `/sp-brainstorming` + nội dung nhiều dòng → LLM nhận nội dung nguyên trạng (giữ newline/code
  block) trong user message.
- Turn đầu của mọi turn chat có AGENTS.md (root + ancestor của cwd) trong system prompt.
- AGENTS.md dài (> 32KB) được đọc toàn bộ, không cắt.
- `@file` thường > 50KB bị cắt có hướng dẫn đọc tiếp; model có thể dùng read tool với offset.
- Không còn hiện tượng "Referenced files" trùng lặp do expand 2 lần.
- Không phá command hiện có (init/review/sp-*/frontend-design), không phá test/typecheck.
