import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface Skill {
  name: string
  description: string
  content: string
  path?: string
}

function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { frontmatter: {}, body: text }
  const frontmatter: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) frontmatter[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { frontmatter, body: m[2] }
}

function skillFromFile(file: string, dir: string): Skill | null {
  const text = readFileSync(file, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(text)
  if (!frontmatter.name) return null
  return {
    name: frontmatter.name,
    description: frontmatter.description ?? '',
    content: body.trim(),
    path: dir
  }
}

export function loadSkills(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  const out: Skill[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const skill = skillFromFile(path.join(dir, entry.name), dir)
      if (skill) out.push(skill)
    } else if (entry.isDirectory()) {
      const skillFile = path.join(dir, entry.name, 'SKILL.md')
      if (existsSync(skillFile)) {
        const skill = skillFromFile(skillFile, path.join(dir, entry.name))
        if (skill) out.push(skill)
      }
    }
  }
  return out
}

export function collectSkills(cwd: string, userSkillsDir?: string, builtinSkillsDir?: string): Skill[] {
  const dirs = [path.join(cwd, '.meow', 'skills')]
  if (userSkillsDir) dirs.push(userSkillsDir)
  if (builtinSkillsDir) dirs.push(builtinSkillsDir)
  const seen = new Set<string>()
  const out: Skill[] = []
  for (const dir of dirs) {
    for (const skill of loadSkills(dir)) {
      if (seen.has(skill.name)) continue
      seen.add(skill.name)
      out.push(skill)
    }
  }
  return out
}

export function skillListText(skills: Skill[]): string {
  if (skills.length === 0) return ''
  return (
    '\n\nYou have skills available. Load one with the skill tool when the task matches its purpose. ' +
    'Before starting significant work, load the using-superpowers skill to pick the right workflow ' +
    '(e.g. brainstorming, writing-plans, executing-plans, subagent-driven-development).\n' +
    'Available skills:\n' + skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
  )
}
