export class ChatGptWebTabLimiter {
  private activeCount = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  get active(): number {
    return this.activeCount
  }

  async acquire(): Promise<() => void> {
    if (this.activeCount >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.activeCount++
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeCount--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export interface ChatGptWebDomSnapshot {
  hasStopButton: boolean
  hasCopyButton: boolean
  textLength: number
}

export function isChatGptWebTurnComplete(snapshot: ChatGptWebDomSnapshot): boolean {
  return !snapshot.hasStopButton && snapshot.hasCopyButton && snapshot.textLength > 0
}

const RATE_LIMIT_PATTERNS = [/too (many|quickly)/i, /slow down/i, /try again later/i]

export function isChatGptWebRateLimitDialog(dialogText: string): boolean {
  return RATE_LIMIT_PATTERNS.some(re => re.test(dialogText))
}
