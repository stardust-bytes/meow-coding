# Meow Coding — macOS build support : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Thêm khả năng đóng gói macOS cho Meow Coding: `npm run dist:mac` tạo `.dmg` + `.zip` cho cả
Apple Silicon (`arm64`) và Intel (`x64`). Chạy trên máy macOS.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Cấu hình | Thêm section `mac` trong `build` của `package.json`: target `dmg` + `zip`, arch `x64` + `arm64`, category `public.app-category.developer-tools`, icon `moew-coding-logo.png` (1254×1254 — đủ để electron-builder auto-gen `.icns`). |
| Scripts | `dist:mac` (electron-vite build + `--mac`) và `dist:mac:dir` (`--mac dir`). |
| Nền tảng build | **Phải chạy trên macOS** — electron-builder không cross-build `.dmg` từ Windows (cần `hdiutil`). Cấu hình chỉ làm app build được khi chạy `npm run dist:mac` trên máy Mac. |
| Code | **Không đổi** — code đã darwin-ready: `window-chrome.ts` (`hiddenInset` traffic lights), `pty-manager.ts` (non-win32 pass-through), `officecli` có asset mac, native agent platform-agnostic. |
| Giữ nguyên | Không đụng `win`/`linux` config, IPC, preload, renderer. |
| Icon | Dùng `moew-coding-logo.png` (có sẵn) — không thêm file `.icns` mới. |

## 3. Kiến trúc / luồng dữ liệu

Không có thay đổi kiến trúc. electron-builder đọc `build.mac`:

```
npm run dist:mac
  └─ electron-vite build → out/
  └─ electron-builder --mac
       ├─ reads build.mac: target dmg/zip, arch x64/arm64
       ├─ icon: moew-coding-logo.png → auto-gen .icns
       ├─ extraResources: resources/skills → skills (kế thừa config chung)
       └─ release/Meow Coding-<version>-{arm64,x64}.{dmg,zip}
```

## 4. Thành phần / file

| File | Loại | Nội dung |
|---|---|---|
| `package.json` | sửa | Thêm section `build.mac` + scripts `dist:mac`, `dist:mac:dir`. |
| `README.md` | sửa | Thêm dòng `npm run dist:mac` trong phần Development. |
| `docs/superpowers/specs/2026-08-08-macos-build-design.md` | mới | Spec này. |
| `docs/superpowers/plans/2026-08-08-macos-build.md` | mới | Plan. |

## 5. Xử lý lỗi

- Không có logic runtime mới — không có lỗi runtime cần xử lý.
- Nếu chạy `dist:mac` trên Windows/Linux → electron-builder báo lỗi "Cannot build for macOS on ..." —
  hướng dẫn rõ trong README rằng phải build trên macOS.
- Icon 1254×1254 đủ kích thước tối thiểu (512×512) để auto-generate `.icns`.

## 6. Kiểm thử

- Không có test logic mới (chỉ cấu hình + script).
- Bắt buộc: `npm run typecheck` pass, `npm test` pass (không phá gì).
- Xác nhận thủ công trên macOS: `npm install && npx @electron/rebuild -f -w @lydell/node-pty && npm run dist:mac`.

## 7. Tiêu chí thành công

- `package.json` có `build.mac` đúng schema electron-builder (dmg + zip, x64 + arm64).
- `npm run dist:mac` chạy được trên macOS, tạo `release/Meow Coding-<ver>-arm64.dmg` + `-x64.dmg` (+ `.zip`).
- Không phá build `win`/`linux` hiện có, không phá test/typecheck.
