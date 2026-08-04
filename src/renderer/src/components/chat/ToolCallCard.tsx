import type { ToolCallData } from '@shared/types'
import DiffView from './DiffView'

interface Props {
  call: ToolCallData
}

export default function ToolCallCard({ call }: Props) {
  const pending = call.permission === 'pending'
  const input = call.input ?? {}
  const editDiff = call.tool === 'edit'
    && typeof input.old_string === 'string'
    && typeof input.new_string === 'string'
  const patch = call.tool === 'apply-patch' && typeof input.patch === 'string'
    ? input.patch
    : null
  return (
    <div className="tool-call">
      <div className="tool-call-header">
        <span className={`tool-call-name ${call.permission}`}>{call.tool}</span>
        {pending && <span className="tool-call-running">running…</span>}
      </div>
      {patch !== null ? (
        <pre className="tool-call-input tool-call-diff">{patch}</pre>
      ) : editDiff ? (
        <DiffView oldText={input.old_string as string} newText={input.new_string as string} />
      ) : (
        <pre className="tool-call-input">{JSON.stringify(input, null, 2)}</pre>
      )}
      {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
      {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
    </div>
  )
}
