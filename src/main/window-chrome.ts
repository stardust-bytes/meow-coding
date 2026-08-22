import type { BrowserWindowConstructorOptions } from 'electron'

const TITLE_BAR_HEIGHT = 32
// Match the app's title bar background (--bg-panel: #10141b) and text
// (--text: #cdd3de) so the Windows overlay buttons blend with the theme.
const TITLE_BAR_BG = '#10141b'
const TITLE_BAR_SYMBOL = '#cdd3de'

export function getWindowChromeOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: TITLE_BAR_BG, symbolColor: TITLE_BAR_SYMBOL, height: TITLE_BAR_HEIGHT }
    }
  }
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    }
  }
  if (platform === 'linux') {
    return { frame: false }
  }
  return { frame: true }
}
