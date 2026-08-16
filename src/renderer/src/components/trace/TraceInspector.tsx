import { memo } from 'react'
import type { TraceEvent } from '@shared/types'

interface Props {
  event: TraceEvent
  onClose: () => void
}

function TraceInspector({ event, onClose }: Props) {
  const timing: Array<[string, string]> = []
  timing.push(['ts', new Date(event.ts).toLocaleString()])
  if ('durationMs' in event && event.durationMs != null) timing.push(['duration', `${event.durationMs}ms`])
  if ('ttftMs' in event && event.ttftMs != null) timing.push(['ttft', `${event.ttftMs}ms`])
  if ('decodeMs' in event && event.decodeMs != null) timing.push(['decode', `${event.decodeMs}ms`])
  if ('startTs' in event) timing.push(['start', new Date(event.startTs).toLocaleString()])
  if ('endTs' in event && event.endTs != null) timing.push(['end', new Date(event.endTs).toLocaleString()])

  const meta: Array<[string, string]> = [
    ['agent', event.agentId],
    ['session', event.sessionId],
    ['seq', String(event.seq)]
  ]
  if ('turn' in event) meta.push(['turn', String(event.turn)])
  if ('taskId' in event) meta.push(['taskId', event.taskId])

  const tokens = 'tokens' in event ? event.tokens : undefined
  const cost = 'cost' in event ? event.cost : undefined
  const input = 'input' in event ? event.input : undefined
  const output = 'output' in event ? event.output : undefined
  const toolError = 'error' in event ? event.error : undefined

  return (
    <div className="trace-inspector">
      <div className="trace-inspector-head">
        <span className="trace-inspector-type">{event.type}</span>
        <button className="btn small ghost" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <div className="trace-inspector-body">
        <section className="trace-inspector-section">
          <h4>Timing</h4>
          {timing.map(([k, v]) => (
            <div key={k} className="trace-inspector-row">
              <span className="trace-inspector-key">{k}</span>
              <span className="trace-mono">{v}</span>
            </div>
          ))}
        </section>

        {tokens && (
          <section className="trace-inspector-section">
            <h4>Tokens</h4>
            <div className="trace-mono">in {tokens.input} · out {tokens.output} · total {tokens.total}</div>
            {event.type === 'message' && event.tokens?.reasoning != null && (
              <div className="trace-mono">reasoning {event.tokens.reasoning}</div>
            )}
            {event.type === 'message' && event.tokens?.cacheRead != null && (
              <div className="trace-mono">cache read {event.tokens.cacheRead}</div>
            )}
          </section>
        )}

        {cost !== undefined && (
          <section className="trace-inspector-section">
            <h4>Cost</h4>
            <div className="trace-mono">${cost.toFixed(6)}</div>
          </section>
        )}

        {input !== undefined && (
          <section className="trace-inspector-section">
            <h4>Input</h4>
            <pre className="trace-inspector-pre">{JSON.stringify(input, null, 2)}</pre>
          </section>
        )}

        {output !== undefined && (
          <section className="trace-inspector-section">
            <h4>Output</h4>
            <pre className="trace-inspector-pre">
              {output.length > 500
                ? `${output.slice(0, 500)}\n\n… truncated (${output.length} chars total)`
                : output}
            </pre>
          </section>
        )}

        {toolError ? (
          <section className="trace-inspector-section">
            <h4>Error</h4>
            <pre className="trace-inspector-pre trace-inspector-error">{toolError}</pre>
          </section>
        ) : event.type === 'error' ? (
          <section className="trace-inspector-section">
            <h4>Error</h4>
            <pre className="trace-inspector-pre trace-inspector-error">{event.message}</pre>
          </section>
        ) : null}

        <section className="trace-inspector-section">
          <h4>Meta</h4>
          {meta.map(([k, v]) => (
            <div key={k} className="trace-inspector-row">
              <span className="trace-inspector-key">{k}</span>
              <span className="trace-mono">{v}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export default memo(TraceInspector)
