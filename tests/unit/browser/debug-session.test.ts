import { describe, expect, it, vi, afterEach } from 'vitest'
import { createDebugSession } from '../../../src/browser-extension/debug-session'
import type { ChromeDebuggerLike } from '../../../src/browser-extension/debug-session'

function fakeDbg(): ChromeDebuggerLike & { attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn>; sendCommand: ReturnType<typeof vi.fn> } {
  return {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue({})
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDebugSession', () => {
  it('attaches once and enables the four CDP domains', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    expect(dbg.attach).toHaveBeenCalledTimes(1)
    expect(dbg.attach).toHaveBeenCalledWith({ tabId: 10 }, '1.3')
    expect(dbg.sendCommand.mock.calls.map(c => c[1])).toEqual([
      'DOM.enable', 'Page.enable', 'Runtime.enable', 'Accessibility.enable'
    ])
    expect(session.attachedTabId()).toBe(10)
  })

  it('does not re-attach when ensuring the same tab', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.ensure(10)
    expect(dbg.attach).toHaveBeenCalledTimes(1)
  })

  it('closes the previous tab before attaching a new one', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.ensure(20)
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
    expect(dbg.attach).toHaveBeenLastCalledWith({ tabId: 20 }, '1.3')
    expect(session.attachedTabId()).toBe(20)
  })

  it('close detaches and clears state; detach failure is swallowed', async () => {
    const dbg = fakeDbg()
    dbg.detach.mockRejectedValueOnce(new Error('no session'))
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.close()
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
    expect(session.attachedTabId()).toBeNull()
  })

  it('closes itself after the idle timeout', async () => {
    vi.useFakeTimers()
    const dbg = fakeDbg()
    const session = createDebugSession(dbg, 1000)
    await session.ensure(10)
    expect(dbg.detach).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1001)
    await Promise.resolve()
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
  })
})
