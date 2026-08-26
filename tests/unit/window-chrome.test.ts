import { describe, expect, it, vi } from 'vitest'
import { applyTitleBarTheme, getWindowChromeOptions } from '../../src/main/window-chrome'

describe('getWindowChromeOptions', () => {
  it('uses a hidden title bar with a colored overlay on Windows', () => {
    const opts = getWindowChromeOptions('win32')
    expect(opts.titleBarStyle).toBe('hidden')
    expect(opts.titleBarOverlay).toEqual({ color: '#0f0f11', symbolColor: '#ffffff', height: 32 })
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

describe('applyTitleBarTheme', () => {
  it('sets the overlay to the light palette for light mode', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'light')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({ color: '#f3f3f3', symbolColor: '#1e1e1e', height: 32 })
  })

  it('sets the overlay to the dark palette for dark mode', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'dark')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({ color: '#0f0f11', symbolColor: '#ffffff', height: 32 })
  })

  it('does nothing on non-Windows platforms', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'linux' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'light')
    expect(setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('does nothing when the window is null', () => {
    vi.stubGlobal('process', { platform: 'win32' })
    expect(() => applyTitleBarTheme(null, 'light')).not.toThrow()
  })
})
