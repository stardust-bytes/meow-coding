import { describe, expect, it } from 'vitest'
import { buildSpawnCommand } from '../../src/main/pty-manager'

describe('buildSpawnCommand', () => {
  it('keeps posix commands unchanged', () => {
    const r = buildSpawnCommand('opencode', ['--model', 'gpt-5'], 'darwin')
    expect(r).toEqual({ command: 'opencode', args: ['--model', 'gpt-5'] })
  })

  it('wraps a bare npm-shim name in cmd.exe on win32', () => {
    const r = buildSpawnCommand('opencode', ['--model', 'gpt-5'], 'win32')
    expect(r.command).toBe('cmd.exe')
    expect(r.args).toEqual(['/d', '/s', '/c', 'opencode --model gpt-5'])
  })

  it('wraps a .cmd path on win32', () => {
    const r = buildSpawnCommand('C:\\tools\\mycli.cmd', ['-v'], 'win32')
    expect(r.command).toBe('cmd.exe')
    expect(r.args[3]).toBe('C:\\tools\\mycli.cmd -v')
  })

  it('spawns a real .exe directly on win32', () => {
    const r = buildSpawnCommand('C:\\tools\\mycli.exe', ['-v'], 'win32')
    expect(r).toEqual({ command: 'C:\\tools\\mycli.exe', args: ['-v'] })
  })

  it('quotes args that contain spaces on win32', () => {
    const r = buildSpawnCommand('opencode', ['--dir', 'C:\\My Folder'], 'win32')
    expect(r.args[3]).toBe('opencode --dir "C:\\My Folder"')
  })
})
