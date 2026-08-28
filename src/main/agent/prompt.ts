import type { EnvSnapshot } from './env'
import type { MemoryIndex } from './memory'

export interface BuildSystemPromptArgs {
  baseSystemPrompt: string
  modeNote: string
  instructionText: string
  skillsText: string
  memoryRules: string
}

export const PRECEDENCE_NOTE =
  'Precedence: project instructions (AGENTS.md/CLAUDE.md) > memory > skills > base system prompt.'

// Static harness prompt: labeled sections, assembled once per run so an edited
// AGENTS.md or a new skill lands on the next turn while the provider still
// caches the stable prefix. Empty sections are dropped (e.g. build mode has no
// mode note); the precedence note always closes the prompt.
export function buildSystemPrompt(a: BuildSystemPromptArgs): string {
  const sections: Array<[string, string]> = [
    ['Identity & how to work', a.baseSystemPrompt.trim()],
    ['Project instructions', a.instructionText.trim()],
    ['Memory', a.memoryRules.trim()],
    ['Skills', a.skillsText.trim()],
    ['Mode & permissions', a.modeNote.trim()]
  ]
  const body = sections
    .filter(([, content]) => content !== '')
    .map(([title, content]) => `# ${title}\n\n${content}`)
    .join('\n\n')
  return `${body}\n\n${PRECEDENCE_NOTE}`
}

// Dynamic context: a <system-reminder> user message prepended at turn start,
// recomputed every run so it is always fresh. Not written to the store.
export function buildTurnReminder(env: EnvSnapshot, memory: MemoryIndex): string {
  const lines = [
    '<system-reminder>',
    `Environment: platform=${env.platform}, shell=${env.shell}, cwd=${env.cwd}, date=${env.date}`
  ]
  if (env.git) {
    const branch = env.git.branch ?? '(detached)'
    lines.push(`Git: on ${branch}, ${env.git.dirtyCount} dirty file(s).`)
  }
  if (memory.lines.length > 0) {
    lines.push('', `Memory index (${memory.path}):`)
    lines.push(...memory.lines)
    if (memory.truncated) lines.push('(index truncated)')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}
