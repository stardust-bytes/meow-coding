export const CHAT_TURN_TOP_INSET = 20
export const CHAT_BOTTOM_FOLLOW_ZONE = 80
export const CHAT_FOLLOW_BOTTOM_INSET = 14

export type ChatScrollMode = 'anchoring-turn' | 'following' | 'manual'
export type ChatScrollEvent =
  | 'start-turn'
  | 'anchor-applied'
  | 'user-away'
  | 'user-bottom'
  | 'jump-end'
  | 'session-load'
  | 'content-updated'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function anchorScrollTop(input: {
  currentScrollTop: number
  feedTop: number
  rowTop: number
  scrollHeight: number
  clientHeight: number
}): number {
  const target = input.currentScrollTop + input.rowTop - input.feedTop - CHAT_TURN_TOP_INSET
  return clamp(target, 0, Math.max(0, input.scrollHeight - input.clientHeight))
}

export function isInBottomFollowZone(input: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight <= CHAT_BOTTOM_FOLLOW_ZONE
}

export function tailSpacerHeight(input: {
  clientHeight: number
  anchorTop: number
  latestBottom: number
}): number {
  const turnExtent = Math.max(0, input.latestBottom - input.anchorTop)
  return Math.max(0, input.clientHeight - CHAT_TURN_TOP_INSET - turnExtent)
}

export function nextChatScrollMode(mode: ChatScrollMode, event: ChatScrollEvent): ChatScrollMode {
  if (event === 'session-load' || event === 'jump-end' || event === 'user-bottom') return 'following'
  if (event === 'start-turn') return 'anchoring-turn'
  if (event === 'anchor-applied' && mode === 'anchoring-turn') return 'following'
  if (event === 'user-away') return 'manual'
  return mode
}
