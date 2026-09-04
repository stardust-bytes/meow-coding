import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, clampFontSize, parseFontSize
} from '../../src/renderer/src/font'

describe('font-size helpers', () => {
  it('defaults size constants', () => {
    expect(DEFAULT_FONT_SIZE).toBe(14)
    expect(MIN_FONT_SIZE).toBe(8)
    expect(MAX_FONT_SIZE).toBe(40)
  })

  it('clamps to the allowed range and rounds to integers', () => {
    expect(clampFontSize(5)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(50)).toBe(MAX_FONT_SIZE)
    expect(clampFontSize(16)).toBe(16)
    expect(clampFontSize(14.5)).toBe(15)
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE)
    expect(clampFontSize(Infinity)).toBe(MAX_FONT_SIZE)
  })

  it('parses localStorage values, falling back to default on invalid input', () => {
    expect(parseFontSize(null)).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('16')).toBe(16)
    expect(parseFontSize('')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('abc')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('100')).toBe(MAX_FONT_SIZE)
  })
})
