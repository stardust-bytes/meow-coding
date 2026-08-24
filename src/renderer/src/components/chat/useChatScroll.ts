import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject, WheelEvent } from 'react'
import {
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
        writeScrollTop(anchorScrollTop({
          currentScrollTop: feed.scrollTop,
          feedTop: feedRect.top,
          rowTop: anchorRect.top,
          scrollHeight: feed.scrollHeight,
          clientHeight: feed.clientHeight
        }))
        pendingAnchorIdRef.current = null
        modeRef.current = nextChatScrollMode(modeRef.current, 'anchor-applied')
      } else if (latestRect) {
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
    if (tailRef.current) tailRef.current.style.height = '0px'
    modeRef.current = nextChatScrollMode(modeRef.current, 'start-turn')
    setShowJumpToEnd(false)
    reconcile()
  }, [reconcile])

  const replaceActiveAnchorId = useCallback((messageId: string) => {
    activeAnchorIdRef.current = messageId
    pendingAnchorIdRef.current = messageId
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
    const feed = feedRef.current
    if (feed) writeScrollTop(feed.scrollHeight)
    modeRef.current = nextChatScrollMode(modeRef.current, 'jump-end')
    setShowJumpToEnd(false)
    reconcile()
  }, [reconcile, writeScrollTop])

  const enterManual = useCallback(() => {
    if (pinRafRef.current !== null) cancelAnimationFrame(pinRafRef.current)
    pinRafRef.current = null
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
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'].includes(event.key)) return
    if (event.key === 'Space') event.preventDefault()
    enterManual()
  }, [enterManual])

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
