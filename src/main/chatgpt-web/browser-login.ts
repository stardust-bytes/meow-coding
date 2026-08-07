import type { ChatGptWebSessionStore } from './session-store'

interface ResolveChromeOpts {
  override?: string
  platform: NodeJS.Platform
  exists: (p: string) => boolean
}

const DEFAULT_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

export function resolveChromeExecutablePath(opts: ResolveChromeOpts): string | null {
  if (opts.override && opts.exists(opts.override)) return opts.override
  const candidates = DEFAULT_PATHS[opts.platform] ?? []
  return candidates.find(opts.exists) ?? null
}

// Opens a real, visible Chrome window for the user to log into chatgpt.com
// manually (CAPTCHA/2FA cannot be automated), then persists the session.
// Requires a live browser — verified via the manual smoke test in Task 14,
// not covered by unit tests.
export async function loginToChatGptWeb(
  store: ChatGptWebSessionStore
): Promise<{ authenticated: boolean; verifiedAt: string }> {
  const { existsSync } = await import('node:fs')
  const { chromium } = await import('playwright-core')

  const cfg = store.loadConfig()
  const executablePath = resolveChromeExecutablePath({
    override: cfg.chromeExecutablePath,
    platform: process.platform,
    exists: existsSync
  })
  if (!executablePath) {
    throw new Error('No Chrome installation found. Set a custom Chrome path in Settings.')
  }

  const context = await chromium.launchPersistentContext('', {
    executablePath,
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto('https://chatgpt.com/?temporary-chat=true')
    // Wait for the user to finish signing in manually — presence of the
    // composer is our signal that we're authenticated.
    await page.waitForSelector('#prompt-textarea', { timeout: 5 * 60 * 1000 })

    const state = await context.storageState()
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const path = await import('node:path')
    mkdirSync(path.dirname(store.storageStatePath()), { recursive: true })
    writeFileSync(store.storageStatePath(), JSON.stringify(state, null, 2))

    const marker = { authenticated: true, verifiedAt: new Date().toISOString() }
    store.writeVerifiedMarker(marker)
    return marker
  } finally {
    await context.close()
  }
}
