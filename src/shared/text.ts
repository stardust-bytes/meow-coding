export function appendStreamDelta(buffer: string, delta: string): string {
  if (delta.length === 0) return buffer
  if (buffer.length === 0) return delta
  const max = Math.min(buffer.length, delta.length)
  for (let overlap = max; overlap > 0; overlap--) {
    if (buffer.endsWith(delta.slice(0, overlap))) {
      return buffer + delta.slice(overlap)
    }
  }
  return buffer + delta
}
