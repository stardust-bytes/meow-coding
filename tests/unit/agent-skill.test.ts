import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectSkills, loadSkills, skillListText } from '../../src/main/agent/skill'
import { createSkillTool } from '../../src/main/agent/tools/skill'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-skill-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ctx: ToolContext = { cwd: '', ask: async () => null }

describe('skills', () => {
  it('parses frontmatter and loads .md skill files', () => {
    const skillsDir = path.join(dir, '.meow', 'skills')
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(path.join(skillsDir, 'refactor.md'), [
      '---',
      'name: refactor',
      'description: Guides for safe refactoring',
      '---',
      'Always run tests after a refactor.'
    ].join('\n'))
    ctx.cwd = dir
    const skills = loadSkills(skillsDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('refactor')
    expect(skills[0].description).toBe('Guides for safe refactoring')
    expect(skills[0].content).toContain('Always run tests')
  })

  it('collects project skills and dedupes by name', () => {
    const userDir = path.join(dir, 'user-skills')
    const projDir = path.join(dir, 'proj')
    const projSkills = path.join(projDir, '.meow', 'skills')
    mkdirSync(userDir, { recursive: true })
    mkdirSync(projSkills, { recursive: true })
    writeFileSync(path.join(userDir, 'shared.md'), '---\nname: shared\ndescription: a\n---\nuser\n')
    writeFileSync(path.join(projSkills, 'shared.md'), '---\nname: shared\ndescription: a\n---\nproj\n')
    writeFileSync(path.join(projSkills, 'proj.md'), '---\nname: proj\ndescription: b\n---\nlocal\n')
    const skills = collectSkills(projDir, userDir)
    expect(skills.map(s => s.name).sort()).toEqual(['proj', 'shared'])
    const shared = skills.find(s => s.name === 'shared')!
    expect(shared.content).toBe('proj')
  })

  it('skillListText formats the available list', () => {
    expect(skillListText([])).toBe('')
    const text = skillListText([{ name: 'a', description: 'does a', content: 'x' }])
    expect(text).toContain('- a: does a')
  })

  it('skill tool returns the skill content and errors on unknown', async () => {
    const skillsDir = path.join(dir, '.meow', 'skills')
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(path.join(skillsDir, 'refactor.md'), '---\nname: refactor\ndescription: guides\n---\nrun tests\n')
    ctx.cwd = dir
    const tool = createSkillTool(() => undefined)
    const ok = await tool.run({ name: 'refactor' }, ctx)
    expect(ok.output).toContain('run tests')
    const bad = await tool.run({ name: 'nope' }, ctx)
    expect(bad.error).toMatch(/unknown skill/)
  })

  it('collects builtin skills with project/user taking priority', () => {
    const userDir = path.join(dir, 'user-skills')
    const builtinDir = path.join(dir, 'builtin-skills')
    mkdirSync(userDir, { recursive: true })
    mkdirSync(builtinDir, { recursive: true })
    writeFileSync(path.join(builtinDir, 'brainstorming.md'), '---\nname: brainstorming\ndescription: design\n---\nbuiltin\n')
    writeFileSync(path.join(builtinDir, 'writing-plans.md'), '---\nname: writing-plans\ndescription: plans\n---\nplans\n')
    writeFileSync(path.join(userDir, 'brainstorming.md'), '---\nname: brainstorming\ndescription: design\n---\nuser-override\n')
    const skills = collectSkills(dir, userDir, builtinDir)
    expect(skills.find(s => s.name === 'writing-plans')?.content).toBe('plans')
    expect(skills.find(s => s.name === 'brainstorming')?.content).toBe('user-override')
  })

  it('skill tool loads a bundled skill', async () => {
    const builtinDir = path.join(dir, 'builtin-skills')
    mkdirSync(builtinDir, { recursive: true })
    writeFileSync(path.join(builtinDir, 'brainstorming.md'), '---\nname: brainstorming\ndescription: d\n---\nBUILTIN CONTENT\n')
    ctx.cwd = dir
    const tool = createSkillTool(() => undefined, () => builtinDir)
    const ok = await tool.run({ name: 'brainstorming' }, ctx)
    expect(ok.output).toContain('BUILTIN CONTENT')
  })
})
