import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import DiffView from './DiffView'

interface Props {
  call: ToolCallData
}

// Short single-line description of what the tool did, shown on the collapsed
// header (e.g. "edit src/main/index.ts", "bash npm run build").
function describeInput(call: ToolCallData): string {
  const input = call.input ?? {}
  const first = (keys: string[]) => {
    for (const k of keys) {
      const v = input[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  switch (call.tool) {
    case 'edit': case 'apply-patch': case 'write': case 'read':
      return first(['file_path', 'path'])
    case 'bash': case 'terminal': case 'cmd': case 'sh':
      return first(['command', 'cmd'])
    case 'websearch': case 'webfetch':
      return first(['query', 'url'])
    case 'glob': case 'grep': case 'ls': case 'dir':
      return first(['pattern', 'path'])
    default: {
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
  }
}

// call objects are replaced wholesale on tool-start/tool-result, so memo keeps
// finished cards from re-rendering (and re-stringifying) on every stream delta.
export default memo(function ToolCallCard({ call }: Props) {
  const pending = call.permission === 'pending'
  const input = call.input ?? {}
  const editDiff = call.tool === 'edit'
    && typeof input.old_string === 'string'
    && typeof input.new_string === 'string'
  const patch = call.tool === 'apply-patch' && typeof input.patch === 'string'
    ? input.patch
    : null
  return (
    <details className="tool-call" open={pending}>
      <summary className="tool-call-header">
        <ChevronRight className="tool-call-chevron" />
        <span className={`tool-call-name ${call.permission}`}>{call.tool}</span>
        <span className="tool-call-summary">{describeInput(call)}</span>
        {pending && <span className="tool-call-running">running…</span>}
        {!pending && (
          <span className={`tool-call-status ${call.permission === 'denied' ? 'err' : 'ok'}`}>
            {call.permission === 'denied' ? '✗' : '✓'}
          </span>
        )}
      </summary>
      {patch !== null ? (
        <pre className="tool-call-input tool-call-diff">{patch}</pre>
      ) : editDiff ? (
        <DiffView oldText={input.old_string as string} newText={input.new_string as string} />
      ) : (
        <pre className="tool-call-input">{JSON.stringify(input, null, 2)}</pre>
      )}
      {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
      {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
    </details>
  )
})
