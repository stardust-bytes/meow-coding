import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PtyManager } from '../../src/main/pty-manager'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'echo-agent.js')

describe('PtyManager windows shim spawn', () => {
  it.skipIf(process.platform !== 'win32')('runs a bare npm-style .cmd shim command', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-shim-'))
    const managers: PtyManager[] = []
    const originalPath = process.env.PATH
    try {
      writeFileSync(path.join(dir, 'fakeshim.cmd'), '@echo off\r\necho SHIM_OK\r\nexit /b 0\r\n')
      process.env.PATH = dir + path.delimiter + (process.env.PATH ?? '')

      const pty = new PtyManager()
      managers.push(pty)
      const data: string[] = []
      pty.on('data', ({ data: d }) => data.push(d))

      pty.start('a1', 'shim', 'fakeshim', [], dir)

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting SHIM_OK')), 10000)
        const check = () => {
          if (data.some(d => d.includes('SHIM_OK'))) {
            clearTimeout(t)
            resolve()
          } else {
            setTimeout(check, 50)
          }
        }
        check()
      })
      expect(data.join('')).toContain('SHIM_OK')
    } finally {
      await Promise.all(managers.map(m => m.stopAll()))
      process.env.PATH = originalPath
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('PtyManager', () => {
  const managers: PtyManager[] = []

  afterEach(async () => {
    await Promise.all(managers.map(m => m.stopAll()))
    managers.length = 0
  })

  it('spawns a CLI and streams output', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for READY')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(data.join('')).toContain('READY')
  })

  it('writes input and receives echoed data', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          pty.write('a1', 'hi\r')
          resolve()
          clearTimeout(t)
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting echo')), 10000)
      const check = () => {
        if (data.some(d => d.includes('echo:hi'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  })

  it('emits exit when stopped and removes the session', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const exited: { agentId: string; exitCode: number; kind?: 'agent' | 'terminal' }[] = []
    pty.on('exit', e => exited.push(e))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await pty.stop('a1')
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting exit')), 10000)
      const check = () => {
        if (exited.length > 0) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(exited[0].agentId).toBe('a1')
    expect(exited[0].kind).toBe('agent')
    expect(pty.isRunning('a1')).toBe(false)
  })

  it('allows restart immediately after stop', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await pty.stop('a1')
    expect(() => pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())).not.toThrow()
    await pty.stop('a1')
  })

  it('startTerminal spawns a real shell and tracks it as terminal', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-term-'))
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    const id = 'term1'
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.startTerminal(id, shell, dir)

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting first data')), 10000)
      const check = () => {
        if (data.length > 0) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(pty.isTerminal(id)).toBe(true)
    expect(pty.terminalIds()).toContain(id)

    await pty.stop(id)
    expect(pty.isRunning(id)).toBe(false)
    expect(pty.isTerminal(id)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('terminal exit events carry kind: terminal', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-term-exit-'))
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    const id = 'term-exit-1'
    const exited: { agentId: string; exitCode: number; kind?: 'agent' | 'terminal' }[] = []
    pty.on('exit', e => exited.push(e))

    pty.startTerminal(id, shell, dir)
    await pty.stop(id)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting exit')), 10000)
      const check = () => {
        if (exited.length > 0) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(exited[0].agentId).toBe(id)
    expect(exited[0].kind).toBe('terminal')
    expect(pty.isRunning(id)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('start() sessions are not terminals', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    expect(pty.isTerminal('a1')).toBe(false)
    expect(pty.terminalIds()).not.toContain('a1')
  })
})
