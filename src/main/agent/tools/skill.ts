import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { collectSkills } from '../skill'

export function createSkillTool(
  getUserSkillsDir: () => string | undefined,
  getBuiltinSkillsDir: () => string | undefined = () => undefined
): ToolDefinition {
  return {
    name: 'skill',
    description:
      'Load a skill (a bundle of reusable instructions) by name. ' +
      'Available skills are listed in the system prompt.',
    schema: z.object({
      name: z.string().describe('The skill name to load.')
    }),
    async run(input, ctx): Promise<ToolRunResult> {
      const { name } = input as unknown as { name: string }
      const skills = collectSkills(ctx.cwd, getUserSkillsDir(), getBuiltinSkillsDir())
      const skill = skills.find(s => s.name === name)
      if (!skill) {
        const names = skills.map(s => s.name).join(', ') || '(none)'
        return { error: `skill: unknown skill "${name}". Available: ${names}` }
      }
      return { output: skill.content }
    }
  }
}
