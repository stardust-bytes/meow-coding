import TurndownService from 'turndown'
import { ChatGptWebTabLimiter, isChatGptWebTurnComplete, isChatGptWebRateLimitDialog } from './turn-state'
import type { ChatGptWebEffortLevel } from './model-catalog'

// CONFIRM LIVE against chatgpt.com before relying on this in production — see Task 7 note above.
export const SELECTORS = {
  composer: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  effortMenuTrigger: '[data-testid="model-switcher-dropdown-button"]',
  effortMenuItem: (index: number) => `[role="menuitemradio"]:nth-of-type(${index + 1})`,
  stopButton: '[data-testid="stop-button"]',
  copyButton: '[data-testid="copy-turn-action-button"]',
  answerRoot: '.markdown.prose:last-of-type',
  dialog: '[role="alertdialog"], [role="dialog"]'
}

export interface ChatGptWebPage {
  goto(url: string): Promise<void>
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<void>
  click(selector: string): Promise<void>
  insertText(text: string): Promise<void>
  readDialogText(): Promise<string | null>
  readSnapshot(): Promise<{ hasStopButton: boolean; hasCopyButton: boolean; text: string }>
  title(): Promise<string>
  url(): string
  close(): Promise<void>
}

export const CHATGPT_WEB_TAB_LIMITER = new ChatGptWebTabLimiter(3)

import type { ChallengeReason } from '../../shared/ipc'

export interface RunTurnOptions {
  pollIntervalMs?: number
  timeoutMs?: number
  onFallback?: (reason: ChallengeReason) => void
}

export async function runChatGptWebTurn(
  page: ChatGptWebPage,
  recreate: (mode: PageMode) => Promise<ChatGptWebPage>,
  prompt: string,
  effort: ChatGptWebEffortLevel,
  signal?: AbortSignal,
  options: RunTurnOptions = {}
): Promise<string> {
  return runTurnBody(page, recreate, prompt, effort, signal, options)
}

async function runTurnBody(
  page: ChatGptWebPage,
  recreate: (mode: PageMode) => Promise<ChatGptWebPage>,
  prompt: string,
  effort: ChatGptWebEffortLevel,
  signal: AbortSignal | undefined,
  options: RunTurnOptions
): Promise<string> {
  const pollIntervalMs = options.pollIntervalMs ?? 400
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  const deadline = Date.now() + timeoutMs

  try {
    if (signal?.aborted) throw new Error('aborted before turn started')

    await page.goto('https://chatgpt.com/?temporary-chat=true')
    try {
      await page.waitForSelector(SELECTORS.composer)
    } catch (err) {
      const title = (await page.title()).toLowerCase()
      if (title.includes('just a moment')) {
        options.onFallback?.('cloudflare')
        await page.close()
        page = await recreate('visible')
        await page.waitForSelector(SELECTORS.composer, { timeout: 5 * 60 * 1000 })
      } else if (page.url().includes('/auth/login')) {
        throw new Error('[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.')
      } else {
        throw err
      }
    }
    await page.click(SELECTORS.effortMenuTrigger)
    await page.click(SELECTORS.effortMenuItem(effort.uiEffortIndex))
    await page.insertText(prompt)
    await page.click(SELECTORS.sendButton)

    while (true) {
      if (signal?.aborted) throw new Error('aborted during turn')
      if (Date.now() > deadline) throw new Error('chatgpt-web turn timed out')

      const dialogText = await page.readDialogText()
      if (dialogText && isChatGptWebRateLimitDialog(dialogText)) {
        throw new Error(`chatgpt-web rate limit: ${dialogText}`)
      }

      const snapshot = await page.readSnapshot()
      if (isChatGptWebTurnComplete({
        hasStopButton: snapshot.hasStopButton,
        hasCopyButton: snapshot.hasCopyButton,
        textLength: snapshot.text.length
      })) {
        return snapshot.text
      }

      if (pollIntervalMs > 0) await new Promise(r => setTimeout(r, pollIntervalMs))
    }
  } finally {
    await page.close()
  }
}

// Bridges a real Playwright Page to the narrow ChatGptWebPage interface above.
// Not unit tested (requires a live browser) — covered by the manual smoke test
// in Task 14.
export function wrapPlaywrightPage(page: import('playwright-core').Page): ChatGptWebPage {
  return {
    goto: url => page.goto(url).then(() => undefined),
    waitForSelector: (selector, opts) => page.waitForSelector(selector, opts).then(() => undefined),
    click: selector => page.click(selector),
    insertText: text => page.keyboard.insertText(text),
    readDialogText: () => page.locator(SELECTORS.dialog).first().textContent(),
    readSnapshot: async () => {
      const html = await page.locator(SELECTORS.answerRoot).last().innerHTML().catch(() => '')
      return {
        hasStopButton: await page.locator(SELECTORS.stopButton).count() > 0,
        hasCopyButton: await page.locator(SELECTORS.copyButton).count() > 0,
        text: new TurndownService({ codeBlockStyle: 'fenced' }).turndown(html)
      }
    },
    title: () => page.title(),
    url: () => page.url(),
    close: () => page.close()
  }
}

export type PageMode = 'headless' | 'visible'

export async function createChatGptWebPage(
  userDataDir: string,
  storageStatePath: string,
  chromeExecutablePath?: string,
  mode: PageMode = 'headless'
): Promise<ChatGptWebPage> {
  const { existsSync, mkdirSync } = await import('node:fs')
  const { chromium } = await import('playwright-core')
  const { resolveChromeExecutablePath } = await import('./browser-login')

  const executablePath = resolveChromeExecutablePath({
    override: chromeExecutablePath,
    platform: process.platform,
    exists: existsSync
  })
  if (!executablePath) {
    throw new Error('No Chrome installation found. Set a custom Chrome path in Settings.')
  }
  mkdirSync(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: mode === 'headless'
  })
  const page = context.pages()[0] ?? (await context.newPage())
  return wrapPlaywrightPage(page)
}
