import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { TraceEvent } from '@shared/types'
import TraceLedger, { describeEvent, formatTime } from './TraceLedger'
import type { TurnBlock } from './TraceLedger'
import TraceTimeline from './TraceTimeline'
import TraceInspector from './TraceInspector'
import SubagentTree from './SubagentTree'

interface Props {
  agentId: string
  sessionId?: string
}

function buildBlocks(events: TraceEvent[]): { blocks: TurnBlock[]; compactions: TraceEvent[] } {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const byTurn = new Map<number, TraceEvent[]>()
  const compactions: TraceEvent[] = []
  let current = 0
  for (const e of sorted) {
    if (e.type === 'compaction') {
      compactions.push(e)
      continue
    }
    if ('turn' in e) current = e.turn
    const arr = byTurn.get(current) ?? []
    arr.push(e)
    byTurn.set(current, arr)
  }
  const blocks = [...byTurn.entries()]
    .map(([turn, events]) => ({ turn, events }))
    .sort((a, b) => a.turn - b.turn)
  return { blocks, compactions }
}

function TracePanel({ agentId, sessionId: sessionIdProp }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [selected, setSelected] = useState<TraceEvent | null>(null)
  const [folded, setFolded] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [subtreeOpen, setSubtreeOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    setEvents([])
    setSelected(null)
    const load = async () => {
      let sid: string | null = sessionIdProp ?? null
      if (!sid) {
        const sessions = await window.api.listSessions(agentId)
        if (cancelled) return
        const latest = sessions.length > 0
          ? sessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
          : null
        sid = latest?.id ?? null
      }
      if (cancelled) return
      setSessionId(sid)
      if (!sid) return
      const trace = await window.api.traceRead(sid)
      if (cancelled) return
      setEvents(prev => {
        const bySeq = new Map<number, TraceEvent>()
        for (const e of prev) bySeq.set(e.seq, e)
        for (const e of trace) bySeq.set(e.seq, e)
        return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
      })
    }
    void load()
    return () => { cancelled = true }
  }, [agentId, sessionIdProp])

  useEffect(() => {
    if (!sessionId) return
    return window.api.onTraceEvent(e => {
      if (e.sessionId !== sessionId) return
      setEvents(prev => {
        if (prev.some(p => p.seq === e.seq)) return prev
        return [...prev, e]
      })
    })
  }, [sessionId])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const { blocks, compactions } = useMemo(() => buildBlocks(events), [events])

  const handleToggleTurn = useCallback((turn: number) => {
    setFolded(prev => {
      const next = new Set(prev)
      if (next.has(turn)) next.delete(turn)
      else next.add(turn)
      return next
    })
  }, [])

  const handleSelectTurn = useCallback((turn: number) => {
    setFolded(prev => {
      if (!prev.has(turn)) return prev
      const next = new Set(prev)
      next.delete(turn)
      return next
    })
  }, [])

  const handleSelect = useCallback((e: TraceEvent) => {
    setSelected(e)
  }, [])

  const handleCloseInspector = useCallback(() => {
    setSelected(null)
  }, [])

  const collapseAll = useCallback(() => {
    setFolded(new Set(blocks.map(b => b.turn)))
  }, [blocks])

  const expandAll = useCallback(() => {
    setFolded(new Set())
  }, [])

  const q = search.trim().toLowerCase()
  const visibleCompactions = q
    ? compactions.filter(e => describeEvent(e).toLowerCase().includes(q))
    : compactions

  if (events.length === 0) {
    return <div className="trace-panel"><div className="trace-empty">No trace yet</div></div>
  }

  return (
    <div className="trace-panel">
      <TraceTimeline turns={blocks} onSelectTurn={handleSelectTurn} />
      <div className="trace-toolbar">
        <input
          className="input grow"
          placeholder="Search trace…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn small" onClick={collapseAll}>Collapse all</button>
        <button className="btn small" onClick={expandAll}>Expand all</button>
      </div>
      <div className="trace-body">
        <div className="trace-main">
          <TraceLedger
            blocks={blocks}
            folded={folded}
            selectedSeq={selected?.seq}
            search={search}
            onToggleTurn={handleToggleTurn}
            onSelect={handleSelect}
          />
          {visibleCompactions.length > 0 && (
            <div className="trace-between">
              <div className="trace-turn-header">
                <span className="trace-caret">◇</span>
                <span className="trace-label">Between turns</span>
              </div>
              {visibleCompactions.map(e => (
                <div
                  key={e.seq}
                  className={`trace-row${e.seq === selected?.seq ? ' selected' : ''}`}
                  onClick={() => handleSelect(e)}
                >
                  <span className="trace-row-time">{formatTime(e.ts)}</span>
                  <span className="trace-label">{describeEvent(e)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="trace-subtree-section">
            <div className="trace-turn-header" onClick={() => setSubtreeOpen(open => !open)}>
              <span className="trace-caret">{subtreeOpen ? '▾' : '▸'}</span>
              <span className="trace-label">Subagents</span>
            </div>
            {subtreeOpen && <SubagentTree events={events} onSelect={handleSelect} />}
          </div>
        </div>
        {selected && <TraceInspector event={selected} onClose={handleCloseInspector} />}
      </div>
    </div>
  )
}

export default memo(TracePanel)
