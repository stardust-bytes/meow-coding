import { EventEmitter } from 'node:events'
import * as pty from '@lydell/node-pty'
import kill from 'tree-kill'

export interface PtySession {
  agentId: string
  name: string
  cwd: string
  process: pty.IPty
  pid: number
  kind?: 'agent' | 'terminal' // default 'agent'
}

export interface SpawnCommand {
  command: string
  args: string[]
}

// Windows ConPTY cannot launch bare npm-installed CLI names (opencode, claude,
// aider, ...) because they only exist as .cmd/.bat shims — CreateProcess fails
// with exit code 2 and no output. Run non-.exe commands through cmd.exe instead.
export function buildSpawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): SpawnCommand {
  if (platform !== 'win32') return { command, args }
  if (/\.exe$/i.test(command)) return { command, args }
  const cmdLine = [command, ...args]
    .map(a => (/\s/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
    .join(' ')
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', cmdLine] }
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>()
  private stopping = new Set<string>()

  start(agentId: string, name: string, command: string, args: string[], cwd: string): PtySession {
    if (this.sessions.has(agentId)) throw new Error(`Agent already running: ${agentId}`)
    if (this.stopping.has(agentId)) throw new Error(`Agent is stopping: ${agentId}`)
    const resolved = buildSpawnCommand(command, args)
    return this.spawnSession(agentId, name, resolved.command, resolved.args, cwd, 'agent')
  }

  startTerminal(id: string, shell: string, cwd: string): PtySession {
    if (this.sessions.has(id)) throw new Error(`Terminal already running: ${id}`)
    if (this.stopping.has(id)) throw new Error(`Terminal is stopping: ${id}`)
    return this.spawnSession(id, 'terminal', shell, [], cwd, 'terminal')
  }

  isTerminal(id: string): boolean {
    return this.sessions.get(id)?.kind === 'terminal'
  }

  terminalIds(): string[] {
    return [...this.sessions.values()].filter(s => s.kind === 'terminal').map(s => s.agentId)
  }

  private spawnSession(
    id: string,
    name: string,
    command: string,
    args: string[],
    cwd: string,
    kind: 'agent' | 'terminal'
  ): PtySession {
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: { ...process.env } as Record<string, string>
    })
    const session: PtySession = { agentId: id, name, cwd, process: proc, pid: proc.pid, kind }
    this.sessions.set(id, session)

    proc.onData(data => {
      if (!session.pid) session.pid = proc.pid
      this.emit('data', { agentId: id, data })
    })
    proc.onExit(({ exitCode }) => {
      if (this.sessions.get(id) !== session) return
      this.sessions.delete(id)
      this.emit('exit', { agentId: id, exitCode, kind: session.kind })
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
      const onExit = (e: { agentId: string; kind?: 'agent' | 'terminal' }) => {
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
