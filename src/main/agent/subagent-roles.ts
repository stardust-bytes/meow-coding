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
