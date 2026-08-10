# GitHub Actions CI Build & Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo `.github/workflows/build.yml` build installer cho Windows, macOS, Linux trên matrix runner native, và tạo GitHub Release khi push tag `v*`.

**Architecture:** Workflow gồm 3 job: `test` (ubuntu: npm ci → rebuild node-pty → typecheck + npm test), `build` (matrix 3 OS: npm ci → rebuild node-pty → electron-vite build → electron-builder `--<os>` → upload artifact), `publish` (chỉ khi tag: download 3 artifact → `softprops/action-gh-release` tạo Release). Dùng `GITHUB_TOKEN` với quyền `contents: write`. Không đổi package.json/code.

**Tech Stack:** GitHub Actions, electron-builder 26 (đã có), electron-vite 5 (đã có), `@lydell/node-pty` (native — cần rebuild). Không thêm dependency npm.

## Global Constraints

- Tuân theo `AGENTS.md`: không thêm comment thừa.
- Phải chạy `npx @electron/rebuild -f -w @lydell/node-pty` sau `npm ci` trên MỌI runner.
- Build dùng target có sẵn trong `package.json` (`build.win/linux/mac`) — không sửa config đó.
- Runner: `windows-latest`, `macos-latest`, `ubuntu-latest`; `fail-fast: false`.
- Publish qua `softprops/action-gh-release@v2` — KHÔNG dùng `electron-builder --publish`.
- Signing skip (không secrets).
- YAML phải parse được (validate bằng `node` + thư viện `yaml`).
- Bắt buộc `npm run typecheck` pass và `npm test` pass sau khi hoàn thành.

---

### Task 1: Tạo `.github/workflows/build.yml`

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: target `build.win/linux/mac` trong `package.json`; GITHUB_TOKEN (mặc định của Actions).
- Produces: workflow chạy `test` → `build` (3 OS) → `publish` (tag only). Task 2 cập nhật README.

- [ ] **Step 1: Tạo file workflow**

`.github/workflows/build.yml`:

```yaml
name: build

on:
  push:
    branches: [master]
    tags: ['v*']
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx @electron/rebuild -f -w @lydell/node-pty
      - run: npm run typecheck
      - run: npm test

  build:
    needs: test
    if: github.event_name != 'pull_request'
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            target: win
          - os: macos-latest
            target: mac
          - os: ubuntu-latest
            target: linux
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx @electron/rebuild -f -w @lydell/node-pty
      - run: npm run build
      - name: Package
        run: npx electron-builder --${{ matrix.target }} --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: meow-${{ matrix.os }}
          path: release/*
          if-no-files-found: error

  publish:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - name: Publish release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
```

- [ ] **Step 2: Validate YAML**

Run:
```powershell
node -e "const fs=require('fs'); const yaml=require('yaml'); const d=yaml.parse(fs.readFileSync('.github/workflows/build.yml','utf8')); console.log('workflow jobs:', Object.keys(d.jobs).join(', '))"
```
Expected: in ra `workflow jobs: test, build, publish`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: build and publish Windows/macOS/Linux installers on GitHub Actions"
```

---

### Task 2: Cập nhật README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: workflow từ Task 1.
- Produces: ghi chú CI/release trong README.

- [ ] **Step 1: Thêm ghi chú CI vào phần Development (sau block commands)**

Trong `README.md`, sau dòng `npm run dist:mac    # package macOS (dmg + zip; must run on macOS)` thêm:

```markdown

### CI / Releases

GitHub Actions (`.github/workflows/build.yml`) builds Windows, macOS, and Linux installers on each
push to `master` and on every `v*` tag. Tagged releases are published automatically — grab the
latest installers from the [Releases](https://github.com/stardust-bytes/meow-coding/releases) page.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): note CI build and GitHub Releases"
```

---

### Task 3: Full verification

**Files:**
- Không đổi file.

- [ ] **Step 1: Run toàn bộ test suite**

Run: `npm test`
Expected: tất cả pass (452+), không phá test hiện có.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit (nếu còn thay đổi dư)**

```bash
git status --short
# chỉ commit nếu có file thay đổi ngoài ý muốn
```
