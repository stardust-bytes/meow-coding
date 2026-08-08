import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CommandStore, INIT_COMMAND, REVIEW_COMMAND, FRONTEND_DESIGN_COMMAND, SUPERPOWERS_COMMANDS,
  projectCommands, uniqueCommands, resolveCommandTemplate, resolveShell, resolveCommand
} from '../../src/main/agent/commands'

describe('resolveCommandTemplate', () => {
  it('fills numbered args with the last one slurping the remainder', () => {
    expect(resolveCommandTemplate('do $1 and $2', ['a', 'b'])).toBe('do a and b')
    expect(resolveCommandTemplate('do $1 then $2', ['a', 'b', 'c'])).toBe('do a then b c')
  })

  it('leaves missing numbered args empty', () => {
    expect(resolveCommandTemplate('do $1 and $2', ['a'])).toBe('do a and ')
  })

  it('fills $ARGUMENTS with all args joined', () => {
    expect(resolveCommandTemplate('run $ARGUMENTS', ['a', 'b'])).toBe('run a b')
  })

  it('leaves unmatched placeholders empty', () => {
    expect(resolveCommandTemplate('x $3', ['a'])).toBe('x ')
  })
})

describe('resolveShell', () => {
  it('executes backtick shell commands inline', async () => {
    const cmd = process.platform === 'win32' ? '!`echo hi`' : '!`echo hi`'
    const out = await resolveShell(cmd, process.cwd())
    expect(out).toContain('hi')
  })

  it('replaces shell errors with a message', async () => {
    const cmd = '!`definitely-not-a-real-command-xyz`'
    const out = await resolveShell(cmd, process.cwd())
    expect(out).toContain('shell error')
  })
})

describe('CommandStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-cmd-'))
    file = path.join(dir, 'commands.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lists built-ins plus saved user commands', () => {
    const store = new CommandStore(file)
    const list = store.list()
    expect(list.map(c => c.name)).toContain('init')
    expect(list.map(c => c.name)).toContain('review')
    expect(list.map(c => c.name)).toContain('sp-using-superpowers')
    expect(list.map(c => c.name)).toContain('sp-brainstorming')
    store.save({ name: '/custom', description: 'd', template: 'do $1' })
    expect(store.list().map(c => c.name)).toContain('custom')
  })

  it('lists the frontend-design built-in command', () => {
    const store = new CommandStore(file)
    expect(store.list().map(c => c.name)).toContain('frontend-design')
    expect(store.get('frontend-design')?.description).toContain('frontend-design skill')
  })

  it('frontend-design command resolves $ARGUMENTS into the skill dispatch prompt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-fd-'))
    try {
      const out = await resolveCommand(FRONTEND_DESIGN_COMMAND, ['redesign the landing page'], {
        cwd: dir, commands: []
      })
      expect(out).toContain('Use the `frontend-design` skill for this request and follow it strictly.')
      expect(out).toContain('Read @AGENTS.md before taking action.')
      expect(out).toContain('User request:\nredesign the landing page')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('superpowers commands resolve $ARGUMENTS into the skill dispatch prompt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-sp-'))
    try {
      const cmd = SUPERPOWERS_COMMANDS.find(c => c.name === 'sp-using-superpowers')
      expect(cmd).toBeDefined()
      const out = await resolveCommand(cmd!, ['analyze the build config'], { cwd: dir, commands: [] })
      expect(out).toContain('Use the Superpowers skill `using-superpowers`')
      expect(out).toContain('Read @AGENTS.md before taking action.')
      expect(out).toContain('User request:\nanalyze the build config')
      expect(SUPERPOWERS_COMMANDS.length).toBeGreaterThanOrEqual(14)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('save and remove persist user commands', () => {
    const store = new CommandStore(file)
    store.save({ name: 'mycmd', description: 'd', template: 'run $ARGUMENTS' })
    expect(store.get('mycmd')?.template).toBe('run $ARGUMENTS')
    store.remove('mycmd')
    expect(store.get('mycmd')).toBeUndefined()
  })

  it('cannot remove built-in commands', () => {
    const store = new CommandStore(file)
    expect(() => store.remove('init')).toThrow()
  })
})

describe('projectCommands', () => {
  it('loads markdown commands with frontmatter from .meow/commands', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-projcmd-'))
    try {
      const cmds = path.join(dir, '.meow', 'commands')
      mkdirSync(cmds, { recursive: true })
      writeFileSync(path.join(cmds, 'lint.md'), '---\nname: lint\ndescription: Run the linter\n---\nRun `npm run lint`\n')
      const list = projectCommands(dir)
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ name: 'lint', description: 'Run the linter' })
      expect(list[0].template).toContain('npm run lint')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores .opencode/commands — project reads .meow only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-opencode-cmd-'))
    try {
      const cmds = path.join(dir, '.opencode', 'commands')
      mkdirSync(cmds, { recursive: true })
      writeFileSync(path.join(cmds, 'sp-using-superpowers.md'), [
        '---',
        'description: Invoke the Superpowers using-superpowers skill',
        '---',
        'Use the Superpowers skill `using-superpowers` for this request and follow it strictly.',
        'User request:',
        '$ARGUMENTS'
      ].join('\n'))
      const list = projectCommands(dir)
      expect(list).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads from .meow/commands only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-meowcmd-'))
    try {
      const plural = path.join(dir, '.meow', 'commands')
      const singular = path.join(dir, '.meow', 'command')
      mkdirSync(plural, { recursive: true })
      mkdirSync(singular, { recursive: true })
      writeFileSync(path.join(plural, 'a.md'), '---\ndescription: a\n---\ntmpl a\n')
      writeFileSync(path.join(singular, 'b.md'), '---\ndescription: b\n---\ntmpl b\n')
      const list = projectCommands(dir)
      expect(list.map(c => c.name)).toEqual(['a'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns [] without a commands dir', () => {
    expect(projectCommands(mkdtempSync(path.join(tmpdir(), 'meow-nopj-')))).toEqual([])
  })
})

describe('uniqueCommands', () => {
  it('dedupes by name keeping first occurrence', () => {
    const a = { name: 'x', description: '', template: '1' }
    const b = { name: 'x', description: '', template: '2' }
    const c = { name: 'y', description: '', template: '3' }
    expect(uniqueCommands([a, b], [c, a])).toEqual([a, c])
  })
})

describe('resolveCommand end-to-end', () => {
  it('resolves template with args and references', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-res-'))
    try {
      writeFileSync(path.join(dir, 'note.txt'), 'hello world')
      const cmd = { name: 'readit', description: '', template: 'Read the file $1 and summarize: @$1' }
      const out = await resolveCommand(cmd, ['note.txt'], { cwd: dir, commands: [] })
      expect(out).toContain('Read the file note.txt')
      expect(out).toContain('hello world')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
