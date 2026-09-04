export const DEFAULT_FONT_SIZE = 14
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 40
export const FONT_SIZE_STORAGE_KEY = 'meow.fontSize'
export const FONT_SIZE_CHANGE_EVENT = 'meow:fontsize'

/** Round to an integer and clamp to the allowed range (8–40px). */
export function clampFontSize(size: number): number {
  if (Number.isNaN(size)) return DEFAULT_FONT_SIZE
  const rounded = Math.round(size)
  if (rounded < MIN_FONT_SIZE) return MIN_FONT_SIZE
  if (rounded > MAX_FONT_SIZE) return MAX_FONT_SIZE
  return rounded
}

/** Parse a raw localStorage string; fall back to the default when invalid. */
export function parseFontSize(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_FONT_SIZE
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE
  return clampFontSize(n)
}
