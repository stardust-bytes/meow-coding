export interface ResolveChromeOpts {
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
