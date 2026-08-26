import { describe, expect, it } from 'vitest'
import { decide, decidePermission, deriveSubagentContext, PLAN_RULES } from '../../src/main/agent/permission'
import type { SubagentRole, ToolPermissionContext } from '../../src/main/agent/permission'
import { DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'
import type { PermissionRule } from '../../src/main/agent/config'

const noSaved = () => false

describe('decidePermission (build mode)', () => {
  it('uses config rules and defaults to ask', () => {
    expect(decidePermission('build', { bash: 'deny' }, noSaved, 'bash')).toBe('deny')
    expect(decidePermission('build', { write: 'allow' }, noSaved, 'write')).toBe('allow')
    expect(decidePermission('build', {}, noSaved, 'read')).toBe('ask')
  })

  it('matches wildcard and prefix patterns', () => {
    expect(decidePermission('build', { '*': 'deny' }, noSaved, 'read')).toBe('deny')
    expect(decidePermission('build', { 'web*': 'allow' }, noSaved, 'webfetch')).toBe('allow')
    expect(decidePermission('build', { 'mcp__*': 'ask' }, noSaved, 'mcp__x__y')).toBe('ask')
  })

  it('prefers a saved always-allow over an ask rule', () => {
    expect(decidePermission('build', { bash: 'ask' }, () => true, 'bash')).toBe('allow')
  })

  it('lets a deny rule beat a saved allow', () => {
    expect(decidePermission('build', { bash: 'deny' }, () => true, 'bash')).toBe('deny')
  })

  it('allows the question tool without a separate permission prompt', () => {
    expect(decidePermission('build', DEFAULT_MEOW_CONFIG.permission, noSaved, 'question')).toBe('allow')
  })

  it('allows browser tools by default in build mode', () => {
    expect(decidePermission('build', DEFAULT_MEOW_CONFIG.permission, noSaved, 'browser_click')).toBe('allow')
    expect(decidePermission('build', DEFAULT_MEOW_CONFIG.permission, noSaved, 'browser_navigate')).toBe('allow')
  })
})

describe('decidePermission (plan mode)', () => {
  it('denies write tools', () => {
    expect(decidePermission('plan', {}, noSaved, 'write')).toBe('deny')
    expect(decidePermission('plan', {}, noSaved, 'edit')).toBe('deny')
    expect(decidePermission('plan', {}, noSaved, 'apply-patch')).toBe('deny')
    expect(decidePermission('plan', {}, noSaved, 'git')).toBe('deny')
    expect(decidePermission('plan', {}, noSaved, 'todowrite')).toBe('deny')
  })

  it('allows read-only tools and asks for bash', () => {
    expect(decidePermission('plan', {}, noSaved, 'read')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'glob')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'grep')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'bash')).toBe('ask')
    // The task tool itself is read-only; task.ts gates which roles may run.
    expect(decidePermission('plan', {}, noSaved, 'task')).toBe('allow')
  })

  it('plan mode wins even if config allows a write tool', () => {
    expect(decidePermission('plan', { write: 'allow' }, noSaved, 'write')).toBe('deny')
  })

  it('does not let a saved always-allow override plan mode', () => {
    expect(decidePermission('plan', {}, () => true, 'bash')).toBe('ask')
    expect(decidePermission('plan', {}, () => true, 'write')).toBe('deny')
    expect(decidePermission('plan', {}, () => true, 'edit')).toBe('deny')
  })

  it('asks for browser tools in plan mode even if config allows them', () => {
    expect(decidePermission('plan', { 'browser_*': 'allow' }, noSaved, 'browser_click')).toBe('ask')
    expect(decidePermission('plan', { 'browser_*': 'allow' }, () => true, 'browser_click')).toBe('ask')
  })
})

describe('PLAN_RULES', () => {
  it('exposes the plan permission map', () => {
    expect(PLAN_RULES.write).toBe('deny')
    expect(PLAN_RULES.bash).toBe('ask')
    expect(PLAN_RULES.read).toBe('allow')
    expect(PLAN_RULES['browser_*']).toBe('ask')
  })
})

describe('plan mode bash write guard', () => {
  it('denies write-style bash commands in plan mode', () => {
    const writeCmds = [
      "echo 'x' > file.txt",
      "sed -i 's/a/b/' f.txt",
      'tee out.log',
      'mv a b',
      'rm -rf build',
      'cp a b',
      'mkdir -p newdir',
      'node -e "fs.writeFileSync(\'a\', \'b\')"',
      'cat > f.txt << EOF\nhi\nEOF',
      'chmod +x run.sh'
    ]
    for (const cmd of writeCmds) {
      expect(decidePermission('plan', {}, noSaved, 'bash', { command: cmd })).toBe('deny')
    }
  })

  it('still asks (not denies) read-only bash in plan mode', () => {
    const readCmds = [
      'ls -la',
      'npm test',
      'cat package.json',
      'grep -rn "todo" src',
      'git status', // git is denied by PLAN_RULES anyway; here via empty config
      'echo hi 2>&1',
      'ls > /dev/null',
      'npm run build 2>&1 | tail -20'
    ]
    for (const cmd of readCmds) {
      expect(decidePermission('plan', {}, noSaved, 'bash', { command: cmd })).toBe('ask')
    }
  })

  it('is inert in build mode', () => {
    expect(decidePermission('build', {}, noSaved, 'bash', { command: "echo 'x' > f.txt" })).toBe('ask')
  })
})

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
