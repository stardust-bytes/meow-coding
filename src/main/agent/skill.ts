import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface Skill {
  name: string
  description: string
  content: string
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

export function loadSkills(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  const out: Skill[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const text = readFileSync(path.join(dir, entry.name), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(text)
    if (!frontmatter.name) continue
    out.push({
      name: frontmatter.name,
      description: frontmatter.description ?? '',
      content: body.trim()
    })
  }
  return out
}

export function collectSkills(cwd: string, userSkillsDir?: string): Skill[] {
  const dirs = [path.join(cwd, '.meow', 'skills')]
  if (userSkillsDir) dirs.push(userSkillsDir)
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
  return '\n\nAvailable skills:\n' + skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
}
