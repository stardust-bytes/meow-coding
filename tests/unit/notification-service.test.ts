import { describe, expect, it, vi, beforeEach } from 'vitest'

const showMock = vi.fn()

vi.mock('electron', () => ({
  Notification: class {
    title: string
    body: string
    constructor(opts: { title: string; body: string }) {
      this.title = opts.title
      this.body = opts.body
    }
    on(): this { return this }
    show(): void { showMock(this.title, this.body) }
  }
}))

import { NotificationService } from '../../src/main/notification-service'

describe('NotificationService', () => {
  beforeEach(() => showMock.mockClear())

  it('shows a notification when the window is not focused', () => {
    const svc = new NotificationService(() => false)
    svc.notify({ title: '[meow] Test', body: 'body', agentId: 'a1' })
    expect(showMock).toHaveBeenCalledTimes(1)
    expect(showMock).toHaveBeenCalledWith('[meow] Test', 'body')
  })

  it('skips the notification when the window is focused', () => {
    const svc = new NotificationService(() => true)
    svc.notify({ title: 't', body: 'b', agentId: 'a1' })
    expect(showMock).not.toHaveBeenCalled()
  })

  it('dedupes notifications for the same agent within 30s', () => {
    const svc = new NotificationService(() => false)
    svc.notify({ title: 't', body: 'b', agentId: 'a1' })
    svc.notify({ title: 't', body: 'b', agentId: 'a1' })
    expect(showMock).toHaveBeenCalledTimes(1)
  })
})
