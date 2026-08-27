# System Logger Theo Ngày — Design Spec

Ngày: 2026-08-27 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Ghi toàn bộ log (mọi mức INFO/WARN/ERROR) phát sinh trên hệ thống vào file theo ngày
`<YYYY-MM-DD>-log.txt` trong `userData/logs/`, giúp dễ dàng tra cứu lỗi khi debug.

Hiện tại hệ thống chỉ có `LogManager` ghi **output thô của từng agent** vào
`userData/logs/<agentId>.log` — không có cơ chế ghi lỗi hệ thống; các lỗi chỉ `console.error`
ra stdout, không có handler cho `uncaughtException`/`unhandledRejection`.

Ngoài phạm vi: ghi toàn bộ output của agent vào file hệ thống (tránh phình file), log rotation
phức tạp, UI xem log.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Tất cả log mọi mức (INFO/WARN/ERROR) |
| Nguồn | Main process + renderer + sự kiện lỗi agent |
| File | `userData/logs/YYYY-MM-DD-log.txt` (tên theo ngày hiện tại) |
| Định dạng dòng | `[YYYY-MM-DD HH:mm:ss] [LEVEL] [source] message` |
| Nguồn (source) | `main` \| `render` \| `agent` |
| Giữ log | 7 ngày, dọn tự động khi app khởi động |
| Cơ chế ghi | Class `SystemLogger` mới, append-only, fallback `console.error` khi ghi lỗi |
| Lỗi fatal | `uncaughtException`: ghi xong rồi thoát app (giữ hành vi cũ nhưng có trace) |
| Output agent | Không ghi vào file hệ thống — vẫn nằm ở `<agentId>.log` như cũ |

## 3. Kiến trúc

```
renderer (console.* patched)                main process
        │ writeSystemLog(level, msg)        │ console.* patched → SystemLogger
        ▼ via IPC Channels.SystemLog        ▼
┌─────────────────────────────────────────────────────────┐
│ SystemLogger (src/main/system-logger.ts)                 │
│   log(level, source, message) → append userData/logs/    │
│                                <YYYY-MM-DD>-log.txt       │
│   prune(maxDays=7) → xóa file log cũ                      │
└─────────────────────────────────────────────────────────┘
        ▲
        │ log(ERROR, 'agent', ...) tại các điểm lỗi agent
        └── pty-manager (exit≠0) / meow-agent-manager (spawn/chat fail)
```

### 3.1 SystemLogger

```ts
// src/main/system-logger.ts
export type LogLevel = 'INFO' | 'WARN' | 'ERROR'
export type LogSource = 'main' | 'render' | 'agent'

export class SystemLogger {
  constructor(private logDir: string) // mkdir recursive

  log(level: LogLevel, source: LogSource, message: string): void
  // append `[ts] [LEVEL] [source] message\n` vào <YYYY-MM-DD>-log.txt
  // lỗi ghi (đĩa đầy…) → console.error, không throw

  prune(maxDays = 7): void
  // xóa các file <date>-log.txt cũ hơn maxDays
}
```

- Tên file tính theo ngày hiện tại → hết ngày tự chuyển sang file mới.
- Mỗi dòng thời gian dạng `YYYY-MM-DD HH:mm:ss` local.

### 3.2 Main process (`src/main/index.ts`)

- Khởi tạo `systemLogger = new SystemLogger(path.join(app.getPath('userData'), 'logs'))`.
- Patch `console.log/info/warn/error` → gọi `systemLogger.log(..., 'main', ...)` rồi vẫn in ra stdout.
- `process.on('uncaughtException')` → ghi `[ERROR] [main]` kèm stack, rồi `app.quit()`.
- `process.on('unhandledRejection')` → ghi `[ERROR] [main]` kèm lý do + stack.
- Khi khởi động: `systemLogger.prune(7)`.

### 3.3 IPC + preload + renderer

- `src/shared/ipc.ts`:
  - `Channels.SystemLog = 'system-log:write'`.
  - `AgentApi.writeSystemLog(level: LogLevel, message: string): Promise<void>`.
  - Type `LogLevel`/`LogSource` để ở `src/shared` (render dùng được).
- `src/preload/index.ts`: `writeSystemLog: (level, message) => ipcRenderer.invoke(Channels.SystemLog, level, message)`.
- Main handler: `ipcMain.handle(Channels.SystemLog, (_e, level, message) => systemLogger.log(level, 'render', message))`.
- Renderer (`src/renderer/src/main.tsx` hoặc nơi bootstrap): patch `console.log/warn/error`
  → fire-and-forget `window.api.writeSystemLog(...)` (không chặn luồng UI, thất bại âm thầm).

### 3.4 Agent errors

- `pty-manager.ts` (exit handler): `exitCode !== 0` → `systemLogger.log('ERROR', 'agent', 'agent X exited with code N')`.
- `meow-agent-manager.ts`: các điểm spawn fail / lỗi chat → `systemLogger.log('ERROR', 'agent', ...)`.
- **Không** ghi output agent vào file hệ thống.

## 4. Xử lý lỗi

- Ghi file thất bại (quyền, đĩa đầy): fallback `console.error`, app không crash.
- Renderer gửi log khi main chưa sẵn sàng: invoke thất bại → bỏ qua âm thầm.
- `uncaughtException` vẫn giữ hành vi thoát app hiện tại — chỉ thêm trace vào file.

## 5. Đồng bộ tài liệu (bắt buộc)

- `src/main/AGENTS.md` — thêm `system-logger.ts` vào key files.
- `src/preload/AGENTS.md` — thêm method mới vào quy ước.
- `src/shared/AGENTS.md` — thêm channel mới (nếu có bảng liệt kê).
- `docs/reference/05-ipc-contract.md` — thêm channel `SystemLog`.
- `docs/reference/06-data-and-storage.md` — thêm dòng file `logs/YYYY-MM-DD-log.txt`.

## 6. Test

`tests/unit/system-logger.test.ts` (nối tiếp chuẩn `log-manager.test.ts`):

- `log()` tạo file `<YYYY-MM-DD>-log.txt` đúng format `[ts] [LEVEL] [source] msg`.
- Nhiều lần `log()` trong ngày → append cùng file.
- Mô phỏng ngày khác → ghi vào file khác (kiểm tra qua giả lập tên file).
- `prune(7)` xóa file cũ hơn 7 ngày, giữ file mới; chịu được thư mục trống / chỉ có file lạ.
- Ghi lỗi (đường dẫn không hợp lệ) không throw.

## 7. Tiêu chí thành công

- Mọi `console.*` ở main + render đều có trace trong file log ngày.
- Mọi lỗi fatal (`uncaughtException`/`unhandledRejection`) có trace.
- Agent thoát với exit ≠ 0 / spawn fail có trace `[agent]`.
- File log theo ngày, tự dọn cũ hơn 7 ngày.
- `npm run typecheck` và `npm test` pass.
