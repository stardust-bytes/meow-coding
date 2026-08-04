import { EventEmitter } from 'node:events'
import * as pty from '@lydell/node-pty'
import kill from 'tree-kill'

export interface PtySession {
  agentId: string
  name: string
  cwd: string
  process: pty.IPty
  pid: number
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>()
  private stopping = new Set<string>()

  start(agentId: string, name: string, command: string, args: string[], cwd: string): PtySession {
    if (this.sessions.has(agentId)) throw new Error(`Agent already running: ${agentId}`)
    if (this.stopping.has(agentId)) throw new Error(`Agent is stopping: ${agentId}`)
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: { ...process.env } as Record<string, string>
    })
    const session: PtySession = { agentId, name, cwd, process: proc, pid: proc.pid }
    this.sessions.set(agentId, session)

    proc.onData(data => {
      if (!session.pid) session.pid = proc.pid
      this.emit('data', { agentId, data })
    })
    proc.onExit(({ exitCode }) => {
      if (this.sessions.get(agentId) !== session) return
      this.sessions.delete(agentId)
      this.emit('exit', { agentId, exitCode })
    })
    return session
  }

  write(agentId: string, data: string): void {
    const s = this.sessions.get(agentId)
    if (!s) return
    const normalized = process.platform === 'win32'
      ? data.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
      : data
    s.process.write(normalized)
  }

  resize(agentId: string, cols: number, rows: number): void {
    const s = this.sessions.get(agentId)
    if (s) s.process.resize(cols, rows)
  }

  isRunning(agentId: string): boolean {
    return this.sessions.has(agentId)
  }

  stop(agentId: string): Promise<void> {
    const s = this.sessions.get(agentId)
    if (!s) return Promise.resolve()
    this.stopping.add(agentId)
    return new Promise<void>(resolve => {
      let settled = false
      let timer: NodeJS.Timeout | null = null
      const onExit = (e: { agentId: string }) => {
        if (e.agentId === agentId) done()
      }
      const done = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.removeListener('exit', onExit)
        this.stopping.delete(agentId)
        resolve()
      }
      this.on('exit', onExit)
      timer = setTimeout(() => {
        try {
          s.process.kill()
        } catch {
          /* already dead */
        }
        this.sessions.delete(agentId)
        done()
      }, 3000)
      this.killProcess(s)
    })
  }

  private killProcess(s: PtySession): void {
    if (s.pid) {
      // POSIX: real shell pid → tree-kill descends the whole process tree.
      // Windows: pid is populated once the pty connects; tree-kill uses taskkill /T /F.
      kill(s.pid, (err) => {
        if (err) console.error(`[pty] tree-kill failed for ${s.agentId} (pid ${s.pid}):`, err)
      })
    } else {
      // Windows ConPTY before the pty is ready (pid 0): node-pty's kill() targets
      // the console process group, which includes console-attached children.
      try {
        s.process.kill()
      } catch {
        /* already dead */
      }
    }
  }

  stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    return Promise.all(ids.map(id => this.stop(id))).then(() => undefined)
  }
}
