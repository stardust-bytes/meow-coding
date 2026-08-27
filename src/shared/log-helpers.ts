export function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

export function formatLogArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  return typeof a === 'string' ? a : safeJson(a)
}
