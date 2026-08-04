import type { PermissionRule } from './config'

export type PermissionDecision = 'allow' | 'ask' | 'deny'

export function decidePermission(
  rules: Record<string, PermissionRule>,
  toolName: string
): PermissionDecision {
  if (rules[toolName]) return rules[toolName]
  const prefix = Object.keys(rules)
    .filter(key => key.endsWith('*'))
    .sort((a, b) => b.length - a.length)
    .find(key => toolName.startsWith(key.slice(0, -1)))
  if (prefix) return rules[prefix]
  if (rules['*']) return rules['*']
  return 'ask'
}
