import { Notification } from 'electron'

export interface NotifyOptions {
  title: string
  body: string
  agentId?: string
  /** Distinguishes notification kinds so a per-agent throttle never suppresses
   *  a different kind (e.g. a "needs input" right after "done"). Defaults to
   *  the title so it collapses all callers sharing a title. */
  kind?: string
  onActivate?: () => void
}

export class NotificationService {
  private lastShown = new Map<string, number>()

  constructor(private isWindowFocused: () => boolean) {}

  notify(opts: NotifyOptions): void {
    if (this.isWindowFocused()) return
    const now = Date.now()
    // Throttle per (agent × kind). A single agentId key would make a fresh
    // needs-input notification silent when it follows a "done" notification
    // for the same agent within 30s — the exact case where the user just
    // replied and the agent immediately asks another question.
    const key = `${opts.agentId ?? 'global'}:${opts.kind ?? opts.title}`
    const last = this.lastShown.get(key) ?? 0
    if (now - last < 30_000) return
    this.lastShown.set(key, now)
    const n = new Notification({ title: opts.title, body: opts.body, silent: false })
    n.on('click', () => opts.onActivate?.())
    n.show()
  }
}
