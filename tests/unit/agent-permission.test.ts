import { describe, expect, it } from 'vitest'
import { decidePermission, PLAN_RULES } from '../../src/main/agent/permission'
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
    expect(decidePermission('plan', {}, noSaved, 'task')).toBe('deny')
  })

  it('allows read-only tools and asks for bash', () => {
    expect(decidePermission('plan', {}, noSaved, 'read')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'glob')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'grep')).toBe('allow')
    expect(decidePermission('plan', {}, noSaved, 'bash')).toBe('ask')
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
