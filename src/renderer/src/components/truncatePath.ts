// Keeps the tail of a long relative path visible: instead of ellipsizing the
// end (`docs/features/…`) it ellipsizes the head so the file name survives
// (`…/features/file.md`). Falls back to char-level trimming when the bare
// basename alone still overflows the available width.
export function truncatePath(path: string, measure: (s: string) => number, maxWidth: number): string {
  if (measure(path) <= maxWidth) return path
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = sep >= 0 ? path.slice(sep + 1) : path
  const prefix = '…/'
  if (measure(prefix + base) <= maxWidth) return prefix + base
  let out = base
  while (out.length > 0 && measure(prefix + out) > maxWidth) out = out.slice(0, -1)
  return prefix + out
}
