import type { TranscriptItem } from './message'

function itemSize(item: TranscriptItem): number {
  if (item.kind === 'message') return item.message.text.length + 40
  const call = item.tool
  return call.tool.length
    + JSON.stringify(call.input ?? {}).length
    + (call.output ?? call.error ?? '').length
    + 40
}

export function pruneTranscript(items: TranscriptItem[], maxChars: number): TranscriptItem[] {
  if (maxChars <= 0) return items
  let total = 0
  for (const i of items) total += itemSize(i)
  if (total <= maxChars) return items

  const kept: TranscriptItem[] = []
  let keptSize = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    const size = itemSize(item)
    const isUser = item.kind === 'message' && item.message.role === 'user'
    const keepLastUser = kept.length === 0 && isUser
    if (keptSize + size <= maxChars || keepLastUser) {
      kept.unshift(item)
      keptSize += size
    } else {
      break
    }
  }
  while (kept.length > 0 && kept[0].kind === 'tool') kept.shift()
  if (kept.length === 0) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'message' && item.message.role === 'user') return [item]
    }
    return items
  }
  return kept
}
