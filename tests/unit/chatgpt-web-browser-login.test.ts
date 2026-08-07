import { describe, expect, it } from 'vitest'
import { resolveChromeExecutablePath } from '../../src/main/chatgpt-web/browser-login'

describe('resolveChromeExecutablePath', () => {
  it('prefers an explicit override if it exists', () => {
    const result = resolveChromeExecutablePath({
      override: '/custom/chrome',
      platform: 'linux',
      exists: p => p === '/custom/chrome'
    })
    expect(result).toBe('/custom/chrome')
  })

  it('ignores an override that does not exist and falls back to platform defaults', () => {
    const result = resolveChromeExecutablePath({
      override: '/missing/chrome',
      platform: 'linux',
      exists: p => p === '/usr/bin/google-chrome'
    })
    expect(result).toBe('/usr/bin/google-chrome')
  })

  it('checks Windows default install paths', () => {
    const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    const result = resolveChromeExecutablePath({
      platform: 'win32',
      exists: p => p === winPath
    })
    expect(result).toBe(winPath)
  })

  it('checks macOS default install path', () => {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const result = resolveChromeExecutablePath({
      platform: 'darwin',
      exists: p => p === macPath
    })
    expect(result).toBe(macPath)
  })

  it('returns null when nothing is found', () => {
    const result = resolveChromeExecutablePath({ platform: 'linux', exists: () => false })
    expect(result).toBeNull()
  })
})
