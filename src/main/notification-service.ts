import { Notification } from 'electron'

export interface NotifyOptions {
  title: string
  body: string
  agentId?: string
  onActivate?: () => void
}

export class NotificationService {
  private lastShown = new Map<string, number>()

  constructor(private isWindowFocused: () => boolean) {}

  notify(opts: NotifyOptions): void {
    if (this.isWindowFocused()) return
    const now = Date.now()
    const key = opts.agentId ?? 'global'
    const last = this.lastShown.get(key) ?? 0
    if (now - last < 30_000) return
    this.lastShown.set(key, now)
    const n = new Notification({ title: opts.title, body: opts.body, silent: false })
    n.on('click', () => opts.onActivate?.())
    n.show()
  }
}
