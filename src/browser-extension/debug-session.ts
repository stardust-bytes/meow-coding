export interface DebuggeeLike {
  tabId?: number
}

export interface ChromeDebuggerLike {
  attach(target: DebuggeeLike, requiredVersion: string): Promise<void>
  detach(target: DebuggeeLike): Promise<void>
  sendCommand(target: DebuggeeLike, method: string, commandParams?: object): Promise<unknown>
}

export interface DebugSession {
  ensure(tabId: number): Promise<void>
  close(): Promise<void>
  attachedTabId(): number | null
}

export function createDebugSession(dbg: ChromeDebuggerLike, idleMs = 60_000): DebugSession {
  let debugTabId: number | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { void close() }, idleMs)
  }

  const close = async (): Promise<void> => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (debugTabId != null) {
      await dbg.detach({ tabId: debugTabId }).catch(() => {})
      debugTabId = null
    }
  }

  const ensure = async (tabId: number): Promise<void> => {
    if (debugTabId === tabId) {
      resetIdle()
      return
    }
    await close()
    await dbg.attach({ tabId }, '1.3')
    try {
      await Promise.all([
        dbg.sendCommand({ tabId }, 'DOM.enable'),
        dbg.sendCommand({ tabId }, 'Page.enable'),
        dbg.sendCommand({ tabId }, 'Runtime.enable'),
        dbg.sendCommand({ tabId }, 'Accessibility.enable')
      ])
    } catch (err) {
      await dbg.detach({ tabId }).catch(() => {})
      throw err
    }
    debugTabId = tabId
    resetIdle()
  }

  return {
    ensure,
    close,
    attachedTabId: () => debugTabId
  }
}
