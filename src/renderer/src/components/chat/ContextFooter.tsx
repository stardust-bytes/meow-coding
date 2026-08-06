import { memo } from 'react'
import { contextLevel, contextPercent } from '@shared/usage'

interface Props {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
}

export default memo(function ContextFooter({ tokens, limit, compactThreshold, cost }: Props) {
  if (tokens === null) {
    return <div className="context-footer"><span className="context-footer-label">context</span> —</div>
  }
  const pct = contextPercent(tokens, limit)
  const level = contextLevel(tokens, compactThreshold)
  return (
    <div className={`context-footer ${level}`}>
      <span className="context-footer-label">context</span>
      <span>{tokens.toLocaleString()}</span>
      {pct !== null && <span>({pct}%)</span>}
      {level === 'danger' && <span className="context-footer-note">· compacting soon</span>}
      {cost > 0 && <span className="context-footer-cost">· ${cost.toFixed(4)}</span>}
    </div>
  )
})
