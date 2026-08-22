import { useMemo } from 'react'
import { parseUnifiedDiff, type DiffLine } from './parseDiff'

interface Props {
  raw: string
}

function LineNumbers({ line }: { line: DiffLine }) {
  return (
    <span className="git-diff-num">
      <span>{line.oldLine ?? ''}</span>
      <span>{line.newLine ?? ''}</span>
    </span>
  )
}

export default function GitDiffView({ raw }: Props) {
  const hunks = useMemo(() => parseUnifiedDiff(raw), [raw])

  if (hunks.length === 0) {
    return <div className="git-diff-empty">No changes.</div>
  }

  return (
    <div className="git-diff-view">
      {hunks.map((hunk, hi) => (
        <div className="git-hunk" key={hi}>
          <div className="git-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`git-diff-line ${line.type}`}>
              <LineNumbers line={line} />
              <span className="git-diff-sign">
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'meta' ? '\\' : ' '}
              </span>
              <span className="git-diff-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
