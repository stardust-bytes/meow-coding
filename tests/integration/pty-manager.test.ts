import { describe, expect, it, afterEach } from 'vitest'
import path from 'node:path'
import { PtyManager } from '../../src/main/pty-manager'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'echo-agent.js')

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
    const exited: { agentId: string; exitCode: number }[] = []
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
})
