# Auto-update từ GitHub Releases — Design Spec

**Ngày:** 2026-08-18
**Trạng thái:** Approved (user duyệt thiết kế)

## 1. Mục tiêu

- App tự kiểm tra phiên bản mới **1 lần lúc khởi động** (sau khi window ready).
- Có bản mới → hiện **dialog trung tâm** kèm **changelog** → user bấm **Update & Restart** (hoặc **Later**).
- Thêm nút **"Check for Updates"** trong Settings (tab **Updates**) để user chủ động kiểm tra.
- Hỗ trợ **Windows + macOS + Linux**.

## 2. Phương pháp

Dùng **`electron-updater`** (thư viện chính thức của electron-builder). Nguồn: **GitHub Releases** của repo `stardust-bytes/meow-coding`.

### Vì sao không tự viết GitHub API
- electron-updater nhận sẵn: so sánh semver, tải **delta** qua `*.blockmap`, verify hash, kiểm tra chữ ký (macOS), tự chọn artifact đúng nền tảng, quản lý cài đặt (NSIS/AppImage/zip).
- CI hiện tại **đã upload sẵn** `latest.yml` / `latest-mac.yml` / `latest-linux.yml` + `*.blockmap` lên GitHub Releases — đúng định dạng electron-updater tiêu thụ. Không phải sửa CI.

## 3. Phía release (electron-builder)

- Thêm vào `electron-builder.ts`:
  ```ts
  publish: {
    provider: 'github',
    owner: 'stardust-bytes',
    repo: 'meow-coding'
  }
  ```
- Khi package, electron-builder sinh `app-update.yml` (chứa URL nguồn update) vào resources của app. `electron-updater` đọc file này lúc runtime.
- **Không sửa** `.github/workflows/build.yml` — đã đủ (upload artifacts + `*.yml` + `*.blockmap` lên release).

## 4. Main process — `src/main/updater.ts` (service mới)

Dependency mới: `electron-updater` (version khớp electron-builder 26).

Cấu hình:
- `autoDownload = false` — không tải khi check, luôn chờ user.
- `autoInstallOnAppQuit = false` — không tự cài khi thoát.

Guard platform (bỏ qua update, chỉ log):
- `!app.isPackaged` → dev mode, bỏ qua.
- Windows portable (`process.env.PORTABLE_EXECUTABLE_FILE`) → bỏ qua.
- Linux không phải AppImage (`!process.env.APPIMAGE`) → bỏ qua.

API:
- `checkNow(manual: boolean)` — check 1 lần:
  - Có bản mới → emit `update-available` (kèm version + releaseNotes + releaseDate).
  - Không có → emit `up-to-date` (chỉ manual check mới cần hiển thị).
  - Lỗi → emit `error` (message thân thiện, không crash).
- `downloadAndInstall()`:
  - `downloadUpdate()` → emit `download-progress` (percent) trong lúc tải.
  - Xong → emit `downloaded` → user bấm restart → `quitAndInstall()`.

Emit qua callback `onStatus(event)` do service giữ; `MainApp` push xuống renderer qua IPC.

## 5. IPC contract

`src/shared/ipc.ts`:
- Channels mới: `UpdaterCheck: 'updater:check'`, `UpdaterInstall: 'updater:install'`, `EventUpdaterStatus: 'updater:status'`.
- API mới trên `AgentApi`:
  - `checkForUpdates(): Promise<void>`
  - `installUpdate(): Promise<void>`
  - `onUpdaterStatus(cb: (e: UpdaterStatusEvent) => void): () => void`

`src/shared/types.ts` — type mới (discriminated union):
```ts
export type UpdaterStatusEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string; releaseNotes?: string; releaseDate?: string; currentVersion: string }
  | { type: 'up-to-date'; currentVersion: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'not-supported'; message: string }
```

`src/preload/index.ts`: expose 3 API trên.

## 6. Renderer

### 6.1 `UpdateDialog.tsx` (dialog trung tâm mới)
- Tự mở khi nhận `update-available` từ auto-check lúc khởi động.
- Nội dung:
  - Tiêu đề "Update available".
  - `currentVersion` → `newVersion`.
  - **Changelog**: render `releaseNotes` (markdown — dùng `MarkdownText.tsx` có sẵn).
  - Nút **Update & Restart** (chính) / **Later**.
  - Trạng thái tải: progress bar + `percent%`, nút disabled.
  - Sau khi tải xong: nút **Restart now**.
  - Lỗi: message + nút **Close**.
- Nếu dialog đang mở mà nhận event mới → cập nhật content tại chỗ (không mở dialog thứ 2).

### 6.2 `settings/UpdatesTab.tsx` (tab mới)
- Nút **"Check for Updates"** → gọi `window.api.checkForUpdates()`.
- Dòng trạng thái:
  - `checking` → "Checking for updates…"
  - `up-to-date` → "You're on the latest version (vX.Y.Z)."
  - `update-available` → "vX.Y.Z available" + nút **Update & Restart**.
  - `error` → message đỏ.
  - `not-supported` → message giải thích (portable/linux non-AppImage).
- SettingsDialog: thêm tab id `updates`, label **Updates** (sau tab Templates).

### 6.3 `App.tsx`
- Subscribe `onUpdaterStatus`:
  - `checking` → nếu đang mở dialog do manual → hiện "checking".
  - `update-available` → mở/update `UpdateDialog`.
  - `up-to-date` / `error` / `not-supported` → chỉ cập nhật trạng thái (Settings tab đọc lại qua event? Không — Settings tab tự quản lý state local; App chỉ xử lý dialog auto).
- Đơn giản hóa: **App chỉ mở UpdateDialog khi nhận `update-available`**. Settings tab tự lắng nghe `onUpdaterStatus` riêng để hiển thị trạng thái manual.

## 7. Edge cases

| Tình huống | Xử lý |
|---|---|
| Mất mạng / GitHub lỗi | `error` event, không crash, dialog/tab hiển thị message |
| Đang `checking` bấm lại | Ignore (guard trong updater service) |
| Dialog mở sẵn + event mới | Cập nhật content tại chỗ |
| Portable Windows | `not-supported`, ẩn auto-check |
| Linux không AppImage | `not-supported`, ẩn auto-check |
| macOS | electron-updater yêu cầu code signing — CI mac chưa có signing secrets; note: update chỉ hoạt động trên build có sign. Auto-check vẫn chạy, lỗi sẽ hiển thị |
| Dev mode (`!isPackaged`) | Bỏ qua hoàn toàn, không hiện UI |

## 8. Testing

- **Unit (vitest):** 
  - `updater.test.ts`: guard platform (dev/portable/linux non-AppImage); mock electron-updater: `checkForUpdates` → có bản mới / up-to-date / error; event mapping đúng sang `UpdaterStatusEvent`.
  - IPC contract test: thêm 3 API mới.
- **E2E:** không bắt buộc (update không chạy trong dev). Smoke test giữ nguyên.
- **Manual:** build `--dir` Windows, chạy thử với GitHub release giả? (electron-updater check cần mạng thật; test thủ công khi có tag mới).

## 9. Scope / non-goals

- Không tự cài silent (luôn hỏi).
- Không check định kỳ (chỉ lúc khởi động + manual).
- Không sửa CI workflow.
- Không thêm changelog offline — lấy từ release notes GitHub.
