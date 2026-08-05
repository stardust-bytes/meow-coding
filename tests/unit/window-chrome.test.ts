import { describe, expect, it } from 'vitest'
import { getWindowChromeOptions } from '../../src/main/window-chrome'

describe('getWindowChromeOptions', () => {
  it('uses a hidden title bar with a colored overlay on Windows', () => {
    const opts = getWindowChromeOptions('win32')
    expect(opts.titleBarStyle).toBe('hidden')
    expect(opts.titleBarOverlay).toEqual({ color: '#252526', symbolColor: '#cccccc', height: 32 })
    expect(opts.frame).toBeUndefined()
  })

  it('insets native traffic lights without recoloring them on macOS', () => {
    const opts = getWindowChromeOptions('darwin')
    expect(opts.titleBarStyle).toBe('hiddenInset')
    expect(opts.trafficLightPosition).toEqual({ x: 12, y: 10 })
    expect(opts.titleBarOverlay).toBeUndefined()
  })

  it('removes the native frame entirely on Linux for custom-drawn controls', () => {
    const opts = getWindowChromeOptions('linux')
    expect(opts.frame).toBe(false)
    expect(opts.titleBarStyle).toBeUndefined()
  })

  it('falls back to the default native frame on unrecognized platforms', () => {
    const opts = getWindowChromeOptions('aix')
    expect(opts.frame).toBe(true)
  })
})
