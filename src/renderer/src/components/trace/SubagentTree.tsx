import { memo, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { TraceEvent } from '@shared/types'

interface Props {
  events: TraceEvent[]
  onSelect: (e: TraceEvent) => void
}

type SubagentEvent = Extract<TraceEvent, { type: 'subagent' }>

function SubagentTree({ events, onSelect }: Props) {
  const subagents = useMemo(
    () => events.filter((e): e is SubagentEvent => e.type === 'subagent'),
    [events]
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const { roots, childrenById } = useMemo(() => {
    const byId = new Map(subagents.map(s => [s.taskId, s] as const))
    const childrenById = new Map<string, SubagentEvent[]>()
    for (const s of subagents) {
      const parent = s.parentTaskId
      if (!parent || !byId.has(parent)) continue
      const arr = childrenById.get(parent) ?? []
      arr.push(s)
      childrenById.set(parent, arr)
    }
    const roots = subagents.filter(s => !s.parentTaskId || !byId.has(s.parentTaskId))
    return { roots, childrenById }
  }, [subagents])

  const toggle = useCallback((taskId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  if (subagents.length === 0) {
    return <div className="trace-subtree-empty">No subagents</div>
  }

  const renderNode = (s: SubagentEvent): ReactNode => {
    const kids = childrenById.get(s.taskId) ?? []
    const isCollapsed = collapsed.has(s.taskId)
    return (
      <li key={s.taskId}>
        <div className="trace-subtree-row" onClick={() => onSelect(s)}>
          {kids.length > 0 ? (
            <button
              className="trace-subtree-toggle"
              onClick={e => { e.stopPropagation(); toggle(s.taskId) }}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="trace-subtree-toggle trace-subtree-toggle-empty" />
          )}
          <span className="trace-subtree-name">{s.subagentType ?? 'subagent'}</span>
          <span className="trace-mono">{s.taskId.slice(0, 8)}</span>
          <span className={`trace-state state-${s.state}`}>{s.state}</span>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <ul className="trace-subtree">{kids.map(renderNode)}</ul>
        )}
      </li>
    )
  }

  return (
    <div className="trace-subtree-panel">
      <ul className="trace-subtree">{roots.map(renderNode)}</ul>
    </div>
  )
}

export default memo(SubagentTree)
