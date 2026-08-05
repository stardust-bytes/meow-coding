import type { TranscriptItem } from './message'

function itemSize(item: TranscriptItem): number {
  if (item.kind === 'message') return item.message.text.length + 40
  const call = item.tool
  return call.tool.length
    + JSON.stringify(call.input ?? {}).length
    + (call.output ?? call.error ?? '').length
    + 40
}

// Room left for the assistant message that issued a truncated tool call, so the
// pair stays coherent and is not stripped as an orphan tool result.
const PAIRING_RESERVE = 200

function truncateToFit(item: TranscriptItem, budget: number): TranscriptItem | null {
  if (budget <= 40) return null
  if (item.kind === 'message') {
    const keep = item.message.text.slice(0, budget - 40)
    if (!keep) return null
    return { ...item, message: { ...item.message, text: keep } }
  }
  const call = item.tool
  const base = call.tool.length + JSON.stringify(call.input ?? {}).length + 40
  const room = budget - base
  if (room <= 0) return null
  const keep = (call.output ?? call.error ?? '').slice(0, room)
  if (!keep) return null
  return { ...item, tool: { ...call, output: keep, error: undefined } }
}

export function pruneTranscript(items: TranscriptItem[], maxChars: number): TranscriptItem[] {
  if (maxChars <= 0) return items
  let total = 0
  for (const i of items) total += itemSize(i)
  if (total <= maxChars) return items

  const kept: TranscriptItem[] = []
  let keptSize = 0

  // Seed with the latest user message so the model always keeps the instruction.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'message' && item.message.role === 'user') {
      kept.unshift(item)
      keptSize = itemSize(item)
      break
    }
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (kept.includes(item)) continue
    const size = itemSize(item)
    if (keptSize + size <= maxChars) {
      kept.unshift(item)
      keptSize += size
    } else if (kept.length === 1) {
      // Newest item alone exceeds the budget (e.g. a large file read): keep a
      // truncated prefix (reserving room for the issuing assistant message)
      // instead of dropping it, so the model does not forget what it just read
      // and re-read it every turn.
      const fit = truncateToFit(item, maxChars - keptSize - PAIRING_RESERVE)
      if (fit && itemSize(fit) > 0) {
        kept.unshift(fit)
        keptSize += itemSize(fit)
      } else {
        break
      }
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
