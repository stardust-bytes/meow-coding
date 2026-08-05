import type { BrowserWindowConstructorOptions } from 'electron'

const TITLE_BAR_HEIGHT = 32
const TITLE_BAR_BG = '#252526'
const TITLE_BAR_SYMBOL = '#cccccc'

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
