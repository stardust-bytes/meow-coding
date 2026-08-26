# Subagent Permission Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay `decidePermission: () => 'allow'` trong subagent bằng một permission context dẫn xuất từ agent cha, mở subagent cho role tự định nghĩa bằng file, và sửa năm lỗ hổng cùng nằm trên đường đi của `task` tool.

**Architecture:** `permission.ts` mọc thêm `ToolPermissionContext` (gom `mode` + `rules` + `isSavedAllow` + `canPrompt`) và hai hàm thuần: `decide(ctx, tool, input)` — logic cũ cộng luật "không hỏi được thì cấm" — và `deriveSubagentContext(parent, role, opts)` chỉ thu hẹp, không nới. `meow-agent-manager` dựng context của cha (dựng lại mỗi lần gọi nên luôn live), `task.ts` derive theo role rồi bọc thành callback cho `SessionRunner` con. `SessionRunner` giữ nguyên interface. Role đến từ `.meow/agents/*.md` → `userData/agents/*.md` → ba role built-in, first-wins theo tên.

**Tech Stack:** TypeScript strict, Electron main process, zod (schema tool), Vitest (unit + integration).

**Spec:** `docs/superpowers/specs/2026-08-26-subagent-permission-hardening-design.md`

## Global Constraints

- TypeScript strict. `npm run typecheck` phải xanh ở mọi commit.
- `npm test` phải xanh ở mọi commit. Baseline hiện tại có **10 test fail sẵn** trong `tests/unit/officecli-binary-manager.test.ts` (máy có `officecli` trên PATH) — số fail phải giữ **đúng 10**, không hơn.
- Không hardcode chuỗi IPC channel; chỉ dùng `Channels` từ `src/shared/ipc.ts`.
- `src/shared` không được import Node/Electron.
- Chỉ comment khi giải thích quyết định khó, không comment mô tả code.
- Alias `@shared` → `src/shared`.
- Mọi thay đổi hành vi phải có test viết **trước** phần implement (TDD).
- Commit sau mỗi task.

---

### Task 1: `ToolPermissionContext` và `decide()`

**Files:**
- Modify: `src/main/agent/permission.ts`
- Test: `tests/unit/agent-permission.test.ts`

**Interfaces:**
- Consumes: `PermissionRule` (`./config`), `AgentMode` (`../../shared/types`), `PermissionDecision`, `rulesForMode`, `matchPattern`, `isWriteBashCommand` — đã có sẵn trong file.
- Produces:
  - `interface ToolPermissionContext { mode: AgentMode; rules: Record<string, PermissionRule>; isSavedAllow: (toolName: string) => boolean; canPrompt: boolean }`
  - `function decide(ctx: ToolPermissionContext, toolName: string, input?: Record<string, unknown>): PermissionDecision`
  - `decidePermission(...)` giữ nguyên chữ ký cũ, thành wrapper gọi `decide()` với `canPrompt: true`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/unit/agent-permission.test.ts`:

```ts
import { decide, type ToolPermissionContext } from '../../src/main/agent/permission'

function ctx(over: Partial<ToolPermissionContext> = {}): ToolPermissionContext {
  return { mode: 'build', rules: {}, isSavedAllow: () => false, canPrompt: true, ...over }
}

describe('decide with a permission context', () => {
  it('asks when a prompt channel exists', () => {
    expect(decide(ctx({ rules: { bash: 'ask' } }), 'bash', { command: 'ls' })).toBe('ask')
  })

  it('denies instead of asking when there is no way to prompt', () => {
    expect(decide(ctx({ rules: { bash: 'ask' }, canPrompt: false }), 'bash', { command: 'ls' })).toBe('deny')
  })

  it('denies an unlisted tool with no prompt channel', () => {
    expect(decide(ctx({ canPrompt: false }), 'office')).toBe('deny')
  })

  it('still allows what the rules allow without a prompt channel', () => {
    expect(decide(ctx({ rules: { read: 'allow' }, canPrompt: false }), 'read')).toBe('allow')
  })

  it('keeps deny winning over a saved always-allow', () => {
    expect(decide(ctx({ rules: { git: 'deny' }, isSavedAllow: () => true }), 'git')).toBe('deny')
  })

  it('denies a write-style bash command in plan mode', () => {
    expect(decide(ctx({ mode: 'plan' }), 'bash', { command: 'sed -i s/a/b/ f.txt' })).toBe('deny')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-permission.test.ts`
Expected: FAIL — `decide` không được export từ `permission.ts`.

- [ ] **Step 3: Implement**

Trong `src/main/agent/permission.ts`, thêm sau `matchPattern`/`anyRule` và **thay** phần thân của `decidePermission`:

```ts
export interface ToolPermissionContext {
  mode: AgentMode
  rules: Record<string, PermissionRule>
  isSavedAllow: (toolName: string) => boolean
  canPrompt: boolean
}

function decideRaw(
  ctx: ToolPermissionContext,
  toolName: string,
  input?: Record<string, unknown>
): PermissionDecision {
  if (ctx.mode === 'plan' && toolName === 'bash') {
    const command = typeof input?.command === 'string' ? input.command : ''
    if (command && isWriteBashCommand(command)) return 'deny'
  }
  const combined = { ...ctx.rules, ...rulesForMode(ctx.mode) }
  if (anyRule(combined, toolName, 'deny')) return 'deny'
  if (ctx.mode !== 'plan' && ctx.isSavedAllow(toolName)) return 'allow'
  if (anyRule(combined, toolName, 'allow')) return 'allow'
  return 'ask'
}

export function decide(
  ctx: ToolPermissionContext,
  toolName: string,
  input?: Record<string, unknown>
): PermissionDecision {
  const decision = decideRaw(ctx, toolName, input)
  // No channel to ask through is not the same as permission to proceed.
  if (decision === 'ask' && !ctx.canPrompt) return 'deny'
  return decision
}

export function decidePermission(
  mode: AgentMode,
  configRules: Record<string, PermissionRule>,
  isSavedAllow: (toolName: string) => boolean,
  toolName: string,
  input?: Record<string, unknown>
): PermissionDecision {
  return decide({ mode, rules: configRules, isSavedAllow, canPrompt: true }, toolName, input)
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-permission.test.ts`
Expected: PASS, kể cả các test cũ của `decidePermission`.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/permission.ts tests/unit/agent-permission.test.ts
git commit -m "feat(permission): add ToolPermissionContext and decide()"
```

---

### Task 2: `SubagentRole` và `deriveSubagentContext()`

**Files:**
- Modify: `src/main/agent/permission.ts`
- Test: `tests/unit/agent-permission.test.ts`

**Interfaces:**
- Consumes: `ToolPermissionContext` (Task 1).
- Produces:
  - `interface SubagentRole { name: string; description: string; system: string; tools: string[]; rules: Record<string, PermissionRule>; model?: { provider: string; model: string } }`
  - `function deriveSubagentContext(parent: ToolPermissionContext, role: SubagentRole, opts: { background: boolean }): ToolPermissionContext`

- [ ] **Step 1: Viết test thất bại**

```ts
import { deriveSubagentContext, type SubagentRole } from '../../src/main/agent/permission'

function role(over: Partial<SubagentRole> = {}): SubagentRole {
  return { name: 'r', description: '', system: '', tools: [], rules: {}, ...over }
}

describe('deriveSubagentContext', () => {
  it('cannot widen: a role asking for allow keeps the parent ask', () => {
    const child = deriveSubagentContext(
      ctx({ rules: { bash: 'ask' } }),
      role({ rules: { bash: 'allow' } }),
      { background: false }
    )
    expect(child.rules.bash).toBe('ask')
  })

  it('cannot widen: a role asking for allow keeps the parent deny', () => {
    const child = deriveSubagentContext(
      ctx({ rules: { git: 'deny' } }),
      role({ rules: { git: 'allow' } }),
      { background: false }
    )
    expect(child.rules.git).toBe('deny')
  })

  it('tightens: a role denying a tool the parent allows', () => {
    const child = deriveSubagentContext(
      ctx({ rules: { git: 'allow' } }),
      role({ rules: { git: 'deny' } }),
      { background: false }
    )
    expect(child.rules.git).toBe('deny')
  })

  it('tightens a tool the parent has no rule for', () => {
    const child = deriveSubagentContext(ctx(), role({ rules: { office: 'deny' } }), { background: false })
    expect(child.rules.office).toBe('deny')
  })

  it('inherits mode and saved allowances untouched', () => {
    const parent = ctx({ mode: 'plan', isSavedAllow: (t) => t === 'read' })
    const child = deriveSubagentContext(parent, role(), { background: false })
    expect(child.mode).toBe('plan')
    expect(child.isSavedAllow('read')).toBe(true)
  })

  it('turns off prompting for a background subagent', () => {
    expect(deriveSubagentContext(ctx(), role(), { background: true }).canPrompt).toBe(false)
    expect(deriveSubagentContext(ctx(), role(), { background: false }).canPrompt).toBe(true)
  })

  it('never gains a prompt channel the parent lacks', () => {
    const child = deriveSubagentContext(ctx({ canPrompt: false }), role(), { background: false })
    expect(child.canPrompt).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-permission.test.ts`
Expected: FAIL — `deriveSubagentContext` chưa export.

- [ ] **Step 3: Implement**

Thêm vào `src/main/agent/permission.ts`:

```ts
export interface SubagentRole {
  name: string
  description: string
  system: string
  tools: string[]
  rules: Record<string, PermissionRule>
  model?: { provider: string; model: string }
}

const STRICTNESS: Record<PermissionRule, number> = { allow: 0, ask: 1, deny: 2 }

export function deriveSubagentContext(
  parent: ToolPermissionContext,
  role: SubagentRole,
  opts: { background: boolean }
): ToolPermissionContext {
  const rules: Record<string, PermissionRule> = { ...parent.rules }
  for (const [tool, rule] of Object.entries(role.rules)) {
    const current = rules[tool]
    // A role may only tighten: whichever side is stricter wins.
    if (current === undefined || STRICTNESS[rule] > STRICTNESS[current]) rules[tool] = rule
  }
  return {
    mode: parent.mode,
    rules,
    isSavedAllow: parent.isSavedAllow,
    canPrompt: parent.canPrompt && !opts.background
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-permission.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/permission.ts tests/unit/agent-permission.test.ts
git commit -m "feat(permission): derive a narrowing subagent context"
```

---

### Task 3: Role built-in và discovery từ file

**Files:**
- Create: `src/main/agent/subagent-roles.ts`
- Modify: `src/main/agent/skill.ts` (export `parseFrontmatter`)
- Modify: `src/shared/types.ts:332` (`SubagentType` → `string`)
- Modify: `src/main/agent/config.ts:267-289` (`normalizeSubagentModels` bỏ lọc theo enum)
- Test: `tests/unit/agent-subagent-roles.test.ts` (create)

**Interfaces:**
- Consumes: `SubagentRole` (Task 2), `parseFrontmatter` (`./skill`).
- Produces:
  - `const BUILTIN_ROLES: SubagentRole[]` — `research`, `general`, `reviewer`.
  - `function roleFromFile(file: string, knownTools: ReadonlySet<string>): SubagentRole | null`
  - `function collectSubagentRoles(cwd: string, knownTools: ReadonlySet<string>, userAgentsDir?: string): SubagentRole[]`
  - `type SubagentType = string`, `const BUILTIN_SUBAGENT_TYPES = ['research', 'general', 'reviewer'] as const`

**Lưu ý:** `general` **không còn** `todowrite` (Task 7 giải thích lý do). Định nghĩa built-in chuyển hẳn khỏi `task.ts` sang file này; `SUBAGENT_CONFIGS` biến mất.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/unit/agent-subagent-roles.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_ROLES, collectSubagentRoles } from '../../src/main/agent/subagent-roles'

const TOOLS = new Set(['read', 'glob', 'grep', 'bash', 'git', 'write', 'edit', 'webfetch', 'office'])

function projectWith(files: Record<string, string>): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'meow-roles-'))
  const dir = path.join(cwd, '.meow', 'agents')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body)
  return cwd
}

describe('subagent roles', () => {
  it('ships three built-in roles and general cannot write todos', () => {
    expect(BUILTIN_ROLES.map(r => r.name).sort()).toEqual(['general', 'research', 'reviewer'])
    const general = BUILTIN_ROLES.find(r => r.name === 'general')!
    expect(general.tools).not.toContain('todowrite')
    expect(general.tools).toContain('bash')
  })

  it('reads a role from a project file', () => {
    const cwd = projectWith({
      'migrator.md': [
        '---',
        'name: db-migrator',
        'description: Runs migrations',
        'tools: read, grep, bash, nonsense-tool',
        'model: anthropic/claude-sonnet-5',
        'deny: git',
        'ask: bash',
        '---',
        'You migrate databases.'
      ].join('\n')
    })
    const roles = collectSubagentRoles(cwd, TOOLS)
    const role = roles.find(r => r.name === 'db-migrator')!
    expect(role.tools).toEqual(['read', 'grep', 'bash'])
    expect(role.rules).toEqual({ bash: 'ask', git: 'deny' })
    expect(role.model).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' })
    expect(role.system).toBe('You migrate databases.')
  })

  it('has no way to express allow', () => {
    const cwd = projectWith({
      'greedy.md': ['---', 'name: greedy', 'tools: bash', 'allow: bash', '---', 'hi'].join('\n')
    })
    const role = collectSubagentRoles(cwd, TOOLS).find(r => r.name === 'greedy')!
    expect(role.rules).toEqual({})
  })

  it('lets deny win when a tool is listed in both ask and deny', () => {
    const cwd = projectWith({
      'both.md': ['---', 'name: both', 'ask: git', 'deny: git', '---', 'hi'].join('\n')
    })
    const role = collectSubagentRoles(cwd, TOOLS).find(r => r.name === 'both')!
    expect(role.rules.git).toBe('deny')
  })

  it('skips a file without a name and a malformed model', () => {
    const cwd = projectWith({
      'anon.md': ['---', 'description: no name', '---', 'hi'].join('\n'),
      'bad-model.md': ['---', 'name: bad-model', 'model: justamodel', '---', 'hi'].join('\n')
    })
    const roles = collectSubagentRoles(cwd, TOOLS)
    expect(roles.find(r => r.description === 'no name')).toBeUndefined()
    expect(roles.find(r => r.name === 'bad-model')!.model).toBeUndefined()
  })

  it('lets a project role override a built-in of the same name', () => {
    const cwd = projectWith({
      'research.md': ['---', 'name: research', 'tools: read', '---', 'Custom research.'].join('\n')
    })
    const roles = collectSubagentRoles(cwd, TOOLS)
    expect(roles.filter(r => r.name === 'research')).toHaveLength(1)
    expect(roles.find(r => r.name === 'research')!.system).toBe('Custom research.')
  })

  it('always includes the built-ins when no files exist', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'meow-roles-empty-'))
    expect(collectSubagentRoles(cwd, TOOLS).map(r => r.name).sort())
      .toEqual(['general', 'research', 'reviewer'])
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-subagent-roles.test.ts`
Expected: FAIL — module `subagent-roles` chưa tồn tại.

- [ ] **Step 3a: Export `parseFrontmatter`**

Trong `src/main/agent/skill.ts:11`, đổi `function parseFrontmatter(` thành `export function parseFrontmatter(`.

- [ ] **Step 3b: Tạo `src/main/agent/subagent-roles.ts`**

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { PermissionRule } from './config'
import type { SubagentRole } from './permission'
import { parseFrontmatter } from './skill'

export const BUILTIN_ROLES: SubagentRole[] = [
  {
    name: 'research',
    description: 'Read-only investigation',
    system:
      'You are a research subagent. Investigate and answer concisely. ' +
      'You cannot modify files.',
    tools: ['read', 'glob', 'grep', 'webfetch'],
    rules: {}
  },
  {
    name: 'general',
    description: 'Implements changes',
    system:
      'You are a general-purpose implementation subagent. Implement exactly what is asked: ' +
      'read relevant files first, make changes with write/edit/apply-patch, run tests with bash, ' +
      'commit with git when the task expects it. ' +
      'Return a concise report starting with one status line: DONE, DONE_WITH_CONCERNS, ' +
      'NEEDS_CONTEXT, or BLOCKED, then a summary of changes, test results, and any concerns.',
    tools: ['read', 'glob', 'grep', 'webfetch', 'write', 'edit', 'apply-patch', 'bash', 'git', 'skill'],
    rules: {}
  },
  {
    name: 'reviewer',
    description: 'Reviews a diff read-only',
    system:
      'You are a code review subagent. Inspect the requested changes (use git diff and read) for ' +
      'spec compliance and code quality. Return a verdict line APPROVED or CHANGES_REQUESTED, ' +
      'then a numbered list of findings with severity (Critical / Important / Minor).',
    tools: ['read', 'glob', 'grep', 'git', 'webfetch'],
    rules: {}
  }
]

function list(raw: string | undefined, known: ReadonlySet<string>): string[] {
  return (raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '' && known.has(s))
}

function parseModelRef(raw: string | undefined): { provider: string; model: string } | undefined {
  if (!raw) return undefined
  const i = raw.indexOf('/')
  if (i <= 0 || i === raw.length - 1) return undefined
  return { provider: raw.slice(0, i), model: raw.slice(i + 1) }
}

export function roleFromFile(file: string, knownTools: ReadonlySet<string>): SubagentRole | null {
  const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf-8'))
  if (!frontmatter.name) return null
  const rules: Record<string, PermissionRule> = {}
  // Order matters: a tool named in both lands on the stricter rule.
  for (const tool of list(frontmatter.ask, knownTools)) rules[tool] = 'ask'
  for (const tool of list(frontmatter.deny, knownTools)) rules[tool] = 'deny'
  const model = parseModelRef(frontmatter.model)
  return {
    name: frontmatter.name,
    description: frontmatter.description ?? '',
    system: body.trim(),
    tools: list(frontmatter.tools, knownTools),
    rules,
    ...(model ? { model } : {})
  }
}

export function collectSubagentRoles(
  cwd: string,
  knownTools: ReadonlySet<string>,
  userAgentsDir?: string
): SubagentRole[] {
  const dirs = [path.join(cwd, '.meow', 'agents')]
  if (userAgentsDir) dirs.push(userAgentsDir)
  const seen = new Set<string>()
  const out: SubagentRole[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const role = roleFromFile(path.join(dir, entry.name), knownTools)
      if (!role || seen.has(role.name)) continue
      seen.add(role.name)
      out.push(role)
    }
  }
  for (const role of BUILTIN_ROLES) {
    if (seen.has(role.name)) continue
    seen.add(role.name)
    out.push(role)
  }
  return out
}
```

- [ ] **Step 3c: Mở `SubagentType` thành string**

`src/shared/types.ts:332`, thay:

```ts
export type SubagentType = 'research' | 'general' | 'reviewer'
```

bằng:

```ts
export type SubagentType = string
export const BUILTIN_SUBAGENT_TYPES = ['research', 'general', 'reviewer'] as const
```

- [ ] **Step 3d: `normalizeSubagentModels` không lọc theo enum nữa**

`src/main/agent/config.ts`, xoá hằng `SUBAGENT_ROLES` và đổi vòng lặp:

```ts
function normalizeSubagentModels(
  raw: Partial<Record<SubagentType, ModelRef>> | undefined,
  providers: Record<string, MeowProviderConfig>
): Partial<Record<SubagentType, ModelRef>> | undefined {
  if (!raw) return undefined
  const out: Partial<Record<SubagentType, ModelRef>> = {}
  for (const [type, ref] of Object.entries(raw)) {
    if (!ref || !ref.provider || !ref.model) continue
    if (!ref.accountId) {
      const provider = providers[ref.provider]
      if (!provider || !provider.models.includes(ref.model)) continue
    }
    out[type] = {
      provider: ref.provider,
      model: ref.model,
      ...(ref.accountId ? { accountId: ref.accountId } : {})
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-subagent-roles.test.ts tests/unit/agent-config.test.ts`
Expected: PASS cả hai.

- [ ] **Step 5: Typecheck + commit**

`npm run typecheck` sẽ báo lỗi ở `src/main/agent/tools/task.ts` vì `SUBAGENT_CONFIGS` vẫn còn tự định nghĩa `SubagentType` cũ — Task 5 dọn. Tạm thời để `task.ts` nguyên trạng: `SubagentType` giờ là `string` nên `Record<SubagentType, SubagentConfig>` vẫn hợp lệ, và `z.enum` vẫn compile. Nếu typecheck vẫn đỏ, sửa đúng dòng bị báo rồi ghi lại lỗi vào report.

```bash
npm run typecheck
git add src/main/agent/subagent-roles.ts src/main/agent/skill.ts src/shared/types.ts src/main/agent/config.ts tests/unit/agent-subagent-roles.test.ts
git commit -m "feat(agent): discover subagent roles from .meow/agents"
```

---

### Task 4: `snapshotAgentId` để undo bắt được file subagent sửa

**Files:**
- Modify: `src/main/agent/tools/types.ts:14-30` (`ToolContext`)
- Modify: `src/main/agent/tools/snapshot-util.ts`
- Modify: `src/main/agent/loop.ts:17-62` (`LoopDeps`), `src/main/agent/loop.ts:266-276` (`toolCtx`)
- Test: `tests/unit/agent-snapshot.test.ts`

**Interfaces:**
- Produces: `ToolContext.snapshotAgentId?: string`, `LoopDeps.snapshotAgentId?: string`. `snapshotFile` ghi dưới `ctx.snapshotAgentId ?? ctx.agentId`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/unit/agent-snapshot.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { snapshotFile } from '../../src/main/agent/tools/snapshot-util'
import type { ToolContext } from '../../src/main/agent/tools/types'

describe('snapshotFile agent attribution', () => {
  it('records under snapshotAgentId when the caller is a subagent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'before')
    const recorded: Array<{ agentId: string; filePath: string }> = []
    const ctx = {
      cwd: dir,
      ask: async () => null,
      agentId: 'sub-general-123',
      snapshotAgentId: 'agent-parent',
      snapshots: {
        snapshot: (agentId: string, filePath: string) => recorded.push({ agentId, filePath })
      }
    } as unknown as ToolContext

    snapshotFile(ctx, file)

    expect(recorded).toEqual([{ agentId: 'agent-parent', filePath: file }])
  })

  it('falls back to agentId when snapshotAgentId is absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-snap-'))
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'before')
    const recorded: string[] = []
    const ctx = {
      cwd: dir,
      ask: async () => null,
      agentId: 'agent-parent',
      snapshots: { snapshot: (agentId: string) => recorded.push(agentId) }
    } as unknown as ToolContext

    snapshotFile(ctx, file)

    expect(recorded).toEqual(['agent-parent'])
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-snapshot.test.ts`
Expected: FAIL — test đầu ghi dưới `sub-general-123`.

- [ ] **Step 3: Implement**

`src/main/agent/tools/types.ts`, thêm vào `ToolContext` ngay dưới `agentId`:

```ts
  // Subagents run under their own agentId for tracing, but their file changes
  // belong to the parent's turn so undo/revert can reach them.
  snapshotAgentId?: string
```

`src/main/agent/tools/snapshot-util.ts`:

```ts
export function snapshotFile(ctx: ToolContext, filePath: string): void {
  const agentId = ctx.snapshotAgentId ?? ctx.agentId
  if (!ctx.snapshots || !agentId) return
  if (!existsSync(filePath)) return
  try {
    ctx.snapshots.snapshot(agentId, filePath, readFileSync(filePath, 'utf-8'))
  } catch {
    /* ignore snapshot errors */
  }
}
```

`src/main/agent/loop.ts`, thêm vào `LoopDeps` ngay dưới `snapshots?: SnapshotStore`:

```ts
  snapshotAgentId?: string
```

và trong `toolCtx` (`loop.ts:266-276`), ngay dưới `snapshots: this.deps.snapshots,`:

```ts
          snapshotAgentId: this.deps.snapshotAgentId,
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/tools/types.ts src/main/agent/tools/snapshot-util.ts src/main/agent/loop.ts tests/unit/agent-snapshot.test.ts
git commit -m "feat(agent): attribute subagent snapshots to the parent turn"
```

---

### Task 5: `task.ts` resolve role động và chặn theo mode

**Files:**
- Modify: `src/main/agent/tools/task.ts`
- Modify: `src/main/agent/permission.ts:20` (`PLAN_RULES.task`)
- Test: `tests/unit/agent-task.test.ts`, `tests/unit/agent-permission.test.ts`

**Interfaces:**
- Consumes: `collectSubagentRoles`, `BUILTIN_ROLES` (Task 3), `SubagentRole` (Task 2), `ToolPermissionContext` (Task 1).
- Produces: `createTaskTool` nhận thêm
  - `permission?: () => ToolPermissionContext` — context của cha, gọi mỗi lần nên luôn live; vắng mặt thì mặc định **cấm hết**.
  - `userAgentsDir?: string`
  - `roleNames?: string[]` — danh sách hiển thị trong description lúc registration.
  - `SUBAGENT_CONFIGS` bị xoá; `export type { SubagentType }` giữ nguyên.

- [ ] **Step 1: Viết test thất bại**

Thay khối `describe('task subagent configs')` trong `tests/unit/agent-task.test.ts` bằng:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BUILTIN_ROLES } from '../../src/main/agent/subagent-roles'
import type { ToolPermissionContext } from '../../src/main/agent/permission'

function allowAll(mode: 'build' | 'plan' = 'build'): () => ToolPermissionContext {
  return () => ({ mode, rules: { '*': 'allow' }, isSavedAllow: () => false, canPrompt: true })
}

describe('task subagent roles', () => {
  it('defines three built-in roles with expected tool sets', () => {
    expect(BUILTIN_ROLES.map(r => r.name).sort()).toEqual(['general', 'research', 'reviewer'])
  })

  it('runs a role defined by a project file', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'meow-task-'))
    mkdirSync(path.join(cwd, '.meow', 'agents'), { recursive: true })
    writeFileSync(
      path.join(cwd, '.meow', 'agents', 'auditor.md'),
      ['---', 'name: auditor', 'tools: read, grep', '---', 'You audit.'].join('\n')
    )
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')], ['grep', stubTool('grep')], ['bash', stubTool('bash')]]),
      permission: allowAll()
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'auditor' }, { cwd, ask: async () => null })
    expect(r.error).toBeUndefined()
    expect(llm.calls[0]?.system).toContain('You audit.')
    expect((llm.calls[0]?.tools ?? []).map(t => t.name).sort()).toEqual(['grep', 'read'])
  })

  it('rejects an unknown role and names the valid ones', async () => {
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll()
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'nope' }, { cwd: '/proj', ask: async () => null })
    expect(r.error).toContain('nope')
    expect(r.error).toContain('research')
  })

  it('lets plan mode reach the task tool at all', async () => {
    const { PLAN_RULES } = await import('../../src/main/agent/permission')
    expect(PLAN_RULES.task).toBe('allow')
  })

  it('allows only the read-only research role in plan mode', async () => {
    const tools = new Map([['read', stubTool('read')]])
    const research = createTaskTool({ llm: new StubLlm(), model: 'm', tools, permission: allowAll('plan') })
    const ok = await research.run({ prompt: 'x', subagent_type: 'research' }, { cwd: '/p', ask: async () => null })
    expect(ok.error).toBeUndefined()

    const general = createTaskTool({ llm: new StubLlm(), model: 'm', tools, permission: allowAll('plan') })
    const blocked = await general.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(blocked.error).toMatch(/plan mode/i)
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-task.test.ts`
Expected: FAIL — `permission` chưa phải option, role file chưa được đọc.

- [ ] **Step 3a: Mở `task` ở plan mode**

`src/main/agent/permission.ts:20`, trong `PLAN_RULES` đổi `task: 'deny'` thành:

```ts
  // The task tool itself is read-only; task.ts decides which roles may run in
  // plan mode, and the subagent inherits plan mode so its own writes stay denied.
  task: 'allow',
```

- [ ] **Step 3b: Implement `task.ts`**

Trong `src/main/agent/tools/task.ts`: xoá `SubagentConfig` và `SUBAGENT_CONFIGS`, thêm import và phần resolve.

```ts
import { collectSubagentRoles } from '../subagent-roles'
import { deriveSubagentContext, decide } from '../permission'
import type { SubagentRole, ToolPermissionContext } from '../permission'

// Nothing is permitted until a parent context says otherwise: a caller that
// forgets to wire permission gets a subagent that can do nothing, not one that
// can do everything.
const NO_PERMISSION: ToolPermissionContext = {
  mode: 'build',
  rules: {},
  isSavedAllow: () => false,
  canPrompt: false
}
```

Thêm vào `opts` của `createTaskTool`:

```ts
  permission?: () => ToolPermissionContext
  userAgentsDir?: string
  roleNames?: string[]
```

Thêm hàm resolve trong thân `createTaskTool`:

```ts
  const knownTools = new Set(opts.tools.keys())
  const resolveRole = (cwd: string, name: string): SubagentRole | { error: string } => {
    const roles = collectSubagentRoles(cwd, knownTools, opts.userAgentsDir)
    const role = roles.find(r => r.name === name)
    if (!role) {
      return { error: `task: unknown subagent_type "${name}". Available: ${roles.map(r => r.name).join(', ')}` }
    }
    const mode = (opts.permission?.() ?? NO_PERMISSION).mode
    if (mode === 'plan' && role.name !== 'research') {
      return { error: `task: only the read-only "research" subagent may run in plan mode (got "${name}")` }
    }
    return role
  }
```

`runSubagent` đổi sang chữ ký cố định sau — **mọi task sau đều dựa vào chữ ký này**, đừng đổi thêm:

```ts
  const runSubagent = async (
    input: { description?: string; prompt: string; role: SubagentRole },
    ctx: ToolContext,
    id: string,
    items: TranscriptItem[],
    background: boolean,
    signal?: AbortSignal
  ): Promise<SubagentResult> => {
```

Bên trong, xoá `const cfg = SUBAGENT_CONFIGS[input.subagent_type]`, dùng `const role = input.role` rồi thay `cfg.tools` / `cfg.system` bằng `role.tools` / `role.system`. Model của role thắng `resolveSubagent`:

```ts
    const sub = opts.resolveSubagent?.(role.name)
    const model = role.model?.model ?? sub?.model ?? opts.model
```

Truyền `model` (thay `sub?.model ?? opts.model`) vào `SessionRunner`, và đổi `agentId` thành
`` `sub-${role.name}-${id}` ``.

Trong `run()`, resolve role trước khi làm bất cứ việc gì khác, và cập nhật cả hai call site
(foreground và background) sang chữ ký mới:

```ts
      const resolved = resolveRole(ctx.cwd, subagent_type)
      if ('error' in resolved) return { error: resolved.error }
      const role = resolved
```

Call site foreground:

```ts
      ctx.emitSubagent?.(id, { sub: 'start', subagentType: role.name })
      const result = await runSubagent({ description, prompt, role }, ctx, id, items, false, ctx.signal)
```

Đổi schema:

```ts
      subagent_type: z.string().default('research')
        .describe(`The subagent role to use. Available: ${(opts.roleNames ?? ['research', 'general', 'reviewer']).join(', ')}`),
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-task.test.ts tests/unit/agent-task-tool.test.ts`
Expected: PASS. `agent-task-tool.test.ts` có thể phải thêm `permission: allowAll()` vào các case gọi tool — sửa tại chỗ.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/tools/task.ts tests/unit/agent-task.test.ts tests/unit/agent-task-tool.test.ts
git commit -m "feat(task): resolve subagent roles dynamically and gate plan mode"
```

---

### Task 6: `task.ts` dùng permission dẫn xuất và bubble prompt

**Files:**
- Modify: `src/main/agent/tools/task.ts`
- Modify: `src/shared/types.ts:189-191` (`prompt-request` thêm `taskId`, `subagentType`)
- Test: `tests/unit/agent-task-tool.test.ts`

**Interfaces:**
- Consumes: `decide`, `deriveSubagentContext` (Task 1, 2), `resolveRole` (Task 5).
- Produces: `createTaskTool` nhận thêm
  - `ask?: (promptId: string, tool?: string) => Promise<PromptResponse | null>`
  - `onPromptRequest?: (e: Extract<ChatEvent, { type: 'prompt-request' }>, meta: { taskId: string; subagentType: string }) => void`

- [ ] **Step 1: Viết test thất bại**

Thêm vào đầu `tests/unit/agent-task-tool.test.ts` (file này chưa có các import đó):

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ToolPermissionContext } from '../../src/main/agent/permission'

function allowAll(mode: 'build' | 'plan' = 'build'): () => ToolPermissionContext {
  return () => ({ mode, rules: { '*': 'allow' }, isSavedAllow: () => false, canPrompt: true })
}

// LlmStreamPart carries a tool call as toolName/toolCallId/toolInput (see llm.ts:11).
class ToolCallingLlm implements LlmClient {
  private called = false
  constructor(private toolName: string, private toolInput: Record<string, unknown> = {}) {}
  async *stream(): AsyncGenerator<LlmStreamPart> {
    if (!this.called) {
      this.called = true
      yield { kind: 'tool-call', toolCallId: 't1', toolName: this.toolName, toolInput: this.toolInput }
      yield { kind: 'finish' }
      return
    }
    yield { kind: 'text', text: 'finished' }
    yield { kind: 'finish' }
  }
}
```

Rồi thêm khối test:

```ts
describe('subagent permission', () => {
  it('denies a tool the parent denies, even though the subagent has it', async () => {
    const ran: string[] = []
    const git: ToolDefinition = {
      name: 'git', description: 'git', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('git'); return { output: 'ok' } }
    }
    const task = createTaskTool({
      llm: new ToolCallingLlm('git'),
      model: 'm',
      tools: new Map([['git', git], ['read', stubTool('read')]]),
      permission: () => ({ mode: 'build', rules: { git: 'deny' }, isSavedAllow: () => false, canPrompt: true })
    })
    await task.run({ prompt: 'x', subagent_type: 'reviewer' }, { cwd: '/p', ask: async () => null })
    expect(ran).toEqual([])
  })

  it('bubbles an ask to the parent and runs the tool once allowed', async () => {
    const ran: string[] = []
    const bash: ToolDefinition = {
      name: 'bash', description: 'bash', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('bash'); return { output: 'ok' } }
    }
    const prompts: Array<{ taskId: string; subagentType: string }> = []
    const task = createTaskTool({
      llm: new ToolCallingLlm('bash', { command: 'ls' }),
      model: 'm',
      tools: new Map([['bash', bash]]),
      permission: () => ({ mode: 'build', rules: { bash: 'ask' }, isSavedAllow: () => false, canPrompt: true }),
      ask: async () => ({ allow: true }),
      onPromptRequest: (_e, meta) => prompts.push(meta)
    })
    await task.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(ran).toEqual(['bash'])
    expect(prompts[0]?.subagentType).toBe('general')
    expect(prompts[0]?.taskId).toBeTruthy()
  })

  it('denies rather than hanging when a background subagent needs to ask', async () => {
    const ran: string[] = []
    const bash: ToolDefinition = {
      name: 'bash', description: 'bash', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('bash'); return { output: 'ok' } }
    }
    let finished = false
    const task = createTaskTool({
      llm: new ToolCallingLlm('bash', { command: 'ls' }),
      model: 'm',
      tools: new Map([['bash', bash]]),
      permission: () => ({ mode: 'build', rules: { bash: 'ask' }, isSavedAllow: () => false, canPrompt: true }),
      ask: async () => ({ allow: true }),
      onBackgroundResult: () => { finished = true }
    })
    await task.run({ prompt: 'x', subagent_type: 'general', background: true }, { cwd: '/p', ask: async () => null })
    await new Promise(r => setTimeout(r, 20))
    expect(ran).toEqual([])
    expect(finished).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts`
Expected: FAIL — subagent hiện allow mọi thứ nên `ran` có `'git'`.

- [ ] **Step 3a: Mở rộng event**

`src/shared/types.ts:189-191`:

```ts
  | { type: 'prompt-request'; agentId: string; promptId: string
      kind: 'permission' | 'question'; call?: ToolCallData; question?: string
      options?: QuestionOption[]; multiple?: boolean; custom?: boolean
      taskId?: string; subagentType?: string }
```

- [ ] **Step 3b: Nối permission vào runner con**

Trong `runSubagent` của `task.ts`, thay hai dòng cấu hình runner:

```ts
      decidePermission: () => 'allow',
      ask: async () => null,
```

bằng:

```ts
      decidePermission: (tool, toolInput) => decide(
        deriveSubagentContext(opts.permission?.() ?? NO_PERMISSION, role, { background }),
        tool,
        toolInput
      ),
      ask: opts.ask ?? (async () => null),
```

`runSubagent` nhận thêm tham số `background: boolean`. Context được derive **mỗi lần gọi** để mode/rule đổi giữa chừng là ăn theo ngay.

Trong `onEvent` của runner con, thêm nhánh chuyển tiếp prompt:

```ts
        } else if (e.type === 'prompt-request') {
          opts.onPromptRequest?.(e, { taskId: id, subagentType: role.name })
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts tests/unit/agent-task.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/tools/task.ts src/shared/types.ts tests/unit/agent-task-tool.test.ts
git commit -m "feat(task): run subagents under a derived permission context"
```

---

### Task 7: Snapshot cho subagent và lọc `todowrite`

**Files:**
- Modify: `src/main/agent/tools/task.ts`
- Test: `tests/unit/agent-task-tool.test.ts`

**Interfaces:**
- Consumes: `LoopDeps.snapshotAgentId` (Task 4).
- Produces: `createTaskTool` nhận thêm `snapshots?: SnapshotStore` và `parentAgentId?: string`.

`todowrite` bị loại khỏi `safeTools` bất kể role khai gì: runner con không nhận `setTodos`, nên tool này hiện báo thành công rồi nuốt dữ liệu.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('subagent snapshots and todo filtering', () => {
  it('never hands todowrite to a subagent', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'meow-task-todo-'))
    mkdirSync(path.join(cwd, '.meow', 'agents'), { recursive: true })
    writeFileSync(
      path.join(cwd, '.meow', 'agents', 'planner.md'),
      ['---', 'name: planner', 'tools: read, todowrite', '---', 'You plan.'].join('\n')
    )
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')], ['todowrite', stubTool('todowrite')]]),
      permission: allowAll()
    })
    await task.run({ prompt: 'x', subagent_type: 'planner' }, { cwd, ask: async () => null })
    expect((llm.calls[0]?.tools ?? []).map(t => t.name)).toEqual(['read'])
  })

  it('passes the parent snapshot store and agent id to the subagent runner', async () => {
    const seen: Array<Record<string, unknown>> = []
    const probe: ToolDefinition = {
      name: 'write', description: 'write', schema: { parse: () => ({}) } as never,
      run: async (_input, ctx) => {
        seen.push({ snapshotAgentId: ctx.snapshotAgentId, hasStore: Boolean(ctx.snapshots) })
        return { output: 'ok' }
      }
    }
    const task = createTaskTool({
      llm: new ToolCallingLlm('write'),
      model: 'm',
      tools: new Map([['write', probe]]),
      permission: allowAll(),
      snapshots: { snapshot: () => {} } as never,
      parentAgentId: 'agent-parent'
    })
    await task.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(seen[0]).toEqual({ snapshotAgentId: 'agent-parent', hasStore: true })
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts`
Expected: FAIL — `todowrite` lọt vào tool set, `snapshotAgentId` undefined.

- [ ] **Step 3: Implement**

Thêm vào `opts` của `createTaskTool`:

```ts
  snapshots?: SnapshotStore
  parentAgentId?: string
```

(kèm `import type { SnapshotStore } from '../snapshot'`)

Trong `runSubagent`, khi dựng `safeTools`:

```ts
    const safeTools = new Map<string, ToolDefinition>()
    for (const name of role.tools) {
      // A subagent runner has no setTodos sink, so todowrite would silently
      // swallow whatever it is given.
      if (name === 'todowrite') continue
      const def = opts.tools.get(name)
      if (def) safeTools.set(name, def)
    }
```

và thêm vào cấu hình `SessionRunner`:

```ts
      snapshots: opts.snapshots,
      snapshotAgentId: opts.parentAgentId,
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/tools/task.ts tests/unit/agent-task-tool.test.ts
git commit -m "fix(task): snapshot subagent edits and drop the dead todowrite"
```

---

### Task 8: `subagentMaxSteps` và báo cáo `incomplete`

**Files:**
- Modify: `src/main/agent/config.ts:47-57` (`MeowConfig`), `:120-144` (`DEFAULT_MEOW_CONFIG`), `:287-292` (`mergeDefaults`)
- Modify: `src/main/agent/tools/task.ts`
- Test: `tests/unit/agent-task-tool.test.ts`, `tests/unit/agent-config.test.ts`

**Interfaces:**
- Produces: `MeowConfig.subagentMaxSteps: number` (mặc định 30); `createTaskTool` nhận `maxSteps?: number`; output của task mang `state="incomplete" reason="max-steps"` khi runner con dừng vì hết bước hoặc bị provider cắt.

- [ ] **Step 1: Viết test thất bại**

`tests/unit/agent-config.test.ts`:

```ts
it('defaults subagentMaxSteps to 30', () => {
  expect(DEFAULT_MEOW_CONFIG.subagentMaxSteps).toBe(30)
})
```

`tests/unit/agent-task-tool.test.ts`:

```ts
// Always calls a tool, so the loop only stops when it runs out of steps. On the
// final step the runner strips tools, so this yields text for that pass too.
class NeverFinishingLlm implements LlmClient {
  async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
    if ((opts.tools ?? []).length === 0) {
      yield { kind: 'text', text: 'partial progress' }
      yield { kind: 'finish' }
      return
    }
    yield { kind: 'tool-call', toolCallId: 't', toolName: 'read', toolInput: {} }
    yield { kind: 'finish' }
  }
}

it('reports an incomplete task when the subagent runs out of steps', async () => {
  const task = createTaskTool({
    llm: new NeverFinishingLlm(),
    model: 'm',
    tools: new Map([['read', stubTool('read')]]),
    permission: allowAll(),
    maxSteps: 2
  })
  const r = await task.run({ prompt: 'x', subagent_type: 'research' }, { cwd: '/p', ask: async () => null })
  expect(r.output).toContain('state="incomplete"')
  expect(r.output).toContain('reason="max-steps"')
  expect(r.output).toContain('partial progress')
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts tests/unit/agent-config.test.ts`
Expected: FAIL — output đang luôn là `state="completed"`, config chưa có `subagentMaxSteps`.

- [ ] **Step 3a: Config**

`src/main/agent/config.ts` — thêm vào interface `MeowConfig` dưới `maxSteps: number`:

```ts
  subagentMaxSteps: number
```

thêm vào `DEFAULT_MEOW_CONFIG` dưới `maxSteps: DEFAULT_MAX_STEPS,`:

```ts
  subagentMaxSteps: DEFAULT_SUBAGENT_MAX_STEPS,
```

thêm hằng cạnh `DEFAULT_MAX_STEPS`:

```ts
export const DEFAULT_SUBAGENT_MAX_STEPS = 30
```

và trong `mergeDefaults` dưới dòng `maxSteps:`:

```ts
    subagentMaxSteps: raw.subagentMaxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS,
```

- [ ] **Step 3b: task.ts**

Đổi `const DEFAULT_MAX_SESSIONS = 20` giữ nguyên; thêm `maxSteps?: number` vào `opts` và dùng:

```ts
      maxSteps: opts.maxSteps ?? 30,
```

Bắt lý do dừng. Trong `runSubagent`, khai báo trước `onEvent`:

```ts
    let stopReason: string | undefined
```

trong nhánh `done` của `onEvent`, thêm dòng đầu:

```ts
        } else if (e.type === 'done') {
          stopReason = e.reason
```

đổi kiểu trả về `SubagentResult` thành `{ text: string; error?: string; incomplete?: string }` và cuối `runSubagent`:

```ts
    if (!text) return { text: '', error: 'task: subagent produced no answer' }
    const incomplete = stopReason === 'max-steps' || stopReason === 'length' ? stopReason : undefined
    return { text, ...(incomplete ? { incomplete } : {}) }
```

`renderOutput` nhận thêm lý do:

```ts
function renderOutput(input: { id: string; description: string; text: string; incomplete?: string }): string {
  const state = input.incomplete
    ? `state="incomplete" reason="${input.incomplete}"`
    : 'state="completed"'
  return [`<task id="${input.id}" ${state}>`, input.text, `</task>`].join('\n')
}
```

và call site trong `run()` truyền `incomplete: result.incomplete`.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts tests/unit/agent-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/config.ts src/main/agent/tools/task.ts tests/unit/agent-task-tool.test.ts tests/unit/agent-config.test.ts
git commit -m "feat(task): configurable subagent step budget and honest incomplete reports"
```

---

### Task 9: Task nền có tay cầm huỷ và nhớ session của mình

**Files:**
- Modify: `src/main/agent/tools/task.ts`
- Test: `tests/unit/agent-task-tool.test.ts`

**Interfaces:**
- Produces: `createTaskTool` nhận `onBackgroundStart?: (taskId: string, cancel: () => void) => void`. Nhánh background dùng `AbortController` riêng, nối với `ctx.signal` của lượt cha, và emit `done` kèm `parentTaskId`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('background subagent lifecycle', () => {
  it('hands the caller a cancel handle that stops the run', async () => {
    let cancel: (() => void) | undefined
    let result: { text: string; error?: string } | undefined
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      onBackgroundStart: (_id, c) => { cancel = c },
      onBackgroundResult: (_id, text, error) => { result = { text, error } }
    })
    await task.run({ prompt: 'x', subagent_type: 'research', background: true }, { cwd: '/p', ask: async () => null })
    expect(typeof cancel).toBe('function')
    cancel!()
    await new Promise(r => setTimeout(r, 20))
    expect(result).toBeDefined()
  })

  it('emits the background done event with the parent task id', async () => {
    const events: Array<{ sub: string; parentTaskId?: string }> = []
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      onBackgroundResult: () => {}
    })
    await task.run(
      { prompt: 'x', subagent_type: 'research', background: true },
      { cwd: '/p', ask: async () => null, taskId: 'parent-task', emitSubagent: (_id, e) => events.push(e) }
    )
    await new Promise(r => setTimeout(r, 20))
    const done = events.find(e => e.sub === 'done')
    expect(done?.parentTaskId).toBe('parent-task')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts`
Expected: FAIL — chưa có `onBackgroundStart`, `done` của nhánh background thiếu `parentTaskId`.

- [ ] **Step 3: Implement**

Thêm vào `opts`:

```ts
  onBackgroundStart?: (taskId: string, cancel: () => void) => void
```

Thay nhánh `if (background)` trong `run()`:

```ts
      if (background) {
        // The turn's controller is dropped when the turn ends, so a background
        // subagent needs its own handle or nothing can stop it afterwards.
        const controller = new AbortController()
        const onParentAbort = () => controller.abort()
        ctx.signal?.addEventListener('abort', onParentAbort, { once: true })
        opts.onBackgroundStart?.(id, () => controller.abort())
        ctx.emitSubagent?.(id, { sub: 'start', subagentType: role.name, background: true, parentTaskId: ctx.taskId })
        void runSubagent({ description, prompt, role }, ctx, id, items, true, controller.signal)
          .then(
            (result) => {
              if (result.text) {
                ctx.emitSubagent?.(id, { sub: 'done', state: 'completed', result: result.text, parentTaskId: ctx.taskId })
                opts.onBackgroundResult?.(id, result.text)
              } else {
                ctx.emitSubagent?.(id, { sub: 'done', state: 'error', parentTaskId: ctx.taskId })
                opts.onBackgroundResult?.(id, '', result.error)
              }
            },
            (err) => {
              ctx.emitSubagent?.(id, { sub: 'done', state: 'error', parentTaskId: ctx.taskId })
              opts.onBackgroundResult?.(id, '', String(err))
            }
          )
          .finally(() => ctx.signal?.removeEventListener('abort', onParentAbort))
        return { output: `Subagent ${id} (${role.name}) running in background.`, background: true }
      }
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/unit/agent-task-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/agent/tools/task.ts tests/unit/agent-task-tool.test.ts
git commit -m "fix(task): give background subagents a cancel handle"
```

---

### Task 10: Nối tất cả vào `meow-agent-manager`

**Files:**
- Modify: `src/main/meow-agent-manager.ts:919-990` (dựng `taskTool`), `:929-957` (`reportUsage`), `:459-464` (`stop`), `:473` (`stopAll`)
- Test: `tests/unit/meow-agent-manager.test.ts`

**Interfaces:**
- Consumes: mọi option mới của `createTaskTool` từ Task 5-9.
- Produces: subagent chạy đúng permission của user, cost tính theo model thật, task nền huỷ được và trả kết quả về đúng session.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/unit/meow-agent-manager.test.ts` (dùng đúng helper dựng manager đã có trong file):

Trước hết mở `makeManager` cho phép chỉnh giá — hiện `prices` bị hardcode ở dòng khởi tạo manager.
Thêm `prices?: Record<string, { input: number; output: number }>` vào tham số `opts` của
`makeManager` và đổi dòng truyền xuống thành:

```ts
    prices: opts.prices ?? { 'test/test-model': { input: 1, output: 2 } },
```

Rồi thêm khối test:

```ts
describe('MeowAgentManager subagents', () => {
  function configWithSubagentModel(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-sub-'))
    const file = path.join(dir, 'meow.json')
    writeFileSync(file, JSON.stringify({
      provider: {
        test: { apiKey: 'sk-test', models: ['test-model'] },
        cheap: { apiKey: 'sk-cheap', models: ['cheap-model'] }
      },
      model: 'test',
      permission: { task: 'allow', read: 'allow' },
      subagentModels: { research: { provider: 'cheap', model: 'cheap-model' } }
    }))
    return file
  }

  const spawnResearch = (background: boolean): LlmStreamPart[] => ([
    {
      kind: 'tool-call',
      toolCallId: 't1',
      toolName: 'task',
      toolInput: { prompt: 'look around', subagent_type: 'research', ...(background ? { background: true } : {}) }
    },
    { kind: 'finish' }
  ])

  it('prices subagent usage with the subagent model, not the parent model', async () => {
    const { manager, events } = await makeManager({
      configPath: configWithSubagentModel(),
      prices: {
        'test/test-model': { input: 1000, output: 1000 },
        'cheap/cheap-model': { input: 1, output: 1 }
      },
      partsQueue: [
        spawnResearch(false),
        // The subagent's own call: cheap model, non-trivial usage.
        [{ kind: 'text', text: 'sub answer' }, { kind: 'finish', tokens: { input: 1000, output: 1000 } }],
        [{ kind: 'text', text: 'parent done' }, { kind: 'finish', tokens: { input: 0, output: 0 } }]
      ]
    })

    await manager.send('a1', 'go')

    const costs = events.filter(e => e.type === 'usage').map(e => e.sessionCost)
    const total = costs[costs.length - 1] ?? 0
    // Priced with the parent model this would be ~1000x larger.
    expect(total).toBeLessThan(1)
  })

  it('cancels a background subagent started in an earlier turn', async () => {
    const { manager, store } = await makeManager({
      configPath: configWithSubagentModel(),
      partsQueue: [
        spawnResearch(true),
        [{ kind: 'text', text: 'parent done' }, { kind: 'finish' }]
      ],
      hangUntilAbort: false
    })

    await manager.send('a1', 'go')
    // Turn 1 is over; its controller is gone. Stop must still reach the task.
    manager.stop('a1')
    await new Promise(r => setTimeout(r, 30))

    expect(store).toBeDefined()
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('delivers a background result to the session that spawned it', async () => {
    const { manager } = await makeManager({
      configPath: configWithSubagentModel(),
      partsQueue: [
        spawnResearch(true),
        [{ kind: 'text', text: 'parent done' }, { kind: 'finish' }],
        [{ kind: 'text', text: 'background answer' }, { kind: 'finish' }]
      ]
    })

    await manager.send('a1', 'go')
    const spawned = manager.listSessions('a1')[0]
    manager.newSession('a1')
    await new Promise(r => setTimeout(r, 30))

    const spawnedText = manager.listMessages('a1', spawned.id).map(m => m.text).join('\n')
    const currentText = manager.listMessages('a1').map(m => m.text).join('\n')
    expect(spawnedText).toContain('background answer')
    expect(currentText).not.toContain('background answer')
  })
})
```

**Nếu `listMessages` không nhận `sessionId`**, đọc trực tiếp qua `store.get(spawned.id)!.items` thay
vì thêm tham số vào production API chỉ để test. Nếu ba test này lộ ra rằng manager chưa spawn được
task tool trong môi trường test (ví dụ `createDefaultTools()` không có `task`), thêm helper dựng tool
map trong chính file test — **không** nới production code cho dễ test.

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: FAIL cả ba.

- [ ] **Step 3a: Context của cha + cost + các option mới**

Trong `register()`, ngay trước `const taskTool = createTaskTool({`:

```ts
    // Rebuilt on every call so a mode switch or a newly saved always-allow
    // reaches a subagent already running.
    const parentPermission = (): ToolPermissionContext => ({
      mode: this.modes.get(agent.id) ?? 'build',
      rules: cfg.permission,
      isSavedAllow: (tool) => this.deps.savedPermissions.isAllowed(agent.cwd, tool),
      canPrompt: true
    })
```

Đổi `reportUsage` để nhận model thật:

```ts
    const reportUsage = (
      tokens: MessageTokens,
      isMainContext: boolean,
      used?: { provider: string; model: string }
    ): void => {
      const price = this.priceFor(used?.provider ?? resolved.provider, used?.model ?? resolved.model)
      ...
```

Bổ sung option cho `createTaskTool`:

```ts
      permission: parentPermission,
      ask: (promptId, tool) => this.awaitPrompt(agent.id, promptId, tool),
      onPromptRequest: (e, meta) => this.emit({ ...e, agentId: agent.id, taskId: meta.taskId, subagentType: meta.subagentType }),
      snapshots: this.deps.snapshots,
      parentAgentId: agent.id,
      userAgentsDir: this.deps.userAgentsDir,
      roleNames: collectSubagentRoles(agent.cwd, new Set(this.tools.keys()), this.deps.userAgentsDir).map(r => r.name),
      maxSteps: cfg.subagentMaxSteps,
      onUsage: (tokens, used) => reportUsage(tokens, false, used),
```

`deps.userAgentsDir?: string` thêm vào interface deps của manager, cạnh `userSkillsDir`; nơi khởi tạo manager truyền `path.join(userData, 'agents')`.

- [ ] **Step 3b: Model thật báo về từ `task.ts`**

Trong `task.ts`, `onUsage` đổi chữ ký:

```ts
  onUsage?: (tokens: MessageTokens, used?: { provider: string; model: string }) => void
```

và trong `runSubagent`, truyền cho `SessionRunner`. Khi role không có model riêng và
`resolveSubagent` cũng không trả gì, truyền `undefined` để manager rơi về giá của cha:

```ts
      onUsage: (tokens) => opts.onUsage?.(
        tokens,
        role.model
          ? { provider: role.model.provider, model }
          : sub ? { provider: sub.provider, model } : undefined
      ),
```

- [ ] **Step 3c: Vòng đời task nền**

Thêm field:

```ts
  private backgroundTasks = new Map<string, Map<string, { sessionId: string; cancel: () => void }>>()
```

Option cho `createTaskTool`:

```ts
      onBackgroundStart: (taskId, cancel) => {
        const forAgent = this.backgroundTasks.get(agent.id) ?? new Map()
        forAgent.set(taskId, { sessionId: this.activeSessionId(agent.id), cancel })
        this.backgroundTasks.set(agent.id, forAgent)
      },
```

`onBackgroundResult` dùng session đã chụp:

```ts
      onBackgroundResult: (taskId, text, error) => {
        const entry = this.backgroundTasks.get(agent.id)?.get(taskId)
        this.backgroundTasks.get(agent.id)?.delete(taskId)
        const sessionId = entry?.sessionId ?? this.activeSessionId(agent.id)
        ...
```

`stop()` huỷ luôn task nền:

```ts
  stop(agentId: string): void {
    this.controllers.get(agentId)?.abort()
    this.controllers.delete(agentId)
    for (const entry of this.backgroundTasks.get(agentId)?.values() ?? []) entry.cancel()
    this.backgroundTasks.delete(agentId)
    this.running.delete(agentId)
    this.resolvePendingFor(agentId, null)
  }
```

`stopAll()` phải quét cả hai map:

```ts
  stopAll(): void {
    const ids = new Set([...this.controllers.keys(), ...this.backgroundTasks.keys()])
    for (const id of ids) this.stop(id)
  }
```

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS, đúng 10 fail sẵn có của `officecli-binary-manager.test.ts`, không hơn.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/meow-agent-manager.ts src/main/agent/tools/task.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat(agent): wire subagent permission, cost and background lifecycle"
```

---

### Task 11: Docs sync và cổng hoàn thành

**Files:**
- Modify: `src/main/agent/tools/AGENTS.md` (dòng `task.ts`)
- Modify: `src/main/agent/AGENTS.md`
- Modify: `AGENTS.md` (gốc)

**Interfaces:**
- Consumes: hành vi cuối cùng từ Task 1-10.

Luật sync trong `AGENTS.md` gốc bắt buộc cập nhật khi business logic hoặc file structure đổi — task này là phần bắt buộc đó, không phải tuỳ chọn.

- [ ] **Step 1: `src/main/agent/tools/AGENTS.md`**

Thay dòng `task.ts` trong bảng Key files:

```
| `task.ts` | Spawn a subagent (`createTaskTool`). Runs under a permission context derived from the parent (narrow-only), bubbles `ask` decisions to the parent UI, denies them when running in background, snapshots its edits under the parent's agent id, and reports `state="incomplete"` when it runs out of steps. |
```

Thêm vào mục Conventions:

```
- Subagents never receive `todowrite`: their runner has no `setTodos` sink.
- A subagent may only be given tools that already exist in the map passed to `createTaskTool`; `task` is not in that map, so subagents cannot nest.
```

- [ ] **Step 2: `src/main/agent/AGENTS.md`**

Thêm mục mô tả `permission.ts` (`ToolPermissionContext`, `decide`, `deriveSubagentContext`) và `subagent-roles.ts` (discovery `.meow/agents` → user dir → built-in, first-wins theo tên, frontmatter chỉ siết được quyền).

- [ ] **Step 3: `AGENTS.md` gốc**

Thêm vào mục Conventions:

```
- Custom subagent roles live in `.meow/agents/*.md` (project) or `userData/agents/*.md` (user);
  frontmatter takes `name`, `description`, `tools`, `model`, `deny`, `ask`. There is no `allow` key —
  a role file can only narrow what the user's own permission rules already grant.
```

- [ ] **Step 4: Cổng hoàn thành**

```bash
npm run typecheck
npm test
npm run build && npm run e2e
```

Expected: typecheck xanh; `npm test` đúng 10 fail sẵn có; e2e xanh. Nếu e2e đỏ, dừng lại và báo cáo — không sửa test cho qua.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md src/main/agent/AGENTS.md src/main/agent/tools/AGENTS.md
git commit -m "docs(agent): document derived subagent permissions and role files"
```

---

## Ghi chú cho người thực thi

- **Thứ tự bắt buộc.** Task 1-2 là hàm thuần không phụ thuộc gì; Task 3 mở `SubagentType` thành `string` nên phải xong trước Task 5. Task 5-9 đều sửa `task.ts`, làm tuần tự để tránh xung đột. Task 10 chỉ chạy được khi 1-9 xong.
- **Mặc định cấm.** Nếu một call site quên truyền `permission`, subagent rơi về `NO_PERMISSION` và không làm được gì. Đó là hướng hỏng đúng — đừng "sửa" bằng cách đổi default thành cho phép.
- **Baseline test.** 10 fail của `officecli-binary-manager.test.ts` là có sẵn trên máy này (có `officecli` trên PATH). Đếm đúng 10; 11 trở lên là hồi quy do bạn gây ra.
