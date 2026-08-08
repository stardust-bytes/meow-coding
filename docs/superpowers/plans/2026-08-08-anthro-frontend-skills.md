# Anthropic Front-end Skills Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhúng 5 skill front-end/design từ `anthropics/skills` (Apache-2.0) vào `resources/skills/<name>/` để native Meow agent load qua tool `skill`, giống superpowers. Copy nguyên vẹn, không sửa code runtime.

**Architecture:** Tận dụng pipeline skill có sẵn (`collectSkills` → system prompt + `skill` tool + `extraResources`). Việc duy nhất là đặt 5 thư mục skill (SKILL.md + LICENSE.txt + assets) vào `resources/skills/` và mở rộng test guard. Không đổi `skill.ts`, registry, manager, index.ts, config, packaging.

**Tech Stack:** Git (sparse clone), PowerShell, Vitest. Không thêm dependency, không đổi IPC/preload/renderer.

## Global Constraints

- Copy **verbatim**: giữ nguyên frontmatter `name`/`description`, nội dung, cấu trúc thư mục, LICENSE.txt. Không dịch, không sửa lời hướng dẫn.
- Nguồn gốc định danh: tên skill phải khớp chính xác `frontend-design`, `brand-guidelines`, `web-artifacts-builder`, `theme-factory`, `canvas-design` (dùng làm `name` trong frontmatter).
- `resources/skills/` phải giữ nguyên 14 skill superpowers đang có — không xóa/sửa.
- Tuân theo `AGENTS.md`: không thêm comment thừa; test guard `tests/unit/agent-skill-bundled.test.ts` phải khớp đúng 19 skill.
- Bắt buộc sau mỗi task: `npm run typecheck` pass, `npm test` pass.
- Không chạy e2e bắt buộc (không đổi IPC/preload/renderer), nhưng `npm run build && npm run e2e` chạy được nếu cần xác nhận.

---

### Task 1: Copy 5 skill folders vào resources/skills

**Files:**
- Create: `resources/skills/frontend-design/{SKILL.md, LICENSE.txt}`
- Create: `resources/skills/brand-guidelines/{SKILL.md, LICENSE.txt}`
- Create: `resources/skills/web-artifacts-builder/{SKILL.md, LICENSE.txt, scripts/{init-artifact.sh, bundle-artifact.sh, shadcn-components.tar.gz}}`
- Create: `resources/skills/theme-factory/{SKILL.md, LICENSE.txt, themes/*.md, theme-showcase.pdf}`
- Create: `resources/skills/canvas-design/{SKILL.md, LICENSE.txt, canvas-fonts/*}`

**Interfaces:**
- Consumes: repo public `https://github.com/anthropics/skills` (branch `main`, thư mục `skills/<name>`).
- Produces: 5 thư mục skill hoàn chỉnh trong `resources/skills/` — Task 2 đọc chúng qua `collectSkills`.

- [ ] **Step 1: Sparse-clone repo anthropics/skills vào thư mục tạm**

PowerShell (từ thư mục repo meow):

```powershell
$tmp = Join-Path $env:TEMP 'anthro-skills-clone'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
git clone --depth 1 --filter=blob:none --sparse https://github.com/anthropics/skills.git $tmp
git -C $tmp sparse-checkout set skills/frontend-design skills/brand-guidelines skills/web-artifacts-builder skills/theme-factory skills/canvas-design
```

Expected: 5 thư mục xuất hiện trong `$tmp/skills/`.

- [ ] **Step 2: Copy 5 thư mục skill vào resources/skills**

PowerShell:

```powershell
$src = Join-Path $env:TEMP 'anthro-skills-clone\skills'
$dst = 'resources\skills'
foreach ($name in @('frontend-design','brand-guidelines','web-artifacts-builder','theme-factory','canvas-design')) {
  Copy-Item -LiteralPath (Join-Path $src $name) -Destination (Join-Path $dst $name) -Recurse -Force
}
```

Expected: mỗi `resources/skills/<name>/SKILL.md` tồn tại cùng LICENSE.txt.

- [ ] **Step 3: Verify file hỗ trợ tồn tại**

PowerShell:

```powershell
@(
  'web-artifacts-builder\scripts\init-artifact.sh',
  'web-artifacts-builder\scripts\bundle-artifact.sh',
  'web-artifacts-builder\scripts\shadcn-components.tar.gz',
  'theme-factory\themes\ocean-depths.md',
  'theme-factory\theme-showcase.pdf',
  'canvas-design\canvas-fonts\WorkSans-Regular.ttf'
) | ForEach-Object { if (-not (Test-Path -LiteralPath (Join-Path 'resources\skills' $_))) { throw "Missing: $_" } }
Write-Output 'all skill assets present'
```

Expected: in ra `all skill assets present`.

- [ ] **Step 4: Run test guard để xác nhận nó đang FAIL do danh sách thiếu 5 skill mới**

Run: `npx vitest run tests/unit/agent-skill-bundled.test.ts`
Expected: FAIL — assertion `expect(names).toEqual([...])` chứa 14 tên cũ nhưng thực tế là 19 (14 cũ + 5 mới). Đây là red state đúng — chuyển sang Task 2 để làm xanh.

- [ ] **Step 5: Commit**

```bash
git add resources/skills
git commit -m "feat(skills): bundle anthropic front-end/design skills (frontend-design, brand-guidelines, web-artifacts-builder, theme-factory, canvas-design)"
```

---

### Task 2: Mở rộng test guard — 19 skills + assert asset

**Files:**
- Modify: `tests/unit/agent-skill-bundled.test.ts`

**Interfaces:**
- Consumes: 5 skill mới từ Task 1 qua `collectSkills(ROOT, undefined, BUILTIN)`; `createSkillTool` (không đổi).
- Produces: test xanh xác nhận 19 skills, mỗi skill có `description`/`content` hợp lệ, asset hỗ trợ tồn tại trên đĩa.

- [ ] **Step 1: Sửa test guard — danh sách 19 skill + asset assertions**

Thay toàn bộ nội dung `tests/unit/agent-skill-bundled.test.ts` bằng:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { collectSkills, skillListText } from '../../src/main/agent/skill'
import { createSkillTool } from '../../src/main/agent/tools/skill'
import type { ToolContext } from '../../src/main/agent/tools/types'

const ROOT = path.resolve(__dirname, '../..')
const BUILTIN = path.join(ROOT, 'resources', 'skills')

const ctx: ToolContext = { cwd: ROOT, ask: async () => null }

describe('bundled skills', () => {
  it('collects every bundled skill with name+description', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual([
      'brand-guidelines', 'brainstorming', 'canvas-design',
      'dispatching-parallel-agents', 'executing-plans',
      'finishing-a-development-branch', 'frontend-design',
      'receiving-code-review', 'requesting-code-review',
      'subagent-driven-development', 'systematic-debugging',
      'test-driven-development', 'theme-factory', 'using-git-worktrees',
      'using-superpowers', 'verification-before-completion',
      'web-artifacts-builder', 'writing-plans', 'writing-skills'
    ])
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.content.length).toBeGreaterThan(50)
    }
  })

  it('skill tool returns content + script dir for the SDD skill', async () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const r = await tool.run({ name: 'subagent-driven-development' }, ctx)
    expect(r.error).toBeUndefined()
    expect(r.output).toContain('sdd-workspace')
    expect(r.output).toContain('task-brief')
    expect(r.output).toContain('review-package')
  })

  it('skill tool returns frontend-design content with a path hint', async () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const r = await tool.run({ name: 'frontend-design' }, ctx)
    expect(r.error).toBeUndefined()
    expect(r.output).toContain('Design principles')
    expect(r.output).toContain('frontend-design')
  })

  it('skillListText lists new and old skill names', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const text = skillListText(skills)
    expect(text).toContain('using-superpowers')
    expect(text).toContain('frontend-design')
    expect(text).toContain('canvas-design')
    expect(text).toContain('theme-factory')
  })

  it('supporting assets exist on disk for every bundled skill', () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    for (const s of skills) {
      expect(s.path).toBeTruthy()
      if (s.name === 'subagent-driven-development') {
        for (const script of ['sdd-workspace', 'task-brief', 'review-package']) {
          expect(existsSync(path.join(s.path!, 'scripts', script))).toBe(true)
        }
      }
    }
    const assets: Record<string, string[]> = {
      'web-artifacts-builder': ['scripts/init-artifact.sh', 'scripts/bundle-artifact.sh', 'scripts/shadcn-components.tar.gz'],
      'theme-factory': ['themes/ocean-depths.md', 'themes/midnight-galaxy.md', 'theme-showcase.pdf'],
      'canvas-design': ['canvas-fonts/WorkSans-Regular.ttf', 'canvas-fonts/ArsenalSC-Regular.ttf']
    }
    for (const skill of skills) {
      for (const rel of assets[skill.name] ?? []) {
        expect(existsSync(path.join(skill.path!, rel))).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run test guard để xác nhận PASS**

Run: `npx vitest run tests/unit/agent-skill-bundled.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass (test TS không lỗi, không đổi code runtime).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/agent-skill-bundled.test.ts
git commit -m "test(skills): cover 19 bundled skills incl. anthropic front-end set and asset existence"
```

---

### Task 3: Full verification

**Files:**
- Không đổi file.

- [ ] **Step 1: Run toàn bộ test suite**

Run: `npm test`
Expected: tất cả pass (unit + integration), không phá test hiện có.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Dọn thư mục clone tạm**

PowerShell:

```powershell
$tmp = Join-Path $env:TEMP 'anthro-skills-clone'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
```

Expected: `$tmp` không còn tồn tại.

- [ ] **Step 4: Commit (nếu còn thay đổi dư)**

```bash
git status --short
# chỉ commit nếu có file thay đổi ngoài ý muốn
```
