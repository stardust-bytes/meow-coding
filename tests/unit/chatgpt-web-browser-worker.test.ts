import { describe, expect, it, vi } from 'vitest'
import { runChatGptWebTurn, type ChatGptWebPage } from '../../src/main/chatgpt-web/browser-worker'
import { CHATGPT_WEB_EFFORT_LEVELS } from '../../src/main/chatgpt-web/model-catalog'

function fakePage(opts: {
  snapshots: Array<{ hasStopButton: boolean; hasCopyButton: boolean; text: string }>
  dialogText?: string | null
}): ChatGptWebPage {
  let call = 0
  return {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    insertText: vi.fn(async () => {}),
    readDialogText: vi.fn(async () => opts.dialogText ?? null),
    readSnapshot: vi.fn(async () => {
      const snap = opts.snapshots[Math.min(call, opts.snapshots.length - 1)]
      call++
      return snap
    }),
    close: vi.fn(async () => {})
  }
}

describe('runChatGptWebTurn', () => {
  it('polls until complete and returns the final markdown', async () => {
    const page = fakePage({
      snapshots: [
        { hasStopButton: true, hasCopyButton: false, text: 'Thinking' },
        { hasStopButton: true, hasCopyButton: false, text: 'Thinking more' },
        { hasStopButton: false, hasCopyButton: true, text: 'Final answer' }
      ]
    })
    const result = await runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], undefined, { pollIntervalMs: 0 })
    expect(result).toBe('Final answer')
    expect(page.insertText).toHaveBeenCalledWith('hello')
    expect(page.close).toHaveBeenCalled()
  })

  it('throws a rate-limit error when the rate-limit dialog appears', async () => {
    const page = fakePage({
      snapshots: [{ hasStopButton: true, hasCopyButton: false, text: '' }],
      dialogText: 'You are sending messages too quickly.'
    })
    await expect(
      runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], undefined, { pollIntervalMs: 0 })
    ).rejects.toThrow(/rate.limit/i)
    expect(page.close).toHaveBeenCalled()
  })

  it('aborts and closes the page when the signal fires', async () => {
    const controller = new AbortController()
    controller.abort()
    const page = fakePage({ snapshots: [{ hasStopButton: true, hasCopyButton: false, text: '' }] })
    await expect(
      runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], controller.signal, { pollIntervalMs: 0 })
    ).rejects.toThrow(/abort/i)
    expect(page.close).toHaveBeenCalled()
  })
})
