import { memo } from 'react'
import { contextLevel, contextPercent } from '@shared/usage'

interface Props {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
  sessionTokens?: { input: number; output: number } | null
}

export default memo(function ContextFooter({ tokens, limit, compactThreshold, cost, sessionTokens }: Props) {
  if (tokens === null) {
    return (
      <div className="context-footer">
        <span className="context-footer-label">Context</span> —
      </div>
    )
  }
  const pct = contextPercent(tokens, limit)
  const level = contextLevel(tokens, compactThreshold)
  return (
    <div className="context-footer-wrap">
      <div className={`context-footer ${level}`}>
        <span className="context-footer-label">context</span>
        <span>{tokens.toLocaleString()}</span>
        {pct !== null && <span>({pct}%)</span>}
        {level === 'danger' && <span className="context-footer-note">· compacting soon</span>}
      </div>
      <div className="context-footer-popover" role="tooltip">
        <div className="context-popover-row">
          <span className="context-popover-label">context</span>
          <span>{tokens.toLocaleString()}</span>
          {pct !== null && <span className="context-popover-dim">({pct}%)</span>}
        </div>
        {sessionTokens && (
          <div className="context-popover-row">
            <span className="context-popover-label">tokens</span>
            <span className="context-popover-tokens">
              {sessionTokens.input.toLocaleString()} in / {sessionTokens.output.toLocaleString()} out
            </span>
          </div>
        )}
        {cost > 0 && (
          <div className="context-popover-row">
            <span className="context-popover-label">cost</span>
            <span>${cost.toFixed(4)}</span>
          </div>
        )}
      </div>
    </div>
  )
})
