import type { PermissionRule } from './config'
import type { AgentMode } from '../../shared/types'

export type PermissionDecision = 'allow' | 'ask' | 'deny'

// Plan mode mirrors opencode: read-only. Deny every write tool, ask for bash.
export const PLAN_RULES: Record<string, PermissionRule> = {
  read: 'allow',
  glob: 'allow',
  grep: 'allow',
  webfetch: 'allow',
  websearch: 'allow',
  skill: 'allow',
  question: 'allow',
  bash: 'ask',
  write: 'deny',
  edit: 'deny',
  'apply-patch': 'deny',
  revert: 'deny',
  git: 'deny',
  todowrite: 'deny',
  task: 'deny',
  'browser_*': 'ask'
}

// Bash is the leak: an LLM denied write/edit will rewrite files via sed -i,
// echo > file, or node -e with fs.writeFileSync. In plan mode these must
// be denied outright, not merely asked about.
const WRITE_REDIRECT = /(^|[\s;&|]*)\d*(?<!=)>{1,2}(?!\s*&)(?!\s*\/dev\/)/m
const WRITE_TOKENS = /\b(?:sed\s+-i|perl\s+-i|tee|dd|mv|rm|cp|mkdir|touch|chmod|chown|install|truncate|mkfifo|unlink|rmdir|apply-patch)\b/
const WRITE_APIS = /\b(?:fs\.(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|rename|renameSync|mkdir|mkdirSync|copyFile|copyFileSync|createWriteStream)\s*\(|open\(\s*['"][^'"]+['"]\s*,\s*['"]w)/

export function isWriteBashCommand(command: string): boolean {
  return WRITE_REDIRECT.test(command) || WRITE_TOKENS.test(command) || WRITE_APIS.test(command)
}

export function rulesForMode(mode: AgentMode): Record<string, PermissionRule> {
  return mode === 'plan' ? PLAN_RULES : {}
}

export function matchPattern(pattern: string, toolName: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1))
  return pattern === toolName
}

function anyRule(rules: Record<string, PermissionRule>, toolName: string, effect: PermissionRule): boolean {
  return Object.keys(rules).some(p => matchPattern(p, toolName) && rules[p] === effect)
}

export function decidePermission(
  mode: AgentMode,
  configRules: Record<string, PermissionRule>,
  isSavedAllow: (toolName: string) => boolean,
  toolName: string,
  input?: Record<string, unknown>
): PermissionDecision {
  // Plan mode is read-only: a write-style bash command is denied, not asked.
  if (mode === 'plan' && toolName === 'bash') {
    const command = typeof input?.command === 'string' ? input.command : ''
    if (command && isWriteBashCommand(command)) return 'deny'
  }
  const combined = { ...configRules, ...rulesForMode(mode) }
  if (anyRule(combined, toolName, 'deny')) return 'deny'
  // Plan mode is read-only: a saved always-allow (e.g. bash from build mode)
  // must not silently bypass the plan-mode ask guard.
  if (mode !== 'plan' && isSavedAllow(toolName)) return 'allow'
  if (anyRule(combined, toolName, 'allow')) return 'allow'
  return 'ask'
}
