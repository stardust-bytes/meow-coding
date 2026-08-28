import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildTurnReminder, PRECEDENCE_NOTE } from '../../src/main/agent/prompt'
import type { EnvSnapshot } from '../../src/main/agent/env'
import type { MemoryIndex } from '../../src/main/agent/memory'

function env(over: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return { platform: 'win32', shell: 'cmd.exe', cwd: 'C:\\proj', date: '2026-08-29T00:00:00.000Z', git: null, ...over }
}

describe('buildSystemPrompt', () => {
  const args: Parameters<typeof buildSystemPrompt>[0] = {
    baseSystemPrompt: 'You are Meow.',
    modeNote: '\n\nPLAN MODE: read-only.',
    instructionText: 'Instructions from: AGENTS.md\nDo the thing.',
    skillsText: '\n\nSkills available (load one with the skill tool when the task matches its purpose):\n- test: runs tests',
    memoryRules: 'Memory lives in C:\\proj\\.meow\\memory.'
  }

  it('renders every section in order with the precedence note last', () => {
    const out = buildSystemPrompt(args)
    expect(out).toContain('# Identity & how to work\n\nYou are Meow.')
    expect(out).toContain('# Project instructions\n\nInstructions from: AGENTS.md')
    expect(out).toContain('# Memory\n\nMemory lives in')
    expect(out).toContain('# Skills\n\nSkills available')
    expect(out).toContain('# Mode & permissions\n\nPLAN MODE: read-only.')
    expect(out.endsWith(PRECEDENCE_NOTE)).toBe(true)
    const order = ['# Identity', '# Project', '# Memory', '# Skills', '# Mode'].map(h => out.indexOf(h))
    expect(order.every((v, i) => i === 0 || order[i - 1] < v)).toBe(true)
  })

  it('skips empty sections (build mode has no mode note)', () => {
    const out = buildSystemPrompt({ ...args, modeNote: '' })
    expect(out).not.toContain('# Mode & permissions')
    expect(out).toContain('# Identity & how to work')
  })

  it('skips the memory section when memory rules are empty (toggle off)', () => {
    const out = buildSystemPrompt({ ...args, memoryRules: '' })
    expect(out).not.toContain('# Memory')
  })
})

describe('buildTurnReminder', () => {
  const index: MemoryIndex = { path: 'C:\\proj\\.meow\\memory\\MEMORY.md', lines: [], truncated: false }

  it('includes the environment and git state', () => {
    const out = buildTurnReminder(env({ git: { branch: 'main', dirtyCount: 2 } }), index)
    expect(out).toContain('<system-reminder>')
    expect(out).toContain('platform=win32')
    expect(out).toContain('cwd=C:\\proj')
    expect(out).toContain('Git: on main, 2 dirty file(s).')
    expect(out.endsWith('</system-reminder>')).toBe(true)
  })

  it('omits the git line when git is null', () => {
    expect(buildTurnReminder(env(), index)).not.toContain('Git:')
  })

  it('includes the memory index lines and truncation flag', () => {
    const out = buildTurnReminder(env(), { ...index, lines: ['- [A](a.md) — a hook'], truncated: true })
    expect(out).toContain('Memory index (C:\\proj\\.meow\\memory\\MEMORY.md):')
    expect(out).toContain('- [A](a.md) — a hook')
    expect(out).toContain('(index truncated)')
  })

  it('omits the memory block when the index is empty', () => {
    expect(buildTurnReminder(env(), index)).not.toContain('Memory index')
  })
})
