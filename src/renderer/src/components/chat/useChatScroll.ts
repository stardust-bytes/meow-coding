import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject, WheelEvent } from 'react'
import {
  CHAT_TURN_TOP_INSET,
  anchorScrollTop,
  followScrollDelta,
  isInBottomFollowZone,
  nextChatScrollMode,
  tailSpacerHeight
} from './chat-scroll-geometry'
import type { ChatScrollMode } from './chat-scroll-geometry'

export interface ChatScrollController {
  feedRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  latestRef: RefObject<HTMLDivElement | null>
  tailRef: RefObject<HTMLDivElement | null>
  endRef: RefObject<HTMLDivElement | null>
  showJumpToEnd: boolean
  startTurnAnchor(messageId: string): void
  replaceActiveAnchorId(messageId: string): void
  reconcile(): void
  pinSessionToEnd(): void
  jumpToEnd(): void
  onScroll(): void
  onWheel(event: WheelEvent<HTMLDivElement>): void
  onTouchMove(): void
  onPointerDown(event: PointerEvent<HTMLDivElement>): void
  onPointerUp(event: PointerEvent<HTMLDivElement>): void
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void
}

export function useChatScroll(): ChatScrollController {
  const feedRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<ChatScrollMode>('following')
  const activeAnchorIdRef = useRef<string | null>(null)
  const pendingAnchorIdRef = useRef<string | null>(null)
  const programmaticRef = useRef(false)
  const scrollbarDragRef = useRef(false)
  const reconcileRafRef = useRef<number | null>(null)
  const pinRafRef = useRef<number | null>(null)
  // The anchor is re-applied until the layout settles (content-visibility rows
  // can keep shifting the row's document position for a couple of seconds);
  // the turnExtent condition below is the real terminator, this is a safety cap.
  const anchorRetriesRef = useRef(0)
  const [showJumpToEnd, setShowJumpToEnd] = useState(false)

  const writeScrollTop = useCallback((top: number) => {
    const feed = feedRef.current
    if (!feed) return
    programmaticRef.current = true
    feed.scrollTop = top
    requestAnimationFrame(() => { programmaticRef.current = false })
  }, [])

  const findAnchor = useCallback(() => {
    const id = activeAnchorIdRef.current
    if (!id) return null
    return Array.from(feedRef.current?.querySelectorAll<HTMLElement>('[data-chat-message-id]') ?? [])
      .find(row => row.dataset.chatMessageId === id) ?? null
  }, [])

  const isAtBottom = useCallback(() => {
    const feed = feedRef.current
    if (!feed) return false
    return isInBottomFollowZone({
      scrollHeight: feed.scrollHeight,
      scrollTop: feed.scrollTop,
      clientHeight: feed.clientHeight
    })
  }, [])

  const reconcile = useCallback(() => {
    if (reconcileRafRef.current != null) return
    reconcileRafRef.current = requestAnimationFrame(() => {
      reconcileRafRef.current = null
      const feed = feedRef.current
      if (!feed || modeRef.current === 'manual') return
      const feedRect = feed.getBoundingClientRect()
      const anchor = findAnchor()
      const anchorRect = anchor?.getBoundingClientRect()
      const latestRect = latestRef.current?.getBoundingClientRect()
      if (anchorRect && latestRect) {
        const height = `${tailSpacerHeight({
          clientHeight: feed.clientHeight,
          anchorTop: anchorRect.top - feedRect.top,
          latestBottom: latestRect.bottom - feedRect.top
        })}px`
        const tail = tailRef.current
        if (tail && tail.style.height !== height) tail.style.height = height
      }
      const pendingId = pendingAnchorIdRef.current
      if (pendingId != null) {
        if (!anchorRect) return
        const currentScrollTop = feed.scrollTop
        const target = anchorScrollTop({
          currentScrollTop,
          feedTop: feedRect.top,
          rowTop: anchorRect.top,
          scrollHeight: feed.scrollHeight,
          clientHeight: feed.clientHeight
        })
        writeScrollTop(target)
        const anchorTop = anchorRect.top - feedRect.top
        const turnExtent = latestRect ? latestRect.bottom - anchorRect.top : 0
        // Layout settles a few frames after the write (content-visibility rows,
        // the running indicator, echo replacement), and the browser can clamp
        // scrollTop when the content shrinks — undoing the anchor. Hold the
        // anchor until the row actually sits at the inset and the turn still
        // fits the viewport; once it grows past the viewport, follow normally.
        // A target outside the scrollable range means the anchor can never
        // reach the inset (content too short, or the turn already fills the
        // viewport) — stop retrying instead of burning frames.
        const maxScroll = Math.max(0, feed.scrollHeight - feed.clientHeight)
        const rawTarget = currentScrollTop + anchorTop - CHAT_TURN_TOP_INSET
        const pinnable = rawTarget >= 0 && rawTarget <= maxScroll
        if (Math.abs(anchorTop - CHAT_TURN_TOP_INSET) > 2
          && turnExtent <= feed.clientHeight - CHAT_TURN_TOP_INSET
          && pinnable
          && anchorRetriesRef.current < 300) {
          anchorRetriesRef.current += 1
          reconcile()
          return
        }
        anchorRetriesRef.current = 0
        pendingAnchorIdRef.current = null
        modeRef.current = nextChatScrollMode(modeRef.current, 'anchor-applied')
      } else if (latestRect) {
        if (!anchorRect && tailRef.current && tailRef.current.style.height !== '0px') {
          // No turn anchor: dissolve any leftover tail spacer so the transcript
          // ends at the boundary instead of leaving blank space after resume.
          tailRef.current.style.height = '0px'
        }
        const delta = followScrollDelta({ feedBottom: feedRect.bottom, latestBottom: latestRect.bottom })
        if (delta > 0) writeScrollTop(feed.scrollTop + delta)
      }
    })
  }, [findAnchor, writeScrollTop])

  const startTurnAnchor = useCallback((messageId: string) => {
    if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
    pinRafRef.current = null
    activeAnchorIdRef.current = messageId
    pendingAnchorIdRef.current = messageId
    anchorRetriesRef.current = 0
    if (tailRef.current) tailRef.current.style.height = '0px'
    modeRef.current = nextChatScrollMode(modeRef.current, 'start-turn')
    setShowJumpToEnd(false)
    reconcile()
  }, [reconcile])

  const replaceActiveAnchorId = useCallback((messageId: string) => {
    activeAnchorIdRef.current = messageId
    pendingAnchorIdRef.current = messageId
    anchorRetriesRef.current = 0
  }, [])

  const pinSessionToEnd = useCallback(() => {
    if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
    pinRafRef.current = null
    activeAnchorIdRef.current = null
    pendingAnchorIdRef.current = null
    if (tailRef.current) tailRef.current.style.height = '0px'
    modeRef.current = nextChatScrollMode(modeRef.current, 'session-load')
    setShowJumpToEnd(false)
    let frame = 0
    const settle = () => {
      const feed = feedRef.current
      if (feed) writeScrollTop(feed.scrollHeight)
      frame += 1
      if (frame < 60) {
        pinRafRef.current = requestAnimationFrame(settle)
      } else {
        pinRafRef.current = null
      }
    }
    pinRafRef.current = requestAnimationFrame(settle)
  }, [writeScrollTop])

  const jumpToEnd = useCallback(() => {
    if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
    pinRafRef.current = null
    activeAnchorIdRef.current = null
    pendingAnchorIdRef.current = null
    anchorRetriesRef.current = 0
    if (tailRef.current) tailRef.current.style.height = '0px'
    const feed = feedRef.current
    if (feed) writeScrollTop(feed.scrollHeight)
    modeRef.current = nextChatScrollMode(modeRef.current, 'jump-end')
    setShowJumpToEnd(false)
    reconcile()
  }, [reconcile, writeScrollTop])

  const enterManual = useCallback(() => {
    if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
    pinRafRef.current = null
    // The user took ownership: the turn anchor is done. Clearing it prevents a
    // stale anchor/tail from shrinking the content (and jumping the viewport)
    // when following resumes from the bottom zone, and stops the re-anchor loop.
    activeAnchorIdRef.current = null
    pendingAnchorIdRef.current = null
    anchorRetriesRef.current = 0
    modeRef.current = nextChatScrollMode(modeRef.current, 'user-away')
    setShowJumpToEnd(true)
  }, [])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0 || !isAtBottom()) enterManual()
  }, [enterManual, isAtBottom])

  const onTouchMove = useCallback(() => { enterManual() }, [enterManual])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const feed = feedRef.current
    if (!feed) return
    const rect = feed.getBoundingClientRect()
    if (event.clientX > rect.right - Math.max(feed.offsetWidth - feed.clientWidth, 12)) {
      scrollbarDragRef.current = true
      feed.setPointerCapture?.(event.pointerId)
    }
  }, [])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    scrollbarDragRef.current = false
    const feed = feedRef.current
    if (feed?.hasPointerCapture?.(event.pointerId)) {
      feed.releasePointerCapture?.(event.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const key = event.key
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'].includes(key)) return
    // Keys that scroll toward the bottom do not leave the follow zone when the
    // feed is already there; keep following instead of showing the jump button.
    if (['ArrowDown', 'PageDown', 'End', 'Space'].includes(key) && isAtBottom()) return
    enterManual()
  }, [enterManual, isAtBottom])

  const onScroll = useCallback(() => {
    if (programmaticRef.current) return
    if (isAtBottom()) {
      modeRef.current = nextChatScrollMode(modeRef.current, 'user-bottom')
      setShowJumpToEnd(false)
    } else if (scrollbarDragRef.current) {
      enterManual()
    }
  }, [enterManual, isAtBottom])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => { reconcile() })
    observer.observe(content)
    return () => {
      observer.disconnect()
      if (reconcileRafRef.current !== null) cancelAnimationFrame(reconcileRafRef.current)
      reconcileRafRef.current = null
      if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
      pinRafRef.current = null
      programmaticRef.current = false
      anchorRetriesRef.current = 0
    }
  }, [reconcile])

  return {
    feedRef,
    contentRef,
    latestRef,
    tailRef,
    endRef,
    showJumpToEnd,
    startTurnAnchor,
    replaceActiveAnchorId,
    reconcile,
    pinSessionToEnd,
    jumpToEnd,
    onScroll,
    onWheel,
    onTouchMove,
    onPointerDown,
    onPointerUp,
    onKeyDown
  }
}
