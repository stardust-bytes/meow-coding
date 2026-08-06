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
        <span className="context-footer-label">context</span> —
      </div>
    )
  }
  const pct = contextPercent(tokens, limit)
  const level = contextLevel(tokens, compactThreshold)
  return (
    <div className="context-footer-stack">
      <div className={`context-footer ${level}`}>
        <span className="context-footer-label">context</span>
        <span>{tokens.toLocaleString()}</span>
        {pct !== null && <span>({pct}%)</span>}
        {level === 'danger' && <span className="context-footer-note">· compacting soon</span>}
        {cost > 0 && <span className="context-footer-cost">· ${cost.toFixed(4)}</span>}
      </div>
      {sessionTokens && (
        <div className="context-footer-tokens">
          <span className="context-footer-label">tokens</span>
          <span>{(sessionTokens.input + sessionTokens.output).toLocaleString()}</span>
          <span className="context-footer-dim">
            ({sessionTokens.input.toLocaleString()} in / {sessionTokens.output.toLocaleString()} out)
          </span>
        </div>
      )}
    </div>
  )
})
