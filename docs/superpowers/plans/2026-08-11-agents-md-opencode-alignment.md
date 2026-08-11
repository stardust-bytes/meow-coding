# Align AGENTS.md handling with opencode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make meow's AGENTS.md handling match opencode: system prompt embeds only global + single-type project AGENTS.md; nearby AGENTS.md attaches inline into the `read` tool output as a `<system-reminder>` (deduped cross-message, `read`-only); base prompt encourages search tools.

**Architecture:** Rework `instructions.ts` loading rules, move attach-on-read from a synthesized user message in `loop.ts` into the `read` tool output via a changed `ToolContext.onFileRead` contract, wire `systemInstructionPaths` from the manager into `SessionRunner`, and extend the default system prompt with opencode's search-tools sentence.

**Tech Stack:** TypeScript (strict), Electron main process, Vitest (node env), Playwright e2e.

## Global Constraints

- All code in English; no throwaway comments (AGENTS.md convention — only comment complex decisions like Windows shim/tree-kill).
- No hardcoded IPC channels; use `Channels` from `src/shared/ipc.ts` (not touched by this plan).
- `src/shared` must not import Node/Electron (no shared changes in this plan).
- Test gate: `npm run typecheck` + `npm test` must pass after every task; `npm run build && npm run e2e` after the final task.
- Commit after each task with a descriptive message (conventional prefix: `feat`/`fix`/`refactor`/`test`).
- Follow existing patterns: read tools are plain `ToolDefinition` objects; `walkUp` stops at git root or home; tests use `mkdtempSync` temp dirs with `git init` to bound walks.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main/agent/instructions.ts` | Instruction-file discovery + formatting | `loadInstructions(cwd)` drops `userDataDir`, adds global home-dir file + single-type project priority; `instructionFilesForFile(filePath, skip?)` becomes per-dir first-match (AGENTS.md > CLAUDE.md) with skip set; add `globalInstructionFiles(homeDir?)` helper |
| `src/main/agent/tools/types.ts` | ToolContext contract | `onFileRead?(filePath: string): string` — returns reminder text to append ('' when none/attached) |
| `src/main/agent/loop.ts` | SessionRunner turn loop | Remove `readFiles` + `attachInstructions()`; add `attachedInstructions` set (cross-message dedupe) + `systemInstructionPaths` from deps; `toolCtx.onFileRead` returns `<system-reminder>` text |
| `src/main/agent/tools/read.ts` | Read file tool | Call `ctx.onFileRead?.(full)`, append returned text to output |
| `src/main/agent/tools/edit.ts` | Edit file tool | Remove `ctx.onFileRead?.(full)` (read-only trigger) |
| `src/main/meow-agent-manager.ts` | Agent registry + SessionRunner wiring | `loadInstructions(agent.cwd)` (no userDataDir); pass `systemInstructionPaths` into SessionRunner deps; remove `userInstructionsDir` from deps |
| `src/main/index.ts` | App bootstrap | Remove `userInstructionsDir: app.getPath('userData')` |
| `src/main/agent/config.ts` | Default config | Append opencode search-tools sentence to `DEFAULT_MEOW_CONFIG.agents.meow.systemPrompt` |
| `tests/unit/agent-instructions.test.ts` | instructions.ts tests | Rewrite: single-type priority, global home-dir helper, instructionFilesForFile skip/per-dir |
| `tests/unit/agent-loop.test.ts` | SessionRunner tests | Rewrite attach tests: reminder lives in tool output, cross-message dedupe |
| `tests/unit/agent-tools.test.ts` | Tool tests | Add read-reminder + edit-no-call tests |
| `tests/unit/agent-config.test.ts` | Config tests | Add `toMatch(/search tools/i)` |

Kept unchanged (per spec 3d): `references.ts` `@AGENTS.md` expansion (content like `@file` when chat), `commands.ts` `SUPERPOWERS_COMMANDS` templates, `src/main/agent/tools/task.ts` subagent runner (optional `systemInstructionPaths` absent → empty skip, fine).

---

## Task 1: Rework `instructions.ts` — global home file + single-type project priority

### Step 1: Write/update tests

Rewrite `tests/unit/agent-instructions.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { instructionsText, loadInstructions, instructionFilesForFile, globalInstructionFiles } from '../../src/main/agent/instructions'

let root: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meow-inst-'))
  cwd = path.join(root, 'repo', 'src')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('loadInstructions', () => {
  it('prefers AGENTS.md over CLAUDE.md along the walk-up path', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Claude ignored')
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outer rules (should be excluded)')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'src', 'AGENTS.md'))
    expect(names).toContain(path.join('repo', 'AGENTS.md'))
    expect(names).not.toContain(path.join('repo', 'src', 'CLAUDE.md'))
    expect(names).not.toContain(path.join('AGENTS.md'))
  })

  it('collects CLAUDE.md only when no AGENTS.md exists anywhere on the path', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'CLAUDE.md'), '# Repo claude')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Src claude')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'src', 'CLAUDE.md'))
    expect(names).toContain(path.join('repo', 'CLAUDE.md'))
    expect(names).not.toContain(path.join('repo', 'src', 'AGENTS.md'))
  })

  it('stops at the git root when the repo has .git', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo')
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outside repo')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'AGENTS.md'))
    expect(names).not.toContain(path.join('AGENTS.md'))
  })

  it('formats instruction text', () => {
    expect(instructionsText([])).toBe('')
    const text = instructionsText([{ path: '/x/AGENTS.md', content: 'rules' }])
    expect(text).toContain('Instructions from: /x/AGENTS.md')
    expect(text).toContain('rules')
  })
})

describe('globalInstructionFiles', () => {
  it('returns the meow global file when present', () => {
    const home = path.join(root, 'home')
    mkdirSync(path.join(home, '.config', 'meow'), { recursive: true })
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    writeFileSync(path.join(home, '.config', 'meow', 'AGENTS.md'), '# Global meow')
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Global claude')
    const files = globalInstructionFiles(home)
    expect(files).toHaveLength(1)
    expect(files[0].content).toBe('# Global meow')
    expect(files[0].path).toBe(path.join(home, '.config', 'meow', 'AGENTS.md'))
  })

  it('falls back to ~/.claude/CLAUDE.md when no meow AGENTS.md exists', () => {
    const home = path.join(root, 'home')
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Claude global')
    const files = globalInstructionFiles(home)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe(path.join(home, '.claude', 'CLAUDE.md'))
  })

  it('returns empty when no global instruction file exists', () => {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    expect(globalInstructionFiles(home)).toEqual([])
  })
})

describe('instructionFilesForFile', () => {
  it('attaches the first existing instruction file per dir, walking up', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Claude ignored')
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'))
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toEqual([path.join('repo', 'src', 'AGENTS.md'), path.join('repo', 'AGENTS.md')])
  })

  it('skips paths in the skip set', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    const skip = new Set([path.join(cwd, 'AGENTS.md')])
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'), skip)
    expect(files.map(f => path.basename(f.path))).toEqual(['AGENTS.md'])
    expect(files[0].path).toBe(path.join(root, 'repo', 'AGENTS.md'))
  })

  it('falls back to CLAUDE.md per dir when no AGENTS.md exists in that dir', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Src claude')
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'))
    expect(files.map(f => path.basename(f.path))).toEqual(['CLAUDE.md', 'AGENTS.md'])
  })
})
```

### Step 2: Run the tests to verify they fail

```bash
npx vitest run tests/unit/agent-instructions.test.ts
```

Expected: FAIL — `loadInstructions` still accepts a second arg and still includes CLAUDE.md alongside AGENTS.md; `globalInstructionFiles`/`instructionFilesForFile` don't exist yet (module import error).

### Step 3: Rewrite `src/main/agent/instructions.ts`

Replace the entire file:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const PROJECT_FILES = ['AGENTS.md', 'CLAUDE.md']

export interface InstructionFile {
  path: string
  content: string
}

function walkUp(startDir: string, collect: (dir: string) => void): void {
  let dir = path.resolve(startDir)
  const home = homedir()
  while (true) {
    collect(dir)
    const isGitRoot = existsSync(path.join(dir, '.git'))
    if (isGitRoot || dir === home) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

// First existing global instruction file under the home dir, mirroring
// opencode's ~/.config/opencode/AGENTS.md + ~/.claude/CLAUDE.md. The homeDir
// parameter exists for tests; production always uses homedir().
export function globalInstructionFiles(homeDir: string = homedir()): InstructionFile[] {
  const candidates = [
    path.join(homeDir, '.config', 'meow', 'AGENTS.md'),
    path.join(homeDir, '.claude', 'CLAUDE.md')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return [{ path: p, content: readFileSync(p, 'utf-8') }]
  }
  return []
}

export function loadInstructions(cwd: string): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  for (const f of globalInstructionFiles()) add(f.path)

  // Single-type priority: if any AGENTS.md exists along the walk-up path,
  // collect only AGENTS.md files; otherwise fall back to CLAUDE.md (opencode).
  const dirs: string[] = []
  walkUp(cwd, dir => dirs.push(dir))
  const hasAgents = dirs.some(dir => existsSync(path.join(dir, 'AGENTS.md')))
  const basename = hasAgents ? 'AGENTS.md' : 'CLAUDE.md'
  for (const dir of dirs) add(path.join(dir, basename))
  return out
}

// Instruction files near a file the model just read, walking up to the repo
// root. At each dir the first existing of AGENTS.md/CLAUDE.md wins (opencode
// `find`); `skip` excludes already-attached paths (cross-message dedupe).
export function instructionFilesForFile(filePath: string, skip: ReadonlySet<string> = new Set()): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p) || skip.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  walkUp(path.dirname(filePath), dir => {
    for (const f of PROJECT_FILES) {
      if (existsSync(path.join(dir, f))) {
        add(path.join(dir, f))
        break
      }
    }
  })
  return out
}

export function instructionsText(files: InstructionFile[]): string {
  if (files.length === 0) return ''
  return '\n\n' + files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')
}
```

### Step 4: Update call sites so the tree still compiles

`src/main/meow-agent-manager.ts`:
- Remove `userInstructionsDir?: string` from `MeowAgentManagerDeps` interface (line ~53).
- Change line ~697 from `loadInstructions(agent.cwd, this.deps.userInstructionsDir)` to `loadInstructions(agent.cwd)`.

`src/main/index.ts`:
- Remove the `userInstructionsDir: app.getPath('userData'),` line (line ~90).

### Step 5: Run the tests

```bash
npx vitest run tests/unit/agent-instructions.test.ts
```

Expected: PASS (6 new/updated tests).

### Step 6: Verify typecheck

```bash
npm run typecheck
```

Expected: PASS.

### Step 7: Commit

```bash
git add src/main/agent/instructions.ts src/main/meow-agent-manager.ts src/main/index.ts tests/unit/agent-instructions.test.ts
git commit -m "refactor: instructions.ts — home-dir global + single-type project priority (opencode-style)"
```

---

## Task 2: Move attach-on-read into the `read` tool output (`loop.ts` + `types.ts`)

### Step 1: Write/update tests

In `tests/unit/agent-loop.test.ts`:

1. Add `execFileSync` to imports:
```ts
import { execFileSync } from 'node:child_process'
```

2. Replace the test `'attaches AGENTS.md files after the model reads a file in a subdir'` (currently ~line 541) with:

```ts
it('returns nearby AGENTS.md via onFileRead and does not inject a user message', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-loop-agents-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const sub = path.join(dir, 'src')
  mkdirSync(sub)
  writeFileSync(path.join(dir, 'AGENTS.md'), '# Root rules')
  writeFileSync(path.join(sub, 'AGENTS.md'), '# Sub rules')
  writeFileSync(path.join(sub, 'a.ts'), 'x')
  try {
    const readSpy = vi.fn(async (_input: Record<string, unknown>, ctx: { onFileRead?: (p: string) => string }) => {
      const reminder = ctx.onFileRead?.(path.join(sub, 'a.ts')) ?? ''
      return { output: 'x' + (reminder ? `\n\n${reminder}` : '') }
    })
    const h = makeHarness({
      cwd: dir,
      tools: new Map([['read', stubTool('read', readSpy)]])
    })
    h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'read src/a.ts', createdAt: 1 } })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'src/a.ts' } },
        { kind: 'finish' }
      ],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const outputs = h.items
      .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
      .map(i => i.tool.output ?? '')
    expect(outputs.join('\n')).toContain('# Root rules')
    expect(outputs.join('\n')).toContain('# Sub rules')
    const userTexts = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message' && i.message.role === 'user')
      .map(i => i.message.text)
    expect(userTexts.join('\n')).not.toContain('Relevant project instructions')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('does not re-attach AGENTS.md already attached (cross-message dedupe)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-loop-agents-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const sub = path.join(dir, 'src')
  mkdirSync(sub)
  writeFileSync(path.join(dir, 'AGENTS.md'), '# Root rules')
  writeFileSync(path.join(sub, 'AGENTS.md'), '# Sub rules')
  writeFileSync(path.join(sub, 'a.ts'), 'x')
  writeFileSync(path.join(sub, 'b.ts'), 'y')
  try {
    const readSpy = vi.fn(async (_input: Record<string, unknown>, ctx: { onFileRead?: (p: string) => string }) => {
      const f = (_input as { file_path: string }).file_path
      const full = path.join(sub, f)
      const reminder = ctx.onFileRead?.(full) ?? ''
      return { output: f + (reminder ? `\n\n${reminder}` : '') }
    })
    const h = makeHarness({
      cwd: dir,
      tools: new Map([['read', stubTool('read', readSpy)]])
    })
    h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'read both', createdAt: 1 } })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'src/a.ts' } },
        { kind: 'tool-call', toolCallId: 'tc2', toolName: 'read', toolInput: { file_path: 'src/b.ts' } },
        { kind: 'finish' }
      ],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const outputs = h.items
      .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
      .map(i => i.tool.output ?? '')
    const reminders = outputs.filter(o => o.includes('<system-reminder>'))
    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toContain('# Sub rules')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

3. Replace the test `'does not attach instructions when no file was read'` (currently ~line 576) with:

```ts
it('does not attach instructions when no file was read', async () => {
  const h = makeHarness()
  h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'hi', createdAt: 1 } })
  h.llm.queue = [textParts('hello')]
  h.runner.run()
  await new Promise(r => setTimeout(r, 20))
  const toolOutputs = h.items
    .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
    .map(i => i.tool.output ?? '')
  expect(toolOutputs.join('\n')).not.toContain('<system-reminder>')
})
```

### Step 2: Run the tests to verify they fail

```bash
npx vitest run tests/unit/agent-loop.test.ts
```

Expected: FAIL — the current `onFileRead` returns `void`/`Set` (no reminder text), so tool outputs contain no `<system-reminder>`.

### Step 3: Change `ToolContext.onFileRead` contract

`src/main/agent/tools/types.ts`:

```ts
  // Returns instruction-reminder text to append to the read tool output
  // ('' when no nearby instructions or already attached) — opencode-style.
  onFileRead?(filePath: string): string
```

### Step 4: Rewrite the loop

`src/main/agent/loop.ts`:

1. In `LoopDeps`, add (near `system`):
```ts
  systemInstructionPaths?: ReadonlySet<string>
```

2. Replace the field:
```ts
  // Files the model read/edited this turn, so nearby AGENTS.md files can be
  // attached to the next LLM message (opencode-style instruction injection).
  private readFiles = new Set<string>()
```
with:
```ts
  // AGENTS.md paths already attached to a read output this session; cross-message
  // dedupe so instructions are not repeated across turns (opencode claims set).
  private attachedInstructions = new Set<string>()
```

3. In `run()`, remove `this.readFiles.clear()` (the line after `this.compactedThisRun = 0`).

4. In the `toolCtx` object (`executeCall`), replace:
```ts
          onFileRead: (filePath) => this.readFiles.add(filePath)
```
with:
```ts
          onFileRead: (filePath) => {
            const skip = new Set([...this.attachedInstructions, ...(this.deps.systemInstructionPaths ?? [])])
            const files = instructionFilesForFile(filePath, skip)
            if (files.length === 0) return ''
            for (const f of files) this.attachedInstructions.add(f.path)
            return `<system-reminder>\n${files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')}\n</system-reminder>`
          }
```

5. Replace `buildMessages`:
```ts
  private buildMessages(isLastStep = false): ReturnType<typeof toLlmMessages> {
    const items = this.deps.getItems()
    const toolOutputMaxChars = this.deps.compaction?.toolOutputMaxChars
    const messages = toLlmMessages(items, { toolOutputMaxChars, ...this.truncationOpts() })
    return isLastStep ? [...messages, { role: 'user', content: MAX_STEPS_PROMPT }] : messages
  }
```

6. Delete the `attachInstructions()` method entirely (the method that builds `'Relevant project instructions:'` blocks).

### Step 5: Run the tests

```bash
npx vitest run tests/unit/agent-loop.test.ts
```

Expected: PASS.

### Step 6: Verify typecheck

```bash
npm run typecheck
```

Expected: PASS.

### Step 7: Commit

```bash
git add src/main/agent/tools/types.ts src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "refactor: attach AGENTS.md into read tool output via onFileRead (opencode-style)"
```

---

## Task 3: Wire `read`/`edit` tools to the new contract

### Step 1: Write/update tests

In `tests/unit/agent-tools.test.ts`:

1. Add `vi` to the vitest import:
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
```

2. In the `describe('read', ...)` block, add:

```ts
  it('appends the instruction reminder returned by onFileRead', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'x\n')
    const rctx: ToolContext = {
      ...ctx,
      onFileRead: () => '<system-reminder>\nInstructions from: /x/AGENTS.md\nrules\n</system-reminder>'
    }
    const r = await readTool.run({ file_path: 'f.txt' }, rctx)
    expect(r.output).toContain('<system-reminder>')
    expect(r.output).toContain('Instructions from: /x/AGENTS.md')
    expect(r.output).toContain('rules')
  })

  it('does not append a reminder when onFileRead returns empty', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'x\n')
    const rctx: ToolContext = { ...ctx, onFileRead: () => '' }
    const r = await readTool.run({ file_path: 'f.txt' }, rctx)
    expect(r.output).toBe('x')
  })
```

3. In the `describe('edit', ...)` block, add:

```ts
  it('does not call onFileRead', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'a\nb\n')
    const onFileRead = vi.fn()
    const rctx: ToolContext = { ...ctx, onFileRead }
    const r = await editTool.run({ file_path: 'f.txt', old_string: 'b', new_string: 'B' }, rctx)
    expect(r.output).toContain('edited')
    expect(onFileRead).not.toHaveBeenCalled()
  })
```

### Step 2: Run the tests to verify they fail

```bash
npx vitest run tests/unit/agent-tools.test.ts
```

Expected: FAIL — `read` ignores `onFileRead`'s return; `edit` still calls `onFileRead`.

### Step 3: Update `read.ts`

`src/main/agent/tools/read.ts` — replace the run body after the `isFile()` check:

```ts
    const full = resolveCwd(ctx.cwd, file_path)
    if (!existsSync(full)) return { error: `read: file not found: ${file_path}` }
    if (!statSync(full).isFile()) return { error: `read: not a file: ${file_path}` }
    const reminder = ctx.onFileRead?.(full) ?? ''
    const lines = readFileSync(full, 'utf-8').split('\n')
    const slice = lines.slice(offset, offset + limit)
    let out = slice.join('\n')
    if (offset > 0) {
      out = `(lines ${offset + 1}-${Math.min(offset + limit, lines.length)} of ${lines.length})\n` + out
    } else if (lines.length > limit) {
      out = `(showing first ${limit} of ${lines.length} lines)\n` + out
    }
    if (out.length > MAX_CHARS) {
      out = out.slice(0, MAX_CHARS) + '\n[output truncated — use offset/limit to page]\n'
    }
    if (reminder) out += `\n\n${reminder}`
    return { output: out }
```

(Removes the old `ctx.onFileRead?.(full)` line before `readFileSync`; the reminder now appends at the end.)

### Step 4: Update `edit.ts`

`src/main/agent/tools/edit.ts` — remove this line (right after the exists check):
```ts
    ctx.onFileRead?.(full)
```

### Step 5: Run the tests

```bash
npx vitest run tests/unit/agent-tools.test.ts
```

Expected: PASS.

### Step 6: Verify typecheck

```bash
npm run typecheck
```

Expected: PASS.

### Step 7: Commit

```bash
git add src/main/agent/tools/read.ts src/main/agent/tools/edit.ts tests/unit/agent-tools.test.ts
git commit -m "feat: read tool appends AGENTS.md reminder; edit no longer triggers it"
```

---

## Task 4: Pass `systemInstructionPaths` from manager into SessionRunner

### Step 1: Update `meow-agent-manager.ts`

In `register()`, replace:
```ts
    // AGENTS.md/CLAUDE.md walking up from cwd are inlined into the system
    // prompt (opencode-style); module-level ones attach on read via loop.ts.
    const instructions = instructionsText(loadInstructions(agent.cwd))
```
with:
```ts
    // AGENTS.md/CLAUDE.md walking up from cwd are inlined into the system
    // prompt (opencode-style); module-level ones attach on read via loop.ts.
    const instructionFiles = loadInstructions(agent.cwd)
    const instructions = instructionsText(instructionFiles)
```

In the `new SessionRunner({ ... })` deps object (line ~745), add:
```ts
      systemInstructionPaths: new Set(instructionFiles.map(f => f.path)),
```

### Step 2: Verify

```bash
npm run typecheck && npm test
```

Expected: PASS.

### Step 3: Commit

```bash
git add src/main/meow-agent-manager.ts
git commit -m "feat: pass system instruction paths to SessionRunner for read-reminder dedupe"
```

---

## Task 5: Add opencode search-tools sentence to the default system prompt

### Step 1: Write the failing test

In `tests/unit/agent-config.test.ts`, in the test that asserts the default system prompt (currently `expect(cfg.agents.meow.systemPrompt).toMatch(/question tool/i)`), add:
```ts
    expect(cfg.agents.meow.systemPrompt).toMatch(/search tools/i)
```

### Step 2: Run the test to verify it fails

```bash
npx vitest run tests/unit/agent-config.test.ts
```

Expected: FAIL on the new assertion.

### Step 3: Update `config.ts`

In `src/main/agent/config.ts`, append to the `DEFAULT_MEOW_CONFIG.agents.meow.systemPrompt` string (keep the existing sentences):
```ts
        'Use the available search tools to understand the codebase and the user\'s query. ' +
        'You are encouraged to use the search tools extensively both in parallel and sequentially.'
```

### Step 4: Run the tests

```bash
npx vitest run tests/unit/agent-config.test.ts
```

Expected: PASS.

### Step 5: Verify typecheck + full suite

```bash
npm run typecheck && npm test
```

Expected: PASS.

### Step 6: Commit

```bash
git add src/main/agent/config.ts tests/unit/agent-config.test.ts
git commit -m "feat: base prompt encourages extensive search-tool use (opencode-style)"
```

---

## Task 6: Full verification

```bash
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected: all PASS.

Manual smoke (optional): in a project with a module-level `src/AGENTS.md`, ask the agent to read a file under `src/` — the read tool output should contain `<system-reminder>Instructions from: ...AGENTS.md`; the second read of another `src/` file should not repeat the same instruction file.

Commit any verification-only fixes (e.g. test fallout) with a message describing the fix.
