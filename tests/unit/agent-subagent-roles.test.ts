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
