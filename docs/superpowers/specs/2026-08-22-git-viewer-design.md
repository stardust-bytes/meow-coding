# Git Viewer & Branch Switching — Design

Date: 2026-08-22
Status: Approved (approach A — single tabbed popup)

## Tóm tắt

Thêm một cửa sổ popup riêng (giống FileViewer) để xem trạng thái git của một project —
lịch sử commit, blame từng dòng kiểu GitLens, diff working tree, diff giữa 2 commit bất kỳ —
và switch nhánh (local + remote + tạo mới) với xử lý working tree dirty giống GitHub Desktop.

## Entry points

1. **Sidebar project context menu** — thêm mục "Git" (cạnh Open in VS Code / Open Folder) → mở
   popup cho project đó.
2. **StatusBar** — chữ branch/dirty hiện tại thành button `Git: main ● 3` → click mở popup cho
   project đang active.

Không đổi logic poll `GitStatusService` 5s hiện có — popup tự fetch khi mở.

## Cửa sổ popup

- Main: `openGitViewer(projectPath, getMainWindow)` — file mới `src/main/git-viewer.ts`, bắt chước
  `file-viewer.ts` (BrowserWindow parent, `contextIsolation: true`, preload dùng chung → `window.api`
  có sẵn). Kích thước ~940×700.
- Render routing trong `main.tsx`: đọc param `?git=<encoded projectPath>` → render `GitViewer`
  thay vì `App`/`FileViewer`.
- Escape đóng cửa sổ (giống FileViewer).

## Main-process git service & IPC

File mới `src/main/git-service.ts` — wrapper `execFile('git', ...)` an toàn (timeout 15s,
cwd = projectPath, không shell).

| Hàm | Lệnh git | Trả về |
|---|---|---|
| `getBranches` | `git branch -a --format=%(refname:short) %(HEAD)` | local + remote, đánh dấu HEAD |
| `createBranch(name, base)` | `git branch <name> <base>` | lỗi git thô nếu có |
| `checkout(name)` | `git checkout <name>` | lỗi git thô nếu có (kèm conflict) |
| `stash()` / `stashPop()` | `git stash push -u -m meow-switch` / `git stash pop` | kết quả / lỗi |
| `getStatus` | `git status --porcelain=v2` | staged/unstaged/untracked từng file |
| `getDiff(file?, staged?)` | `git diff` / `--cached` / `-- <file>` | `{ old, new }` raw unified diff |
| `getCommits(path?, range?)` | `git log --format=... -n 200` | hash, author, date, message |
| `getCommitDiff(sha)` | `git show --format=... <sha>` | files + raw diff |
| `compareCommits(a, b)` | `git diff a b` | files + raw diff |
| `getBlame(file)` | `git blame --line-porcelain <file>` | per-line: hash, author, date |
| `getFileHistory(file)` | `git log --follow -- <file>` | commit list riêng file |
| `getTree(root)` | dùng `dir-lister.ts` hiện có | cây thư mục cho tab Blame |

IPC mới khai báo trong `src/shared/ipc.ts` (Channels + AgentApi) + `src/shared/types.ts`:

```
git:get-status, git:get-branches, git:create-branch, git:checkout,
git:stash, git:stash-pop, git:get-diff, git:get-commits,
git:get-commit-diff, git:compare-commits, git:get-blame, git:get-file-history
```

Tuân thủ AGENTS.md: không hardcode channel, render chỉ gọi qua `window.api`, mọi exec ở main,
kết quả JSON thuần.

## UI popup GitViewer

Component mới `src/renderer/src/components/git/GitViewer.tsx`:

```
┌────────────────┐
│ Header: [project name] [▼ main] [⟳] [✕]   │
│ ┌────────┬────────┬────────┐             │
│ │ Changes │ History │ Blame │ ← tabs      │
├─┴────────┴────────┴────────┴────────────┤
│ Content (theo tab)                            │
└────────────────┘
```

### Branch switcher (header, dùng chung mọi tab)
- Dropdown: **Local** (✓ nhánh hiện tại), **Remote** (origin/...), divider, **"Create new branch from ..."**
- Nhánh remote khi checkout → tự tạo local tracking (`git checkout -b <short> --track origin/<short>`)
- Lỗi → `GitErrorBanner` (nội dung thô từ git, kiểu GitHub Desktop)

### Tab 1 — Changes
- Danh sách file dirty (status icon M/A/D/R/U × staged/unstaged/untracked), 2 nhóm *Staged* /
  *Changes not staged*
- Click file → diff panel: toggle **Staged/Unstaged**, render unified diff đẹp (component mới
  `GitDiffView` — parse hunk `@@`, tô xanh/đỏ, line number, **không** dùng `DiffView.tsx` hiện tại)
- Chỉ xem, không commit (ngoài scope)

### Tab 2 — History
- Commit list (hash 7 ký tự, author, date, message) — 200 commit gần nhất, lazy-load thêm
- Click 1 commit → diff commit đó
- **So sánh 2 commit**: checkbox chọn 2 dòng → header `A...B` → diff giữa chúng
- Click file trong diff → lịch sử riêng file (`git log --follow -- <file>`) + nút "← Back"

### Tab 3 — Blame
- Trái: cây thư mục repo (tái sử dụng `RightPanelTree`/`dir-lister`), click file text → blame
- Phải: code viewer (tái sử dụng highlight từ `FileViewer`) + **cột annotation mỗi dòng**:
  hash ngắn + tác giả + ngày (inline GitLens style); hover cột → tooltip commit message

### Trạng thái chung
Spinner khi load, banner lỗi đỏ, Escape đóng.

## Flow switch branch khi dirty

Khi switch tới nhánh có thể checkout nhưng tree dirty → dialog:

```
Switch to "feature/x"?
Working tree có 3 file thay đổi chưa commit.

[ Stash & switch ] [ Bring changes ] [ Discard changes ] [ Cancel ]
```

1. **Stash & switch** — `git stash push -u -m "meow-switch <nhánh>"` → checkout → ngay sau đó
   `git stash pop` áp lại lên nhánh mới. Nếu pop conflict → hiện lỗi git thô, stash được giữ
   nguyên vẹn, báo rõ stash name.
2. **Bring changes** — thử `git checkout` trực tiếp; git tự mang file theo nếu không conflict;
   nếu git chặn → lỗi thô + gợi ý Stash.
3. **Discard changes** — xác nhận lần nữa ("mất vĩnh viễn"), `git checkout -- .` + `git clean -fd`
   rồi switch.
4. **Cancel** — đóng dialog, không đổi gì.

**Báo mọi lỗi**: stderr thô + dòng lệnh đã chạy + nút Copy. Phân loại nhẹ (branch/checkout/stash)
có icon + title riêng. Thành công → refresh toàn bộ + StatusBar ngoài app tự cập nhật qua poll 5s.
Trạng thái tạm khi switch: disable dropdown + tabs, spinner, không đóng cửa sổ giữa chừng.

## Ngoài scope
- Commit / stage / push / pull (chỉ xem + switch nhánh)
- Remote management (add/remove remote)
- Merge / rebase
