import type { ToolCallData } from '@shared/types'

interface Props {
  call: ToolCallData
}

export default function ToolCallCard({ call }: Props) {
  const pending = call.permission === 'pending'
  return (
    <div className="tool-call">
      <div className="tool-call-header">
        <span className={`tool-call-name ${call.permission}`}>{call.tool}</span>
        {pending && <span className="tool-call-running">running…</span>}
      </div>
      <pre className="tool-call-input">{JSON.stringify(call.input ?? {}, null, 2)}</pre>
      {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
      {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
    </div>
  )
}
