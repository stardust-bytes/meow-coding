# Meow Coding — Custom Title Bar (gộp logo + toolbar + nút cửa sổ) : Design Spec

Ngày: 2026-08-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Hiện tại app dùng title bar mặc định của OS (không có `frame: false`, không `titleBarStyle`), tách biệt
hoàn toàn khỏi UI của app (Sidebar/PaneGrid/StatusBar) — không có menu File/Edit nào được khai báo.

Mục tiêu: gộp **logo + tên app** và **3 nút điều khiển cửa sổ** (minimize/maximize/close) vào **chung
một dòng**, màu nền đồng bộ với theme tối hiện tại của app — giống cách VS Code làm trên Windows.

Ngoài phạm vi (v0.1): menu File/Edit/View thật có chức năng — app hiện chưa có nội dung menu nào để
gộp vào; sẽ làm ở dự án riêng sau nếu cần.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Chỉ gộp logo/tên app + 3 nút cửa sổ vào 1 dòng; chưa làm menu File/Edit thật |
| Nền tảng | Windows, macOS, Linux đều cần hoạt động đúng — nhưng **không đồng nhất tuyệt đối**: macOS không cho đổi màu traffic-light (giới hạn cứng của OS) |
| Cách tiếp cận | Thích ứng theo `process.platform`: dùng cơ chế native của OS khi có thể (Windows `titleBarOverlay`, macOS `trafficLightPosition`), chỉ tự vẽ nút khi bắt buộc (Linux) |
| Windows | `titleBarStyle: 'hidden'` + `titleBarOverlay: { color: '#252526', symbolColor: '#cccccc', height: 32 }` — nút do Windows vẽ, giữ nguyên Snap Layout (Windows 11), đổi được màu nền + màu icon |
| macOS | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 12, y: 10 }` — dịch vị trí traffic-light, **không đổi màu được** (giới hạn Apple, không phải hạn chế cách làm) |
| Linux | `frame: false` — không có cơ chế overlay đáng tin cậy xuyên desktop environment → tự vẽ 3 nút SVG + tự xử lý drag/double-click-maximize qua IPC |
| Nền tảng lạ | Không nhận diện được `process.platform` → fallback `frame: true` mặc định, an toàn |
| Chiều cao thanh | 32px, dùng chung cho `titleBarOverlay.height` (Windows) và CSS `.title-bar` (mọi OS) để đồng nhất thị giác |
| Màu nền | `--bg-panel` (#252526) — trùng màu sidebar hiện tại; cũng là giá trị `titleBarOverlay.color` trên Windows để vùng native overlay và nội dung web liền màu |
| Logo | File gốc `moew-coding-logo.png` (icon vuông đầy đủ, có chữ nhúng sẵn) dùng làm **app icon** (exe/taskbar/dock) qua electron-builder; cắt riêng phần hình mèo (bỏ chữ + padding) thành asset nhỏ riêng cho title bar (~18px) |

## 3. Kiến trúc / luồng dữ liệu

```
src/main/index.ts (createWindow)
  └─ chọn theo process.platform:
       win32  → titleBarStyle:'hidden' + titleBarOverlay{color:'#252526', symbolColor:'#cccccc', height:32}
       darwin → titleBarStyle:'hiddenInset' + trafficLightPosition{x:12,y:10}
       linux  → frame:false
       khác   → frame:true (fallback)

IPC mới (Channels + preload, đồng nhất cho cả 3 OS dù chỉ Linux thật sự vẽ nút):
  windowMinimize()
  windowToggleMaximize()   → main kiểm tra win.isMaximized() trước khi gọi maximize()/unmaximize()
  windowClose()            → đi qua flow đóng app hiện có (cleanup PTY, tree-kill), không bypass
  isWindowMaximized(): Promise<boolean>
  onWindowMaximizedChange(cb)  → lắng nghe event 'maximize'/'unmaximize' của BrowserWindow

renderer: <TitleBar> (mới, đầu App.tsx, trên .app-body hiện có)
  ├─ trái: icon mèo nhỏ (resources/logo-mark.png, cắt riêng) + text "Meow Coding"
  ├─ giữa: vùng trống, -webkit-app-region: drag, double-click → toggle maximize
  └─ phải:
       Linux           → 3 nút SVG tự vẽ (no-drag), icon maximize/restore đổi theo isWindowMaximized()
       Windows/macOS   → để trống (Windows: native overlay vẽ đè lên; macOS: traffic-light đã dịch trái)
```

Thay đổi file:

- `src/shared/ipc.ts` — thêm channel: `WindowMinimize`, `WindowToggleMaximize`, `WindowClose`,
  `WindowIsMaximized`, `EventWindowMaximizedChange`.
- `src/shared/types.ts` / `AgentApi` — thêm method tương ứng.
- `src/main/index.ts` — logic chọn cấu hình theo platform trong `createWindow`; đăng ký IPC handler;
  forward event `maximize`/`unmaximize` của `BrowserWindow` sang renderer.
- `src/preload/index.ts` — expose các method/event trên qua `contextBridge`.
- `src/renderer/src/components/TitleBar.tsx` — component mới.
- `src/renderer/src/App.tsx` — render `<TitleBar>` trên `.app-body`.
- `src/renderer/src/styles.css` — `.title-bar`, `.title-bar-drag`, `.title-bar-btn` (+ `no-drag`).
- `resources/logo-mark.png` (mới) — cắt từ `moew-coding-logo.png`, chỉ phần hình mèo.
- `package.json` (`build` field) — khai báo `win.icon`/`mac.icon`/`linux.icon` trỏ tới
  `moew-coding-logo.png` (electron-builder tự convert sang `.ico`/`.icns` lúc build).

## 4. Xử lý lỗi

- `titleBarOverlay` không được hỗ trợ (phiên bản Electron/OS không tương thích) → fallback `frame:
  false` tự vẽ đầy đủ 3 nút (giống nhánh Linux) thay vì mất nút hoặc crash.
- `windowToggleMaximize` luôn kiểm tra `win.isMaximized()` hiện tại trước khi gọi `maximize()` hay
  `unmaximize()` — tránh lệch trạng thái giữa renderer và main.
- `windowClose` gọi đúng `win.close()`, đi qua toàn bộ flow dọn dẹp hiện có (kill PTY tree, lưu state),
  không thêm đường tắt riêng.
- Nền tảng không nhận diện (`process.platform` lạ) → `frame: true` mặc định, không áp dụng logic mới.

## 5. Kiểm thử

- `npm run typecheck` pass.
- Unit test mới (`tests/unit/`): 3 IPC handler (minimize/toggleMaximize/close) gọi đúng method của
  `BrowserWindow`; `isWindowMaximized` trả đúng giá trị theo state giả lập.
- Test trực quan (Windows, môi trường hiện tại): build (`npm run build`), dùng driver Playwright/CDP —
  mở app, screenshot title bar, xác nhận icon/text/nút native nằm cùng 1 dòng, màu khớp `--bg-panel`.
- macOS/Linux: không test tự động được trong môi trường Windows hiện tại — cần kiểm tra thủ công trên
  máy thật hoặc CI riêng trước khi coi là hoàn tất trên các nền tảng đó.
- `npm run e2e` (smoke) không được vỡ sau khi đổi cấu trúc `App.tsx`.

## 6. Tiêu chí thành công

- Trên Windows: logo + "Meow Coding" + 3 nút cửa sổ nằm cùng 1 dòng, màu nền đồng bộ `--bg-panel`,
  Snap Layout (Windows 11) vẫn hoạt động khi hover nút maximize.
- Trên macOS: logo + "Meow Coding" cùng dòng với traffic-light đã dịch vị trí (màu traffic-light vẫn
  là màu gốc macOS — đã thống nhất là giới hạn chấp nhận được).
- Trên Linux: 3 nút tự vẽ hoạt động đúng (minimize/maximize-restore/close), kéo thả cửa sổ bằng vùng
  trống hoạt động, double-click toggle maximize.
- `npm run typecheck`, `npm test` pass; `npm run e2e` không vỡ.
