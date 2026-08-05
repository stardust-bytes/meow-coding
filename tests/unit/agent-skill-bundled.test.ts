import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { collectSkills, skillListText } from '../../src/main/agent/skill'
import { createSkillTool } from '../../src/main/agent/tools/skill'
import type { ToolContext } from '../../src/main/agent/tools/types'

const ROOT = path.resolve(__dirname, '../..')
const BUILTIN = path.join(ROOT, 'resources', 'skills')

const ctx: ToolContext = { cwd: ROOT, ask: async () => null }

describe('bundled superpowers skills', () => {
  it('collects every bundled skill with name+description', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual([
      'brainstorming', 'dispatching-parallel-agents', 'executing-plans',
      'finishing-a-development-branch', 'receiving-code-review',
      'requesting-code-review', 'subagent-driven-development',
      'systematic-debugging', 'test-driven-development', 'using-git-worktrees',
      'using-superpowers', 'verification-before-completion',
      'writing-plans', 'writing-skills'
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

  it('skillListText includes the using-superpowers entry', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const text = skillListText(skills)
    expect(text).toContain('using-superpowers')
    expect(text).toContain('brainstorming')
  })

  it('every skill referenced as a bundled script path exists on disk', () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    for (const s of skills) {
      expect(s.path).toBeTruthy()
      if (s.name === 'subagent-driven-development') {
        for (const script of ['sdd-workspace', 'task-brief', 'review-package']) {
          expect(require('node:fs').existsSync(path.join(s.path!, 'scripts', script))).toBe(true)
        }
      }
    }
  })
})
