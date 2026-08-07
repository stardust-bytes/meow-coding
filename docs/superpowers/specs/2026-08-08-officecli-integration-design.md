# Meow Coding — OfficeCLI Integration (native tool `office`) : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Cho native Meow agent tạo/sửa Word (.docx), Excel (.xlsx), PowerPoint (.pptx) bằng cách gọi
[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0, single binary, không cần cài
Office). Agent điều khiển document thông qua một native tool mới `office` trong tool registry:
spawn one-shot subprocess `officecli`, trả output JSON về agent.

Không chọn "clone logic" (OfficeCLI là app .NET ~hàng trăm nghìn dòng: OOXML manipulation, formula
engine, pivot, HTML rendering engine) — không thực tế khi reimplement trong codebase TS. Thay vào đó
**nhúng binary** binary đã phát hành.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cách có binary | Tool `office` kiểm tra PATH trước; nếu thiếu, tự tải binary theo platform/arch về `userData/officecli/`. Không đóng gói binary trong release. |
| Cách thực thi | **One-shot** mỗi lần gọi: spawn `officecli <args>` rồi thoát. Không duy trì resident session (OfficeCLI tự dùng resident nội bộ 60s idle nên latency chấp nhận được). |
| Phạm vi | Chỉ native tool `office` qua subprocess. **Không** preview tài liệu trong app, không thêm agent template riêng. |
| Schema tool | `{ args: string[], timeoutMs?: number }` — mảng argv (tránh lỗi quoting), spawn `[binary, ...args, '--json']` nếu args chưa có `--json`. |
| Cwd | `ctx.cwd` (thư mục project của agent). |
| Quyền | Mặc định `office: 'ask'` (side-effect tạo/sửa file). |
| IPC | **Không đổi** — tool chạy trong main process; UI chat hiển thị qua `ChatEvent` có sẵn (tool-start/tool-result). |

## 3. Kiến trúc / luồng dữ liệu

```
Native Meow agent
  └─ office tool (src/main/agent/tools/office.ts)
       └─ OfficeCliBinary (src/main/officecli/binary-manager.ts)
            ├─ PATH (đã có officecli)
            └─ userData/officecli/officecli(.exe)   ← tự tải nếu thiếu
       spawn [binary, ...args, '--json'] với cwd = ctx.cwd
       → stdout (JSON/text) hoặc error structured
```

### Binary resolution — `OfficeCliBinary.resolveBinaryPath()`

1. Có `officecli` trong PATH → trả `'officecli'`.
2. Có `userData/officecli/officecli(.exe)` → trả path đó.
3. Thiếu → tải về `userData/officecli/`:
   - Resolve version: follow redirect của `https://d.officecli.ai/releases/latest` (fallback
     `https://github.com/iOfficeAI/OfficeCLI/releases/latest`) để lấy tag `vX.Y.Z`.
   - Asset theo platform/arch:

     | Platform | x64 | ARM64 |
     |---|---|---|
     | Windows | `officecli-win-x64.exe` | `officecli-win-arm64.exe` |
     | macOS | `officecli-mac-x64` | `officecli-mac-arm64` |
     | Linux | `officecli-linux-x64` | `officecli-linux-arm64` |

   - Download URL: `https://d.officecli.ai/releases/download/<v>/<asset>` (fallback GitHub
     `https://github.com/iOfficeAI/OfficeCLI/releases/download/<v>/<asset>`).
   - Verify SHA256 từ `SHA256SUMS` cùng base; mismatch → bỏ file, trả lỗi.
   - Quyền execute trên Unix; Windows dùng thẳng `.exe`.

## 4. Thành phần / file

| File | Loại | Nội dung |
|---|---|---|
| `src/main/officecli/binary-manager.ts` | mới | `OfficeCliBinary`: `resolveBinaryPath()`, `platformAsset()`, `downloadIfNeeded()` (fetch Node 20+, không dep mới). |
| `src/main/agent/tools/office.ts` | mới | `officeTool`: `ToolDefinition`, schema zod, spawn + tree-kill timeout. |
| `src/main/agent/tools/registry.ts` | sửa | `createDefaultTools(opts)` thêm `getUserDataDir?`; khởi tạo office tool. |
| `src/main/index.ts` | sửa | Truyền `getUserDataDir: () => app.getPath('userData')`. |
| `src/main/agent/config.ts` | sửa | Thêm `office: 'ask'` vào `DEFAULT_MEOW_CONFIG.permission`. |
| `tests/unit/officecli-binary-manager.test.ts` | mới | Mock fetch; asset selection, fallback, checksum. |
| `tests/unit/office-tool.test.ts` | mới | Mock binary; spawn args, `--json`, timeout, mapping lỗi. |

## 5. Xử lý lỗi

- Binary thiếu + download fail → tool trả `error` kèm URL hướng dẫn cài thủ công.
- officecli exit ≠ 0 → trả `error` chứa stdout/stderr (OfficeCLI trả JSON structured error kèm
  `code`/`suggestion` khi `--json`).
- Timeout → `tree-kill` cả process tree, trả `error` timeout (giống `bash.ts`).
- Cwd không tồn tại → fallback về home + note `[meow]` (giống `bash.ts`).

## 6. Kiểm thử

- Unit `tests/unit/officecli-binary-manager.test.ts`: mock `fetch` — resolution PATH/binary local,
  download về đúng asset theo platform, fallback mirror→GitHub, checksum mismatch bỏ file.
- Unit `tests/unit/office-tool.test.ts`: mock binary manager + spawn — args đúng, tự thêm `--json`,
  exit≠0 → error, timeout → tree-kill.
- Bắt buộc: `npm run typecheck` pass, `npm test` pass.
- Không ảnh hưởng e2e (không đổi IPC/preload/renderer).

## 7. Tiêu chí thành công

- Agent Meow có tool `office`; gọi được `officecli create/set/add/get` tạo & sửa file .docx/.xlsx/.pptx
  trong project.
- Khi máy chưa cài officecli, lần đầu gọi tool tự tải binary về `userData/officecli/` và dùng được.
- Permission `office` mặc định `ask`; có thể đổi trong Settings → Permissions.
- Không phá IPC contract, không phá e2e hiện có.
