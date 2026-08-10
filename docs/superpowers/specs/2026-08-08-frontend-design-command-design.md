# Meow Coding — Slash command `/frontend-design` : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Thêm built-in slash command `/frontend-design` cho native Meow agent, tương tự Claude Code: gõ
`/frontend-design <yêu cầu>` → command dispatch request tới skill `frontend-design` (đã bundle trong
`resources/skills/`) để agent load skill qua tool `skill` và làm theo nghiêm túc.

Chỉ làm 1 command (`frontend-design`), không sinh hàng loạt cho 5 skill — theo lựa chọn của user.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cách triển khai | Built-in command trong `CommandStore.builtin` (`src/main/agent/commands.ts`), mô phỏng đúng pattern `SUPERPOWERS_COMMANDS` đang có — dispatch request tới skill. |
| Tên command | `frontend-design` (không prefix `sp-`; khớp tên skill để agent tìm bằng `skill(name)`). |
| Template | Theo phong cách `sp-*`: hướng dẫn "Use the `frontend-design` skill ... strictly", kèm project context + `$ARGUMENTS`. |
| IPC/UI | **Không đổi** — command chảy qua pipeline có sẵn `listCommands` → `/` menu → `runCommand` → `resolveCommand`. |
| Loại bỏ | Không thêm `type: 'system'` (không phải system dispatch như `/new`); đây là command prompt bình thường. |

## 3. Kiến trúc / luồng dữ liệu

```
Renderer: gõ "/frontend-design redesign landing"
  └─ window.api.listCommands(cwd) → menu "/" hiển thị command (đã có)
  └─ window.api.runCommand(agentId, 'frontend-design', args)
       └─ MeowAgentManager.runCommand → CommandStore.get('frontend-design')
            └─ resolveCommand(template, args) → expand shell + @references
                 └─ prompt gửi LLM: "Use the `frontend-design` skill ... User request: redesign landing"
                      └─ agent gọi skill tool('frontend-design') → load nội dung từ resources/skills/frontend-design
```

## 4. Thành phần / file

| File | Loại | Nội dung |
|---|---|---|
| `src/main/agent/commands.ts` | sửa | Thêm `FRONTEND_DESIGN_COMMAND` (Command) + đăng ký vào `builtin` map. |
| `tests/unit/agent-commands.test.ts` | sửa | Assert: command có trong `list()`, template resolve `$ARGUMENTS` đúng kiểu skill dispatch. |

## 5. Xử lý lỗi

- Không có runtime error mới — `resolveCommand`/`expandReferences` xử lý như mọi command khác.
- Nếu skill `frontend-design` không tồn tại trong bundle → agent nhận `skill: unknown skill` từ tool
  (hành vi có sẵn); command vẫn chạy bình thường.

## 6. Kiểm thử

- Unit `tests/unit/agent-commands.test.ts`:
  - `CommandStore.list()` chứa `frontend-design`.
  - `resolveCommand(FRONTEND_DESIGN_COMMAND, args)` trả prompt chứa "Use the `frontend-design` skill",
    "Read @AGENTS.md before taking action.", và "User request:\n<args>".
- Bắt buộc: `npm run typecheck` pass, `npm test` pass.
- Không ảnh hưởng e2e (không đổi IPC/preload/renderer).

## 7. Tiêu chí thành công

- Gõ `/frontend-design` xuất hiện trong menu `/` của chat agent native.
- Gửi `/frontend-design <yêu cầu>` → agent load skill `frontend-design` và thực thi theo skill.
- Không phá command hiện có (init/review/sp-*), không phá test/typecheck.
