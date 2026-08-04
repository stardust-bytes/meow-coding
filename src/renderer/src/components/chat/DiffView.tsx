import { useMemo } from 'react'

interface Props {
  oldText: string
  newText: string
}

export default function DiffView({ oldText, newText }: Props) {
  const rows = useMemo(() => {
    const out: Array<{ type: 'del' | 'add'; text: string }> = []
    for (const line of oldText.split('\n')) out.push({ type: 'del', text: line })
    for (const line of newText.split('\n')) out.push({ type: 'add', text: line })
    return out
  }, [oldText, newText])

  return (
    <div className="diff-view">
      {rows.map((r, i) => (
        <div key={i} className={`diff-line ${r.type}`}>
          <span className="diff-sign">{r.type === 'del' ? '-' : '+'}</span>
          <span className="diff-text">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
