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
  task: 'deny'
}

export function rulesForMode(mode: AgentMode): Record<string, PermissionRule> {
  return mode === 'plan' ? PLAN_RULES : {}
}

function matchPattern(pattern: string, toolName: string): boolean {
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
  toolName: string
): PermissionDecision {
  const combined = { ...configRules, ...rulesForMode(mode) }
  if (anyRule(combined, toolName, 'deny')) return 'deny'
  if (isSavedAllow(toolName)) return 'allow'
  if (anyRule(combined, toolName, 'allow')) return 'allow'
  return 'ask'
}
