# Meow Coding — GitHub Actions CI: build & publish installers : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Thiết lập GitHub Actions tự động build installer cho cả 3 nền tảng **Windows, macOS, Linux** và
xuất bản file cài vào GitHub Release khi push tag. Build chạy trên matrix runner native của từng OS.

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Trigger | `push` trên `master` (build artifacts, không release) + `push` tag `v*` (build → tạo GitHub Release) + `pull_request` (chỉ test). |
| Matrix build | 3 runner native: `windows-latest`, `macos-latest`, `ubuntu-latest` → chạy `electron-builder --win/--mac/--linux`. Tận dụng `build.win/linux/mac` có sẵn trong `package.json`. |
| Publish | Job riêng chạy khi tag: gom artifact của 3 OS → tạo GitHub Release qua `softprops/action-gh-release` (GITHUB_TOKEN, quyền `contents: write`). Không dùng `--publish` của electron-builder. |
| node-pty | Chạy `npx @electron/rebuild -f -w @lydell/node-pty` sau `npm ci` trên mọi runner (bắt buộc, theo AGENTS.md). |
| Signing | **Skip** — build unsigned (không cần secrets). Windows/macOS cảnh báo khi cài; thêm sau qua secrets nếu cần. |
| macOS arch | `macos-latest` build theo `build.mac` (x64 + arm64). **Rủi ro:** native node-pty cross-arch trên arm64→x64 có thể fail; fallback là build arch host. |
| e2e | Không chạy e2e trên CI (Electron headed dễ flaky); test gate = typecheck + unit/integration. |
| Cache | `actions/setup-node` với `cache: npm` để tăng tốc `npm ci`. |

## 3. Kiến trúc / luồng dữ liệu

```
push master / PR                      push tag v1.2.3
   └─ job test (ubuntu)                  └─ job test (ubuntu)
        npm ci → rebuild node-pty              (như master)
        typecheck + npm test
                                          └─ job build (matrix 3 OS)
                                               npm ci → rebuild node-pty
                                               electron-vite build → electron-builder --<os>
                                               upload release/* → artifact
                                          └─ job publish (tag only)
                                               download 3 artifact
                                               softprops/action-gh-release → Release v1.2.3 + file
```

## 4. Thành phần / file

| File | Loại | Nội dung |
|---|---|---|
| `.github/workflows/build.yml` | mới | Workflow: 3 job (test, build matrix, publish). |
| `README.md` | sửa | Ghi chú CI build + liên kết Releases. |
| `docs/superpowers/specs/2026-08-08-github-actions-build-design.md` | mới | Spec này. |
| `docs/superpowers/plans/2026-08-08-github-actions-build.md` | mới | Plan. |

Không đổi `package.json`, code, IPC/preload/renderer.

## 5. Xử lý lỗi

- `npm ci` fail → job fail (báo lỗi, không tạo Release).
- Rebuild node-pty fail trên 1 OS → job build OS đó fail; các OS khác vẫn chạy (`fail-fast: false`).
- macOS cross-arch native fail → fallback: chỉ build arch host (thay `electron-builder --mac` bằng
  `--mac --x64` hoặc `--arm64` theo runner) — cập nhật khi gặp thực tế.
- Tag không đủ artifact (1 OS fail) → publish vẫn tạo Release với file còn lại (`continue-on-error` không
  bật để tránh release thiếu file một cách âm thầm; thay vào đó `publish` `needs: build` với `if: success()`).

## 6. Kiểm thử

- Validate YAML: parse bằng node (thư viện `yaml` có trong node_modules).
- `npm run typecheck` pass, `npm test` pass — không phá gì (không đổi code).
- Chạy thực tế sau khi push lên GitHub (không thể chạy Actions cục bộ).

## 7. Tiêu chí thành công

- Push tag `v0.15.0` → GitHub Actions build 3 OS → Release `v0.15.0` có:
  - Windows: `Meow Coding-0.15.0 Setup.exe` (NSIS) + portable `.exe`
  - macOS: `.dmg` + `.zip` (x64 + arm64)
  - Linux: `.AppImage` + `.deb`
- Push `master`/PR → chạy test + build, không tạo Release.
- Không phá test/typecheck, không phá build config hiện có.
