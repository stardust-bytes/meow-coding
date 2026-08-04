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
      this.sessions.delete(agentId)
      this.emit('exit', { agentId, exitCode })
    })
    return session
  }

  write(agentId: string, data: string): void {
    const s = this.sessions.get(agentId)
    if (s) s.process.write(data)
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
      const done = () => {
        if (settled) return
        settled = true
        this.stopping.delete(agentId)
        resolve()
      }
      const killSession = () => {
        if (s.pid) {
          kill(s.pid, () => done())
        } else {
          s.process.kill()
          done()
        }
      }
      if (s.pid) {
        killSession()
      } else {
        const deadline = Date.now() + 2000
        const poll = () => {
          if (s.pid) killSession()
          else if (Date.now() >= deadline) killSession()
          else setTimeout(poll, 20)
        }
        poll()
      }
      setTimeout(done, 3000)
    })
  }

  stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    return Promise.all(ids.map(id => this.stop(id))).then(() => undefined)
  }
}
