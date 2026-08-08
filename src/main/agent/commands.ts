import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Command } from '../../shared/types'
import { expandReferences } from './references'

const SHELL_TIMEOUT = 10_000

export const INIT_COMMAND: Command = {
  name: 'init',
  description: 'Create or update AGENTS.md for this project',
  template:
    'Create an AGENTS.md file for this project at the repo root. It should describe the project ' +
    'tech stack, build/test/lint commands, code conventions and project structure, so an AI ' +
    'coding agent can work here. Read the existing code first. If AGENTS.md already exists, ' +
    'review and improve it instead of overwriting.'
}

export const REVIEW_COMMAND: Command = {
  name: 'review',
  description: 'Review the current uncommitted changes',
  template:
    'Review the current uncommitted changes. Run `git diff` and `git status`, inspect the changed ' +
    'files, and give a concise review: what changed, any bugs or regressions, style issues, and ' +
    'suggested improvements. Do not modify files.'
}

// System commands are dispatched in main (meow-agent-manager.ts runCommand)
// instead of being resolved into a prompt sent to the LLM.
export const NEW_COMMAND: Command = {
  name: 'new',
  description: 'Start a new session',
  template: '',
  type: 'system'
}

// Superpowers slash commands. Embedded built-ins modeled on the opencode
// `.opencode/commands/sp-*.md` files: each dispatches the current request to the
// matching Superpowers skill so the agent follows that workflow explicitly.
const SUPERPOWERS: Array<{ name: string; context: string }> = [
  { name: 'brainstorming', context: 'Read any relevant module-level `AGENTS.md` files before proposing or changing implementation.' },
  { name: 'dispatching-parallel-agents', context: 'Read any relevant module-level `AGENTS.md` files before dispatching work.' },
  { name: 'executing-plans', context: 'Read the relevant implementation plan and supporting `AGENTS.md` files first.' },
  { name: 'finishing-a-development-branch', context: 'Review the current branch state and relevant project instructions before deciding next steps.' },
  { name: 'receiving-code-review', context: 'Review the affected code and feedback carefully before making changes.' },
  { name: 'requesting-code-review', context: 'Gather the relevant changed files, tests, and implementation notes before requesting review.' },
  { name: 'subagent-driven-development', context: 'Read the active implementation plan and relevant module instructions first.' },
  { name: 'systematic-debugging', context: 'Inspect the failing behavior, logs, tests, and relevant code before proposing a fix.' },
  { name: 'test-driven-development', context: 'Read the relevant spec, plan, and module-level instructions before writing tests or implementation.' },
  { name: 'using-git-worktrees', context: 'Review the current repository state before creating or selecting an isolated workspace.' },
  { name: 'using-superpowers', context: 'Use this when you need the Superpowers workflow itself to govern the session.' },
  { name: 'verification-before-completion', context: 'Run the required verification commands and confirm results before claiming completion.' },
  { name: 'writing-plans', context: 'Read the approved spec and relevant module instructions before writing the plan.' },
  { name: 'writing-skills', context: 'Review the target skill files and any related plugin structure before editing.' }
]

export const FRONTEND_DESIGN_COMMAND: Command = {
  name: 'frontend-design',
  description: 'Design or redesign UI following the frontend-design skill',
  template: [
    'Use the `frontend-design` skill for this request and follow it strictly.',
    '',
    'Project context:',
    '- Read @AGENTS.md before taking action.',
    '- Ground the design in the product subject, its audience, and the single job the page must do.',
    '',
    'User request:',
    '$ARGUMENTS'
  ].join('\n')
}

export const SUPERPOWERS_COMMANDS: Command[] = SUPERPOWERS.map(({ name, context }) => ({
  name: `sp-${name}`,
  description: `Invoke the Superpowers ${name} skill`,
  template: [
    `Use the Superpowers skill \`${name}\` for this request and follow it strictly.`,
    '',
    'Project context:',
    '- Read @AGENTS.md before taking action.',
    `- ${context}`,
    '',
    'User request:',
    '$ARGUMENTS'
  ].join('\n')
}))

const SHELL_EXEC_RE = /!`([^`]*)`/g
const ARG_RE = /\$(\d+)|\$ARGUMENTS/g
export interface CommandResolverOptions {
  cwd: string
  commands: Command[]
  projectDir?: string
}

export function resolveShell(text: string, cwd: string): Promise<string> {
  const matches = [...text.matchAll(SHELL_EXEC_RE)]
  if (matches.length === 0) return Promise.resolve(text)
  const runs = matches.map(
    (m) =>
      new Promise<string>((resolve) => {
        const cmd = m[1]
        execFile(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32'
          ? ['/d', '/s', '/c', cmd]
          : ['-c', cmd], { cwd, timeout: SHELL_TIMEOUT }, (err, stdout, stderr) => {
          if (err) resolve(`(shell error: ${stderr || err.message})`)
          else resolve(stdout.trim())
        })
      })
  )
  return Promise.all(runs).then(outputs => {
    let i = 0
    return text.replace(SHELL_EXEC_RE, () => outputs[i++])
  })
}

export function resolveCommandTemplate(template: string, args: string[]): string {
  const used = new Set<number>()
  for (const m of template.matchAll(/\$(\d+)/g)) used.add(Number(m[1]))
  const maxUsed = used.size > 0 ? Math.max(...used) : 0
  let out = template
  out = out.replace(ARG_RE, (full, num: string) => {
    if (full === '$ARGUMENTS') return args.join(' ')
    const idx = Number(num) - 1
    if (idx < 0) return ''
    // The highest referenced placeholder slurps the remaining args.
    return num === String(maxUsed) ? args.slice(idx).join(' ') : (args[idx] ?? '')
  })
  return out
}

export async function resolveCommand(
  command: Command,
  args: string[],
  opts: CommandResolverOptions
): Promise<string> {
  let text = resolveCommandTemplate(command.template, args)
  text = await resolveShell(text, opts.cwd)
  text = expandReferences(opts.cwd, text)
  return text
}

export class CommandStore {
  private builtin = new Map<string, Command>(
    [INIT_COMMAND, REVIEW_COMMAND, NEW_COMMAND, FRONTEND_DESIGN_COMMAND, ...SUPERPOWERS_COMMANDS].map(c => [c.name, c])
  )

  constructor(private userCommandsFile: string) {}

  private userCommands(): Command[] {
    if (!existsSync(this.userCommandsFile)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.userCommandsFile, 'utf-8'))
      return Array.isArray(parsed) ? parsed.filter(isCommand) : []
    } catch {
      return []
    }
  }

  private saveUser(commands: Command[]): void {
    mkdirSync(path.dirname(this.userCommandsFile), { recursive: true })
    writeFileSync(this.userCommandsFile, JSON.stringify(commands, null, 2))
  }

  list(): Command[] {
    const seen = new Set<string>()
    const out: Command[] = []
    for (const c of this.builtin.values()) {
      out.push(c)
      seen.add(c.name)
    }
    for (const c of this.userCommands()) {
      if (seen.has(c.name)) continue
      out.push(c)
      seen.add(c.name)
    }
    return out
  }

  save(command: Command): Command {
    const name = command.name.replace(/^\/+/, '').trim()
    if (!name || !command.template) throw new Error('Command requires a name and template')
    const next: Command = { ...command, name }
    const rest = this.userCommands().filter(c => c.name !== name)
    rest.push(next)
    this.saveUser(rest)
    return next
  }

  remove(name: string): void {
    const clean = name.replace(/^\/+/, '')
    if (this.builtin.has(clean)) throw new Error('Built-in commands cannot be removed')
    this.saveUser(this.userCommands().filter(c => c.name !== clean))
  }

  get(name: string): Command | undefined {
    const clean = name.replace(/^\/+/, '')
    return this.builtin.get(clean) ?? this.userCommands().find(c => c.name === clean)
  }
}

export function projectCommands(projectDir?: string): Command[] {
  if (!projectDir) return []
  const dir = path.join(projectDir, '.meow', 'commands')
  if (!existsSync(dir)) return []
  const out: Command[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue
    const text = readFileSync(path.join(dir, entry), 'utf-8')
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
    if (!m) continue
    const frontmatter: Record<string, string> = {}
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) frontmatter[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    const name = frontmatter.name ?? entry.replace(/\.md$/, '')
    if (!name) continue
    out.push({ name, description: frontmatter.description ?? '', template: m[2].trim() })
  }
  return out
}

export function uniqueCommands(...lists: Command[][]): Command[] {
  const seen = new Set<string>()
  const out: Command[] = []
  for (const list of lists) {
    for (const c of list) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c)
    }
  }
  return out
}

function isCommand(v: unknown): v is Command {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.name === 'string' && typeof c.template === 'string'
}
