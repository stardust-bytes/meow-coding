import { memo } from 'react'
import type { TraceEvent } from '@shared/types'

export interface TurnBlock {
  turn: number
  events: TraceEvent[]
}

interface Props {
  blocks: TurnBlock[]
  folded: Set<number>
  selectedSeq?: number
  search: string
  onToggleTurn: (turn: number) => void
  onSelect: (e: TraceEvent) => void
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}

function preview(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

export function describeEvent(e: TraceEvent): string {
  switch (e.type) {
    case 'turn-started':
      return 'turn started'
    case 'message': {
      const text = e.text?.trim() ?? ''
      return text ? `assistant ${preview(text, 80)}` : 'assistant (reasoning)'
    }
    case 'tool-start':
      return `tool ${e.tool} ${preview(JSON.stringify(e.input ?? {}), 100)}`
    case 'tool-result': {
      const err = e.error ? ' [err]' : ''
      return `✓ ${e.tool} ${e.durationMs}ms${err}`
    }
    case 'subagent':
      return `▸ ${e.subagentType ?? 'subagent'} (${e.taskId.slice(0, 8)}) ${e.state}`
    case 'compaction':
      return 'compaction'
    case 'error':
      return `error: ${preview(e.message, 120)}`
    case 'done': {
      const cost = e.cost !== undefined ? ` · $${e.cost.toFixed(4)}` : ''
      return `done (${e.reason})${cost}`
    }
    case 'pty-run': {
      const exit = e.exitCode != null ? ` exit ${e.exitCode}` : ''
      const dur = e.durationMs != null ? ` ${e.durationMs}ms` : ''
      return `pty run${exit}${dur}`
    }
  }
}

function turnTokens(events: TraceEvent[]): number | undefined {
  let total = 0
  let found = false
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'done') continue
    if (e.tokens?.total != null) {
      total += e.tokens.total
      found = true
    }
  }
  return found ? total : undefined
}

function turnHeader(block: TurnBlock): string {
  const parts = [`Turn ${block.turn}`, formatTime(block.events[0].ts), `${block.events.length} steps`]
  const tokens = turnTokens(block.events)
  if (tokens !== undefined) parts.push(`${tokens.toLocaleString()} tokens`)
  return parts.join(' · ')
}

function matches(e: TraceEvent, search: string): boolean {
  if (!search) return true
  return describeEvent(e).toLowerCase().includes(search.toLowerCase())
}

function TraceLedger({ blocks, folded, selectedSeq, search, onToggleTurn, onSelect }: Props) {
  const searching = search.trim().length > 0
  const rows = blocks
    .map(block => ({
      block,
      isFolded: !searching && folded.has(block.turn),
      visible: searching ? block.events.filter(e => matches(e, search)) : block.events
    }))
    .filter(r => r.visible.length > 0)

  return (
    <div className="trace-ledger">
      {rows.map(({ block, isFolded, visible }) => (
        <div key={block.turn} className="trace-block">
          <div className="trace-turn-header" onClick={() => onToggleTurn(block.turn)}>
            <span className="trace-caret">{isFolded ? '▸' : '▾'}</span>
            <span className="trace-label">{turnHeader(block)}</span>
          </div>
          {!isFolded && visible.map(e => (
            <div
              key={e.seq}
              className={`trace-row${e.seq === selectedSeq ? ' selected' : ''}`}
              onClick={() => onSelect(e)}
            >
              <span className="trace-row-time">{formatTime(e.ts)}</span>
              <span className="trace-label">{describeEvent(e)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default memo(TraceLedger)
