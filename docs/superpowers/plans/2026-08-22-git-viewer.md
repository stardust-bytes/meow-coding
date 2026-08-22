# Git Viewer & Branch Switching — Implementation Plan

Date: 2026-08-22
Spec: `docs/superpowers/specs/2026-08-22-git-viewer-design.md`

TDD. Mỗi task commit riêng. Chạy `npm run typecheck` + `npm test` sau mỗi task.

## File structure

### Mới
| File | Trách nhiệm |
|---|---|
| `src/main/git-service.ts` | Wrapper `execFile('git', ...)`: branches, checkout, stash, status detail, diff, log, blame, file-history, commit/compare diff. Class `GitService`. |
| `src/main/git-viewer.ts` | `openGitViewer(projectPath, getMainWindow)` — BrowserWindow popup ~940×700, map `Map<projectPath, BrowserWindow>` (một popup / project). |
| `src/renderer/src/components/git/GitViewer.tsx` | Root component cho `?git=` window: header + branch switcher + tabs + error banner + dirty-switch dialog. |
| `src/renderer/src/components/git/GitBranchSwitcher.tsx` | Dropdown branch (local/remote/create-new). |
| `src/renderer/src/components/git/GitChangesTab.tsx` | Danh sách file dirty (staged/unstaged/untracked) + diff panel. |
| `src/renderer/src/components/git/GitHistoryTab.tsx` | Commit list + diff commit + so sánh 2 commit + file history. |
| `src/renderer/src/components/git/GitBlameTab.tsx` | Cây file + code viewer với cột blame inline. |
| `src/renderer/src/components/git/GitDiffView.tsx` | Render unified diff (parse `@@` hunks, line numbers, màu add/del). KHÔNG dùng `DiffView.tsx` (chỉ nối 2 chuỗi). |
| `src/renderer/src/components/git/GitFileTree.tsx` | Cây thư mục đơn giản dùng `window.api.listDir` (không context menu như RightPanelTree). |
| `tests/unit/git-service.test.ts` | Test `GitService` trên repo git thật (tạo tạm như `git-status-service.test.ts`). |
| `docs/superpowers/plans/2026-08-22-git-viewer.md` | File này. |

### Sửa
| File | Thay đổi |
|---|---|
| `src/shared/types.ts` | Thêm `GitBranch`, `GitStatusDetail`, `GitFileChange`, `GitCommit`, `GitDiffFile`, `GitDiffResult`, `GitBlameLine`, `GitActionResult`. |
| `src/shared/ipc.ts` | Thêm 13 channel + 13 method `AgentApi`. |
| `src/preload/index.ts` | Implement 13 method qua `ipcRenderer.invoke`. |
| `src/main/index.ts` | Import `GitService` + `openGitViewer`; đăng ký 13 handler. |
| `src/renderer/src/main.tsx` | Thêm nhánh `?git=` → render `GitViewer`. |
| `src/renderer/src/components/Sidebar.tsx` | Prop `onOpenGit`; thêm mục "Git" trong project context menu. |
| `src/renderer/src/components/StatusBar.tsx` | Chữ branch → button `Git: main ● 3`, prop `onGitClick`. |
| `src/renderer/src/App.tsx` | Truyền `onOpenGit` cho Sidebar + StatusBar. |
| `src/renderer/src/styles.css` | CSS cho git viewer (tabs, diff, blame, dialog, dropdown). |
| `tests/unit/ipc-contract.test.ts` | Thêm method mới vào danh sách `required` + handler stub. |

## Task 1 — Shared types + IPC contract (TDD)

1. `src/shared/types.ts`: thêm các interface ở bảng trên.
2. `src/shared/ipc.ts`:
   - `Channels`: `GitOpenViewer: 'git:open-viewer'`, `GitGetBranches: 'git:get-branches'`, `GitCreateBranch: 'git:create-branch'`, `GitCheckout: 'git:checkout'`, `GitStash: 'git:stash'`, `GitStashPop: 'git:stash-pop'`, `GitStatusDetail: 'git:status-detail'`, `GitGetDiff: 'git:get-diff'`, `GitGetCommits: 'git:get-commits'`, `GitGetCommitDiff: 'git:get-commit-diff'`, `GitCompareCommits: 'git:compare-commits'`, `GitGetBlame: 'git:get-blame'`, `GitGetFileHistory: 'git:get-file-history'`.
   - `AgentApi`: thêm 13 method (chữ ký như bảng file structure).
3. `tests/unit/ipc-contract.test.ts`: thêm 13 tên vào `required`, thêm stub `async () => ...` cho từng method, thêm `expect(Channels.GitOpenViewer).toBe('git:open-viewer')` v.v.
4. Chạy `npx vitest run tests/unit/ipc-contract.test.ts` → pass. `npm run typecheck` → pass.

Commit: `feat(git): add shared git types and IPC contract`

## Task 2 — GitService (TDD)

`src/main/git-service.ts`:

```ts
import { execFile } from 'node:child_process'

export class GitCommandError extends Error {
  readonly command: string
  readonly stderr: string
  constructor(command: string, stderr: string) {
    super(stderr.trim() || `git ${command} failed`)
    this.command = command
    this.stderr = stderr
  }
}

export class GitService {
  private run(projectPath: string, args: string[]): Promise<{ stdout: string; stderr: string }>
  // execFile('git', args, { cwd, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 64MB })
  // lỗi → throw GitCommandError(args.join(' '), stderr || message)
}
```

Các method (mỗi method gọi `run` rồi parse; parse thuần tách ra để test được):

- `parseBranches(stdout)` — `git branch -a --format=%(refname:short)%09%(HEAD)` → `GitBranch[]` (isRemote = name.startsWith('origin/') hoặc chứa '/', isCurrent = HEAD = '*'). Lưu ý: remote ref có thể có `remotes/` prefix nếu dùng `%(refname:short)` với `-a` → trả `origin/main`, local trả `main`. HEAD line có thể có `(HEAD detached...)` — lọc.
- `getBranches(projectPath)` — chạy lệnh trên.
- `createBranch(projectPath, name, base)` — `git branch <name> <base>` → `GitActionResult`.
- `checkout(projectPath, branch)` — `git checkout <branch>`; nếu `branch` bắt đầu `origin/` → `git checkout -b <short> --track <branch>` → `GitActionResult`.
- `stashPush(projectPath)` — `git stash push -u -m meow-switch` → `GitActionResult` (git trả lỗi nếu không có gì để stash: `No local changes to save`).
- `stashPop(projectPath)` — `git stash pop` → `GitActionResult`.
- `parseStatus(stdout)` — `git status --porcelain=v2 -b` → `GitStatusDetail`: branch từ `# branch.head`, files từ dòng XY (X=index/staged, Y=worktree), untracked từ dòng `? path`.
- `getStatusDetail(projectPath)` — chạy; không phải repo → null (giống GitStatusService cũ).
- `getDiff(projectPath, file?, staged?)` — `git diff [--cached] [-- <file>]` → string raw (có thể rỗng).
- `parseCommits(stdout)` — `git log --format=%H%x00%an%x00%ae%x00%at%x00%s%x00%b%x1f` (record phân cách bởi dòng trống → dùng `%x1e` separator + `\n` record) → `GitCommit[]`.
  - Format an toàn: `git log -n <count> --format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e [--follow -- <file>]` — record split `\x1e`, field split `\x1f`.
- `getCommits(projectPath, file?, count = 200)` — `git log -n <count> --format=... [-- <file>]`.
- `getFileHistory(projectPath, file)` — `git log --follow -n 200 --format=... -- <file>`.
- `parseDiffTree(stdout)` — từ `git diff-tree -p -r` hoặc `git diff a b` → `GitDiffResult` với `GitDiffFile[]`: split theo dòng bắt đầu `diff --git `; mỗi block parse `path` (từ `b/...`), status (A/M/D/R từ `new file`/`deleted file`/`similarity index`), additions/deletions từ `^\+[^+]`/`^-[^-]` count, raw = block.
- `getCommitDiff(projectPath, sha)` — `git diff-tree -p -r -m <sha>` → parse. (Dùng `-m` để hiện cả merge commit; nếu `--cc` phức tạp → giữ `-m`, diff vs từng parent.)
- `compareCommits(projectPath, a, b)` — `git diff a b` → parse.
- `parseBlame(stdout)` — `git blame --line-porcelain <file>`: entry bắt đầu `<sha> <orig> <final> [n]`; các dòng metadata `author `, `author-time `, `summary ` cho tới dòng bắt đầu `\t` (code). Map theo finalLine.
- `getBlame(projectPath, file)` — chạy `git blame --line-porcelain -- <file>` → `GitBlameLine[]`; file không tồn tại / không có commit → lỗi git raw → renderer hiển thị.

**Quan trọng (Windows)**: `git` trên Windows là `.exe` → `execFile('git', ...)` chạy trực tiếp được (không cần cmd.exe — khác với node-pty shim). Kiểm tra trong test: dùng `execFileSync('git', ...)` ở beforeEach như `git-status-service.test.ts` (đã hoạt động trên CI này).

**Tests** (`tests/unit/git-service.test.ts`) — mẫu theo `git-status-service.test.ts`:
- `parseBranches` với output giả (local main + origin/main + HEAD).
- `createBranch` + `checkout` trên repo thật: init, commit 1 file, `createBranch('feat/x')`, `checkout('feat/x')` → branch hiện tại = feat/x; `checkout('origin/main')` khi chưa có local → tạo local tracking `main`.
- `checkout` khi dirty file bị overwrite → trả `{ ok: false, error }` chứa stderr git.
- `getStatusDetail`: file modified staged + untracked → đúng flags; không phải repo → null.
- `getDiff`: file mới sửa chưa staged → raw chứa `+`; `--cached` rỗng.
- `getCommits` + `getFileHistory`: commit 2 lần, verify hash/author/message; file history chỉ trả commit liên quan file đó.
- `getCommitDiff`: sau 1 commit thêm file → files[0].status = added, raw chứa `+`.
- `compareCommits`: 2 commit → diff giữa chúng.
- `getBlame`: 2 dòng do 2 commit khác nhau → sha/author đúng per line.
- `parseDiffTree`/`parseBlame` với output giả để test parse thuần (không cần git thật).

Chạy `npx vitest run tests/unit/git-service.test.ts` → pass.

Commit: `feat(git): GitService for branches, diff, log and blame`

## Task 3 — Git popup window + IPC handlers (main)

1. `src/main/git-viewer.ts` (bắt chước `file-viewer.ts`):
   - `const viewerWindows = new Map<string, BrowserWindow>()` (key = projectPath).
   - `openGitViewer(projectPath, getMainWindow)`: focus nếu tồn tại; nếu không tạo `BrowserWindow({ width: 940, height: 700, title: basename(projectPath) + ' — Git', backgroundColor: '#1e1e1e', autoHideMenuBar: true, webPreferences giống file-viewer })`; `loadURL(base + '?git=' + encodeURIComponent(projectPath))`; `closed` → delete.
2. `src/main/index.ts`:
   - Import `GitService` (thêm `private gitSvc = new GitService()` trong `MainApp` hoặc tạo instance trong module) + `openGitViewer`.
   - Trong `registerIpcHandlers`, thêm:
     ```ts
     ipcMain.handle(Channels.GitOpenViewer, (_e, projectPath: string) => openGitViewer(projectPath, () => win))
     ipcMain.handle(Channels.GitGetBranches, (_e, p: string) => gitSvc.getBranches(p))
     ipcMain.handle(Channels.GitCreateBranch, (_e, p: string, n: string, b: string) => gitSvc.createBranch(p, n, b))
     ipcMain.handle(Channels.GitCheckout, (_e, p: string, b: string) => gitSvc.checkout(p, b))
     ipcMain.handle(Channels.GitStash, (_e, p: string) => gitSvc.stashPush(p))
     ipcMain.handle(Channels.GitStashPop, (_e, p: string) => gitSvc.stashPop(p))
     ipcMain.handle(Channels.GitStatusDetail, (_e, p: string) => gitSvc.getStatusDetail(p))
     ipcMain.handle(Channels.GitGetDiff, (_e, p: string, f?: string, staged?: boolean) => gitSvc.getDiff(p, f, staged))
     ipcMain.handle(Channels.GitGetCommits, (_e, p: string, f?: string, count?: number) => gitSvc.getCommits(p, f, count))
     ipcMain.handle(Channels.GitGetCommitDiff, (_e, p: string, sha: string) => gitSvc.getCommitDiff(p, sha))
     ipcMain.handle(Channels.GitCompareCommits, (_e, p: string, a: string, b: string) => gitSvc.compareCommits(p, a, b))
     ipcMain.handle(Channels.GitGetBlame, (_e, p: string, f: string) => gitSvc.getBlame(p, f))
     ipcMain.handle(Channels.GitGetFileHistory, (_e, p: string, f: string) => gitSvc.getFileHistory(p, f))
     ```
3. `src/preload/index.ts`: implement 13 method (map channel → invoke).

Chạy typecheck. Commit: `feat(git): open git viewer popup and register IPC handlers`

## Task 4 — Renderer routing `?git=`

`src/renderer/src/main.tsx`: thêm nhánh
```ts
const gitParam = params.get('git')
// fileParam → FileViewer; gitParam → GitViewer; else App
```
Tạo `GitViewer.tsx` sơ khai (render "Git" + projectPath) để routing hoạt động, test typecheck.

Commit: `feat(git): route ?git= param to GitViewer popup`

## Task 5 — GitDiffView (TDD tầng renderer — parse thuần)

Tạo `src/renderer/src/components/git/parseDiff.ts` (module thuần, test được):

- `parseUnifiedDiff(raw): DiffHunk[]` — split dòng; tìm `@@ -a,b +c,d @@` header; mỗi hunk chứa lines `{ type: 'ctx'|'add'|'del'|'hunk', oldLine?, newLine?, text }`; dòng `\ No newline at end of file` giữ dạng meta.
- `GitDiffView.tsx` render: hunk header màu khác, add xanh, del đỏ, line number hai cột.

Tests: `tests/unit/parse-diff.test.ts` — output giả của `git diff` (hunk chuẩn, rename, no-newline) → hunk/lines đúng.

Commit: `feat(git): unified diff parser and view`

## Task 6 — GitViewer UI

`src/renderer/src/components/git/GitViewer.tsx`:

- State: `projectPath`, `tab: 'changes'|'history'|'blame'`, `branches`, `currentBranch`, `status`, `commits`, `diff`, `blame`, `error: GitCommandError-ish {command,error} | null`, `busy` (đang switch), `switchDialog` (dirty flow).
- Load khởi tạo: `gitGetBranches` + `gitGetStatusDetail` (Promise.all), render spinner.
- `refreshAll()`: gọi lại branches + status + commits (nếu tab history) + blame (nếu đang blame file).
- Header: tên project, `GitBranchSwitcher`, nút refresh, nút đóng (`window.close()`), Escape đóng.
- `GitErrorBanner`: hiện `error` (icon + title theo loại: branch/checkout/stash + stderr thô + `git <command>` + nút Copy) + nút dismiss.
- Tabs: 3 nút.

**GitBranchSwitcher**:
- Dropdown list: section Local (checkmark nhánh current), section Remote (`origin/...`), divider, ô input "Create new branch from <current>" + nút Create.
- Chọn branch → `handleSwitch(branch)`:
  1. `busy = true`.
  2. Lấy `gitGetStatusDetail`; nếu `files.length === 0` (hoặc chỉ untracked và branch là local) → `gitCheckout` trực tiếp → thành công → `refreshAll()`; lỗi → `setError`.
  3. Nếu dirty → `setSwitchDialog({ branch })` (chưa checkout).
- Dialog dirty (component `SwitchDialog`): message "Working tree có N file thay đổi chưa commit. Switch to 'x'?" + 4 nút:
  - **Stash & switch**: `gitStash` → `gitCheckout` → `gitStashPop`. Nếu stash lỗi → error + dừng. Nếu pop lỗi → error (kèm stash name `meow-switch`) + giữ stash.
  - **Bring changes**: `gitCheckout` trực tiếp; lỗi → error banner (git raw, gợi ý Stash).
  - **Discard changes**: xác nhận lần nữa ("mất vĩnh viễn") → `gitCheckout` với pre-discard: chạy `git checkout -- .` + `git clean -fd` → `gitCheckout`.
  - **Cancel**: đóng dialog.
  - Sau bất kỳ thành công → `refreshAll()`, `busy = false`, đóng dialog.
  - `busy` → disable dropdown + tabs + buttons.

**GitChangesTab** (`gitChanges` state: `GitStatusDetail`):
- Nhóm Staged (files có `staged`), nhóm Changes not staged (files có `unstaged` hoặc untracked).
- Mỗi file: icon status (A/M/D/R/U) màu theo loại + path.
- Click file → load `gitGetDiff(projectPath, file, staged?)` → `GitDiffView`; toggle Staged/Unstaged button khi file có cả hai.

**GitHistoryTab**:
- Load `gitGetCommits(projectPath, count=200)` khi mount/tab active; lazy-load: nút "Load more" → `count += 200`.
- List commit: shortHash, subject, author, date (format `Intl.DateTimeFormat`).
- Click commit → `gitGetCommitDiff(sha)` → danh sách `GitDiffFile` (path + status + add/del count) + click file → `GitDiffView` (dùng raw của file đó).
- Compare mode: checkbox cạnh mỗi commit; khi đủ 2 → header hiện `A...B` + nút "Compare" → `gitCompareCommits` → render như diff commit.
- Click file trong diff commit → chuyển sang file history (`gitGetFileHistory`) — view thay list commits, có nút "← Back to commits".
- Nút "Back to commits" khi đang xem file history.

**GitBlameTab**:
- Trái: `GitFileTree` (root = projectPath, lazy load `listDir`; click file → nếu text (dùng `isHighlightable` + đọc content qua `gitGetBlame` + `getFileContent` nếu cần)) → load blame + content song song.
- Phải: code viewer: hàng dòng; cột trái blame (shortSha, author, date), hover → title tooltip summary; cột phải code (dùng `highlightCode` nếu có, fallback plain). Blame entries map theo line → nếu file có dòng không blame (untracked) hiện `·`.

**CSS** (`styles.css`, section mới `/* Git viewer popup */`): dựa vào biến có sẵn (`--bg-panel`, `--hairline`, `--green`, `--red`, `--radius`...). Các class: `.git-viewer`, `.git-header`, `.git-tabs`, `.git-tab`, `.git-body`, `.git-error-banner`, `.git-branch-dropdown`, `.git-switch-dialog`, `.git-changes`, `.git-change-row`, `.git-diff-file`, `.git-history`, `.git-commit-row`, `.git-blame`, `.git-blame-gutter`, `.git-blame-line`, `.git-diff-view`, `.git-hunk`, `.git-diff-line`, `.git-diff-add`, `.git-diff-del`, `.git-diff-num`.

Commit: `feat(git): GitViewer popup with changes/history/blame tabs and branch switching`

## Task 7 — Entry points: Sidebar menu + StatusBar

1. `StatusBar.tsx`: prop `onGitClick?: () => void`; đổi `<span className="sb-item sb-mono sb-dim">` thành `<button className="sb-item sb-mono sb-dim sb-git" title="Open git viewer" onClick={onGitClick}>` (giữ style, thêm hover như `sb-browser`).
2. `Sidebar.tsx`: prop `onOpenGit: (path: string) => void`; thêm menu item "Git" (icon `GitBranch` từ lucide-react) giữa "Open in VS Code" và "Open Folder" trong project context menu → `onOpenGit(ws.projectPath)`.
3. `App.tsx`: `onOpenGit={(p) => void window.api.gitOpenViewer(p)}` cho Sidebar; `onGitClick={runtime ? () => void window.api.gitOpenViewer(runtime.workspace.projectPath) : undefined}` cho StatusBar.
4. CSS: `.sb-git` hover style (giống `.sb-browser:hover`).

Chạy typecheck. Commit: `feat(git): open git viewer from sidebar menu and status bar`

## Task 8 — Verify toàn bộ

1. `npm run typecheck` pass.
2. `npm test` pass (chú ý 10 test officecli đã fail từ trước — không liên quan; xác nhận không fail mới).
3. `npm run build && npm run e2e` (renderer main.tsx + App.tsx đổi → chạy e2e smoke).

Commit: nếu có fix phát sinh.

## Lưu ý cross-cutting

- **Không hardcode channel** — chỉ dùng `Channels.*`.
- **Mọi exec ở main** — renderer chỉ gọi `window.api`.
- **An toàn**: git args không qua shell (`execFile`), timeout 15s, `maxBuffer` 64MB cho diff lớn.
- **Path an toàn**: blame/diff file path từ UI — chỉ truyền tới git với `-- <file>`; không dùng cho fs access (khác FileViewer). Không cần kiểm `isPathInside` vì git tự xử lý path.
- **Windows**: git là `.exe` → `execFile` trực tiếp OK (không giống node-pty).
- Merge commit diff: dùng `git diff-tree -p -r -m` để không bỏ trống.
- Trạng thái tạm: `busy` flag ngăn thao tác chồng lấn khi switch.
