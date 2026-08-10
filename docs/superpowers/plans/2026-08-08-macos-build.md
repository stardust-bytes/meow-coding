# macOS Build Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm cấu hình `build.mac` + scripts `dist:mac`/`dist:mac:dir` vào `package.json` để build được `.dmg`/`.zip` cho macOS (x64 + arm64) trên máy macOS.

**Architecture:** Chỉ sửa cấu hình electron-builder trong `package.json` và ghi chú README. Không đổi code, không đổi IPC/preload/renderer. electron-builder tự auto-generate `.icns` từ `moew-coding-logo.png` (1254×1254 ≥ 512).

**Tech Stack:** electron-builder 26 (đã có), electron-vite 5 (đã có). Không thêm dependency.

## Global Constraints

- Tuân theo `AGENTS.md`: không thêm comment thừa.
- Không sửa `build.win` / `build.linux` hiện có.
- `mac.icon` = `moew-coding-logo.png` (file có sẵn ở repo root).
- `mac.target` = `dmg` + `zip`, arch `x64` + `arm64`, category `public.app-category.developer-tools`.
- Scripts mới: `dist:mac`, `dist:mac:dir` — giữ nguyên format các script hiện có (`electron-vite build && electron-builder --mac`).
- Build thật chỉ chạy được trên macOS — phần này là manual step, không verify trên Windows.
- Bắt buộc `npm run typecheck` pass và `npm test` pass sau khi hoàn thành.

---

### Task 1: Thêm `build.mac` config + scripts vào package.json

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `moew-coding-logo.png` (repo root), electron-builder 26.
- Produces: config `build.mac` hợp lệ + scripts `dist:mac`/`dist:mac:dir` — Task 2 đọc README để cập nhật.

- [ ] **Step 1: Thêm 2 scripts vào block `scripts`**

Trong `package.json`, block `scripts` (sau dòng `"dist:linux:dir"`), thêm:

```json
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:mac:dir": "electron-vite build && electron-builder --mac dir"
```

- [ ] **Step 2: Thêm section `mac` vào block `build`**

Trong `package.json`, sau section `linux` (trước `"nsis"`), thêm:

```json
    "mac": {
      "target": [
        {
          "target": "dmg",
          "arch": [
            "x64",
            "arm64"
          ]
        },
        {
          "target": "zip",
          "arch": [
            "x64",
            "arm64"
          ]
        }
      ],
      "category": "public.app-category.developer-tools",
      "icon": "moew-coding-logo.png"
    },
```

- [ ] **Step 3: Validate JSON + cấu hình electron-builder**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json valid')"`
Expected: in ra `package.json valid`.

Run: `npx electron-builder --help | Out-String` (hoặc chỉ cần confirm JSON valid — không chạy `--mac` trên Windows vì sẽ lỗi nền tảng).
Expected: command tồn tại; không cần build thật.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(build): add macOS build config (dmg+zip, x64+arm64) and dist:mac scripts"
```

---

### Task 2: Cập nhật README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: scripts `dist:mac` từ Task 1.
- Produces: ghi chú build macOS trong README.

- [ ] **Step 1: Sửa block Development**

Trong `README.md`, block `Other commands:` (dòng có `npm run dist` / `npm run dist:linux`), thêm:

```markdown
npm run dist:mac    # package macOS (dmg + zip; must run on macOS)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): note macOS packaging command"
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
