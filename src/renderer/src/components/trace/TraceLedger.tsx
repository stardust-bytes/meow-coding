import { memo, useState } from 'react'
import type { ReactNode } from 'react'
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

// One-line label for the row header.
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
    case 'hook': {
      const tool = e.tool ? ` ${e.tool}` : ''
      const dur = e.durationMs != null ? ` ${e.durationMs}ms` : ''
      return `hook ${e.event}${tool} ${e.status}${dur}`
    }
  }
}

// Full content used by search + the expandable detail area.
function searchableText(e: TraceEvent): string {
  switch (e.type) {
    case 'message':
      return `assistant ${e.text ?? ''} ${e.reasoning ?? ''}`
    case 'tool-start':
      return `tool ${e.tool} ${JSON.stringify(e.input ?? {})}`
    case 'tool-result':
      return `tool ${e.tool} ${e.output ?? ''} ${e.error ?? ''}`
    case 'subagent':
      return `subagent ${e.subagentType ?? ''} ${e.taskId} ${e.text ?? ''} ${e.result ?? ''}`
    case 'error':
      return `error ${e.message}`
    case 'done':
      return `done ${e.reason}`
    case 'pty-run':
      return `pty run`
    default:
      return describeEvent(e)
  }
}

// Full content shown when a row is expanded.
function detailContent(e: TraceEvent): ReactNode {
  switch (e.type) {
    case 'message': {
      return (
        <>
          {e.reasoning ? <pre className="trace-detail trace-detail-reasoning">{e.reasoning}</pre> : null}
          {e.text ? <pre className="trace-detail">{e.text}</pre> : null}
        </>
      )
    }
    case 'tool-start':
      return <pre className="trace-detail">{JSON.stringify(e.input ?? {}, null, 2)}</pre>
    case 'tool-result':
      return e.error
        ? <pre className="trace-detail trace-detail-error">{e.error}</pre>
        : <pre className="trace-detail">{e.output ?? ''}</pre>
    case 'subagent':
      return (
        <>
          {e.text ? <pre className="trace-detail">{e.text}</pre> : null}
          {e.result ? <pre className="trace-detail">{e.result}</pre> : null}
        </>
      )
    case 'error':
      return <pre className="trace-detail trace-detail-error">{e.message}</pre>
    case 'compaction':
      return <pre className="trace-detail">{e.summary}</pre>
    default:
      return null
  }
}

function hasDetail(e: TraceEvent): boolean {
  if (e.type === 'message') return Boolean(e.text || e.reasoning)
  if (e.type === 'tool-start') return e.input !== undefined
  if (e.type === 'tool-result') return e.output !== undefined || e.error !== undefined
  if (e.type === 'subagent') return Boolean(e.text || e.result)
  if (e.type === 'error' || e.type === 'compaction') return true
  return false
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
  return searchableText(e).toLowerCase().includes(search.toLowerCase())
}

function TraceLedger({ blocks, folded, selectedSeq, search, onToggleTurn, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const searching = search.trim().length > 0
  // Assistant content is the point of the panel: expanded by default. Tool
  // payloads can be large, so they start collapsed until clicked.
  const isExpanded = (e: TraceEvent) => e.type === 'message' || expanded.has(e.seq)
  const toggle = (seq: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(seq)) next.delete(seq)
      else next.add(seq)
      return next
    })
  }

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
            <div key={e.seq}>
              <div
                className={`trace-row${e.seq === selectedSeq ? ' selected' : ''}`}
                onClick={() => onSelect(e)}
              >
                <span className="trace-row-time">{formatTime(e.ts)}</span>
                <span className="trace-label">{describeEvent(e)}</span>
                {hasDetail(e) && (
                  <button
                    className="trace-row-toggle"
                    aria-label={isExpanded(e) ? 'collapse detail' : 'expand detail'}
                    onClick={ev => { ev.stopPropagation(); toggle(e.seq) }}
                  >
                    {isExpanded(e) ? '▾' : '▸'}
                  </button>
                )}
              </div>
              {isExpanded(e) && hasDetail(e) && detailContent(e)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default memo(TraceLedger)
