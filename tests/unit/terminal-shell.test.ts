import { describe, expect, it } from 'vitest'
import { resolveShell } from '../../src/main/terminal-shell'

describe('resolveShell', () => {
  it('returns cmd.exe on win32', () => {
    expect(resolveShell('win32', {})).toBe('cmd.exe')
  })

  it('uses $SHELL on darwin when set', () => {
    expect(resolveShell('darwin', { SHELL: '/bin/zsh' })).toBe('/bin/zsh')
  })

  it('falls back to /bin/bash on linux', () => {
    expect(resolveShell('linux', {})).toBe('/bin/bash')
  })

  it('uses $SHELL on linux when set', () => {
    expect(resolveShell('linux', { SHELL: '/usr/bin/fish' })).toBe('/usr/bin/fish')
  })
})
