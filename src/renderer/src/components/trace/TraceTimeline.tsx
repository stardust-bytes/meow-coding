import { memo, useMemo } from 'react'
import type { TurnBlock } from './TraceLedger'
import { formatTime } from './TraceLedger'

interface Props {
  turns: TurnBlock[]
  onSelectTurn: (turn: number) => void
}

function TraceTimeline({ turns, onSelectTurn }: Props) {
  const segments = useMemo(() => {
    if (turns.length === 0) return []
    const items = turns.map(t => {
      let min = Infinity
      let max = -Infinity
      for (const e of t.events) {
        if (e.ts < min) min = e.ts
        if (e.ts > max) max = e.ts
      }
      return { turn: t.turn, durationMs: max - min, firstTs: t.events[0].ts }
    })
    const weights = items.map(i => Math.max(i.durationMs, 1))
    const total = weights.reduce((a, b) => a + b, 0)
    return items.map((i, idx) => ({ ...i, widthPct: (weights[idx] / total) * 100 }))
  }, [turns])

  if (segments.length === 0) return null

  return (
    <div className="trace-timeline">
      {segments.map(s => (
        <div
          key={s.turn}
          className="trace-timeline-seg"
          style={{ width: `${s.widthPct}%` }}
          title={`Turn ${s.turn} · ${formatTime(s.firstTs)} · ${s.durationMs}ms`}
          onClick={() => onSelectTurn(s.turn)}
        />
      ))}
    </div>
  )
}

export default memo(TraceTimeline)
