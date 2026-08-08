# Slash command `/frontend-design` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm built-in slash command `/frontend-design` cho native Meow agent — dispatch request tới skill `frontend-design` (đã bundle) qua pattern giống `SUPERPOWERS_COMMANDS`.

**Architecture:** Thêm một `Command` vào `builtin` map trong `src/main/agent/commands.ts`; command này là prompt thường (không `type: 'system'`), chảy qua pipeline `listCommands` → `/` menu → `runCommand` → `resolveCommand` có sẵn. Không đổi IPC/preload/renderer.

**Tech Stack:** TypeScript (main process), Vitest. Không thêm dependency.

## Global Constraints

- Tuân theo `AGENTS.md`: không thêm comment thừa; chỉ comment khi giải thích quyết định phức tạp.
- Tên command `frontend-design` (không prefix `sp-`), khớp tên skill để agent gọi `skill(name)`.
- Template phải chứa: `Use the \`frontend-design\` skill for this request and follow it strictly.`, dòng `Read @AGENTS.md before taking action.`, và `User request:` + `$ARGUMENTS`.
- Không đổi `src/shared/ipc.ts`, preload, renderer, `meow-agent-manager.ts`.
- Bắt buộc `npm run typecheck` pass và `npm test` pass sau khi hoàn thành.

---

### Task 1: Thêm `FRONTEND_DESIGN_COMMAND` và đăng ký vào builtin map

**Files:**
- Modify: `src/main/agent/commands.ts`

**Interfaces:**
- Consumes: type `Command` từ `../../shared/types` (đã import).
- Produces: `export const FRONTEND_DESIGN_COMMAND: Command` — được `CommandStore` đăng ký với `name: 'frontend-design'`; Task 2 import và test nó.

- [ ] **Step 1: Thêm FRONTEND_DESIGN_COMMAND sau block SUPERPOWERS_COMMANDS**

Trong `src/main/agent/commands.ts`, sau dòng `} as Command[])` của `SUPERPOWERS_COMMANDS` (dòng 70), thêm:

```ts
export const FRONTEND_DESIGN_COMMAND: Command = {
  name: 'frontend-design',
  description: 'Design or redesign UI following the frontend-design skill',
  template: [
    'Use the `frontend-design` skill for this request and follow it strictly.',
    '',
    'Project context:',
    '- Read @AGENTS.md before taking action.',
    '- Ground the design in the product subject, its audience, and the single job the page must do.',
    '',
    'User request:',
    '$ARGUMENTS'
  ].join('\n')
}
```

- [ ] **Step 2: Đăng ký vào builtin map**

Trong `CommandStore` constructor, sửa dòng:

```ts
private builtin = new Map<string, Command>(
  [INIT_COMMAND, REVIEW_COMMAND, NEW_COMMAND, ...SUPERPOWERS_COMMANDS].map(c => [c.name, c])
)
```

thành:

```ts
private builtin = new Map<string, Command>(
  [INIT_COMMAND, REVIEW_COMMAND, NEW_COMMAND, FRONTEND_DESIGN_COMMAND, ...SUPERPOWERS_COMMANDS].map(c => [c.name, c])
)
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/commands.ts
git commit -m "feat(agent): add /frontend-design slash command dispatching to the frontend-design skill"
```

---

### Task 2: Mở rộng test guard cho commands

**Files:**
- Modify: `tests/unit/agent-commands.test.ts`

**Interfaces:**
- Consumes: `FRONTEND_DESIGN_COMMAND`, `CommandStore`, `resolveCommand` từ Task 1.
- Produces: test xanh xác nhận command có trong `list()` và template dispatch đúng skill.

- [ ] **Step 1: Sửa import và thêm test**

Trong `tests/unit/agent-commands.test.ts`, sửa dòng import (line 5-8) thành:

```ts
import {
  CommandStore, INIT_COMMAND, REVIEW_COMMAND, FRONTEND_DESIGN_COMMAND, SUPERPOWERS_COMMANDS,
  projectCommands, uniqueCommands, resolveCommandTemplate, resolveShell, resolveCommand
} from '../../src/main/agent/commands'
```

Thêm 2 test vào block `describe('CommandStore', ...)` (sau test "lists built-ins plus saved user commands"):

```ts
  it('lists the frontend-design built-in command', () => {
    const store = new CommandStore(file)
    expect(store.list().map(c => c.name)).toContain('frontend-design')
    expect(store.get('frontend-design')?.description).toContain('frontend-design skill')
  })

  it('frontend-design command resolves $ARGUMENTS into the skill dispatch prompt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-fd-'))
    try {
      const out = await resolveCommand(FRONTEND_DESIGN_COMMAND, ['redesign the landing page'], {
        cwd: dir, commands: []
      })
      expect(out).toContain('Use the `frontend-design` skill for this request and follow it strictly.')
      expect(out).toContain('Read @AGENTS.md before taking action.')
      expect(out).toContain('User request:\nredesign the landing page')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
```

- [ ] **Step 2: Run test để xác nhận PASS**

Run: `npx vitest run tests/unit/agent-commands.test.ts`
Expected: PASS (toàn bộ tests trong file, gồm 2 test mới).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/agent-commands.test.ts
git commit -m "test(agent): cover /frontend-design slash command dispatch"
```

---

### Task 3: Full verification

**Files:**
- Không đổi file.

- [ ] **Step 1: Run toàn bộ test suite**

Run: `npm test`
Expected: tất cả pass (450+), không phá test hiện có.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit (nếu còn thay đổi dư)**

```bash
git status --short
# chỉ commit nếu có file thay đổi ngoài ý muốn
```
