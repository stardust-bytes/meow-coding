# Meow Coding — Bundle Anthropic front-end/design skills : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Nhúng 5 skill front-end/design từ repo công khai [`anthropics/skills`](https://github.com/anthropics/skills)
(Apache-2.0) vào app giống cách đã làm với **superpowers** (plan
`2026-08-04-meow-superpowers-bundle.md`): đặt vào `resources/skills/<name>/`, để native Meow agent
load qua tool `skill` mà không cần cấu hình gì thêm.

5 skill chọn (toàn bộ nội dung liên quan, copy nguyên vẹn — **không chỉnh sửa**):

| Skill | Nội dung | Cỡ |
|---|---|---|
| `frontend-design` | SKILL.md + LICENSE.txt | 18 KB |
| `brand-guidelines` | SKILL.md + LICENSE.txt | 14 KB |
| `web-artifacts-builder` | SKILL.md + LICENSE.txt + `scripts/` (init-artifact.sh, bundle-artifact.sh, shadcn-components.tar.gz) | 46 KB |
| `theme-factory` | SKILL.md + LICENSE.txt + `themes/` (10 .md) + theme-showcase.pdf | 144 KB |
| `canvas-design` | SKILL.md + LICENSE.txt + `canvas-fonts/` (81 font .ttf + OFL) | 5.5 MB |

Không tạo sync script (copy một lần theo yêu cầu). Không thêm vào `.opencode/skills`.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Nguồn | `https://github.com/anthropics/skills/tree/main/skills/<name>` — copy nguyên thư mục skill (SKILL.md + LICENSE.txt + assets phụ). |
| Cách copy | **Verbatim**: giữ nguyên frontmatter + nội dung + cấu trúc thư mục. Không dịch, không sửa lời hướng dẫn claude.ai. |
| License | Giữ `LICENSE.txt` kèm từng skill (Apache-2.0). Copy nguyên vẹn → không phải ghi chú sửa đổi (§4(b) không áp dụng). |
| Vị trí | `resources/skills/<name>/` — đúng cơ chế bundle đang có (`collectSkills` → `builtinSkillsDir`). |
| Sync | Không thêm script; không đóng gói automation tải lại. |
| Code | **Không đổi** `skill.ts`, `tools/skill.ts`, registry, manager, index.ts, config, packaging. |
| UI/UX | Không đổi IPC/preload/renderer. |
| Nhận biết hành vi | Vài skill nhắc claude.ai "artifact" — chỉ là hướng dẫn; agent Meow sẽ ghi file vào workspace thay vì hiển thị artifact. Chấp nhận lệch này. |

## 3. Kiến trúc / luồng dữ liệu

Không có thay đổi kiến trúc — tận dụng pipeline skill có sẵn:

```
resources/skills/<name>/SKILL.md (+ assets)
   └─ collectSkills(cwd, userSkillsDir, builtinSkillsDir)   // src/main/agent/skill.ts
        └─ skillListText() → liệt kê vào system prompt
        └─ skill tool (src/main/agent/tools/skill.ts) → trả content + path hint
             └─ agent đọc file hỗ trợ (scripts/, themes/, canvas-fonts/) từ skill.path
```

- `loadSkills` đã xử lý cả dạng file `.md` phẳng lẫn thư mục `SKILL.md` (nhánh `entry.isDirectory()`) — không đổi gì.
- `extraResources` trong `package.json` đã đóng gói toàn bộ `resources/skills` → `skills` (packaged path: `process.resourcesPath/skills`).

## 4. Thành phần / file

| File | Loại | Nội dung |
|---|---|---|
| `resources/skills/frontend-design/{SKILL.md, LICENSE.txt}` | mới | Copy verbatim. |
| `resources/skills/brand-guidelines/{SKILL.md, LICENSE.txt}` | mới | Copy verbatim. |
| `resources/skills/web-artifacts-builder/{SKILL.md, LICENSE.txt, scripts/*}` | mới | Copy verbatim. |
| `resources/skills/theme-factory/{SKILL.md, LICENSE.txt, themes/*, theme-showcase.pdf}` | mới | Copy verbatim. |
| `resources/skills/canvas-design/{SKILL.md, LICENSE.txt, canvas-fonts/*}` | mới | Copy verbatim (~5.5 MB). |
| `tests/unit/agent-skill-bundled.test.ts` | sửa | Mở rộng danh sách 14 skill → 19 skill; thêm assert asset tồn tại trên đĩa cho skill mới. |

## 5. Xử lý lỗi

- Không có logic runtime mới — không có lỗi runtime cần xử lý ngoài cơ chế skill có sẵn.
- Nếu frontmatter skill bị thiếu `name`/`description` → `loadSkills` bỏ qua skill đó (hành vi có sẵn); test guard phát hiện thiếu.
- Nếu file asset bị thiếu trên đĩa → test guard (`agent-skill-bundled.test.ts`) fail → phát hiện khi copy.

## 6. Kiểm thử

- Unit `tests/unit/agent-skill-bundled.test.ts`: danh sách kỳ vọng 19 skill (14 cũ + 5 mới), mỗi skill có
  `description` và `content` hợp lệ, `skillListText` liệt kê `frontend-design`/`canvas-design`/...
- Assert file hỗ trợ tồn tại: `web-artifacts-builder/scripts/init-artifact.sh`,
  `theme-factory/themes/*.md` (≥1 file), `canvas-design/canvas-fonts/*.ttf` (≥1 file).
- Bắt buộc: `npm run typecheck` pass, `npm test` pass.
- Không ảnh hưởng e2e (không đổi IPC/preload/renderer). Vẫn chạy `npm run build && npm run e2e` nếu cần xác nhận.

## 7. Tiêu chí thành công

- `collectSkills(ROOT, undefined, resources/skills)` trả về 19 skill, gồm 5 skill mới với `name`/`description` đúng.
- Tool `skill` load được `frontend-design` và trả path hint trỏ tới `resources/skills/frontend-design`.
- System prompt của agent liệt kê các skill mới.
- Bản build (packaged) chứa `resources/skills/...` qua `extraResources`.
- Không phá test/typecheck hiện có.
