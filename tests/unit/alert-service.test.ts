import { describe, expect, it, vi, afterEach } from 'vitest'
import { AlertService } from '../../src/main/alert-service'

afterEach(() => {
  vi.useRealTimers()
})

describe('AlertService', () => {
  it('emits idle when no output for the threshold', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const spy = vi.fn()
    alerts.on('idle', spy)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(150)
    expect(spy).toHaveBeenCalledWith({ agentId: 'a1' })
  })

  it('resets the idle timer on new output', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const spy = vi.fn()
    alerts.on('idle', spy)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(60)
    alerts.onOutput('a1')
    vi.advanceTimersByTime(60)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('emits exit and clears the idle timer', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const idleSpy = vi.fn()
    const exitSpy = vi.fn()
    alerts.on('idle', idleSpy)
    alerts.on('exit', exitSpy)
    alerts.onOutput('a1')
    alerts.onExit('a1', 1)
    vi.advanceTimersByTime(200)
    expect(idleSpy).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith({ agentId: 'a1', exitCode: 1 })
  })

  it('clear stops a pending idle timer for an agent', async () => {
    vi.useFakeTimers()
    const alerts = new AlertService({ idleThresholdMs: 100 })
    const idleSpy = vi.fn()
    alerts.on('idle', idleSpy)
    alerts.onOutput('a1')
    alerts.clear('a1')
    vi.advanceTimersByTime(200)
    expect(idleSpy).not.toHaveBeenCalled()
  })
})
