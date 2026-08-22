import { useCallback, useState } from 'react'
import type { GitBlameLine } from '@shared/types'
import GitFileTree from './GitFileTree'

interface Props {
  projectPath: string
}

const fmtBlameDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric'
})

export default function GitBlameTab({ projectPath }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [blame, setBlame] = useState<GitBlameLine[]>([])
  const [content, setContent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadFile = useCallback(async (absPath: string) => {
    setFilePath(absPath)
    setError(null)
    setLoading(true)
    try {
      const [blameLines, fileContent] = await Promise.all([
        window.api.gitGetBlame(projectPath, absPath),
        window.api.getFileContent(absPath)
      ])
      setBlame(blameLines)
      setContent(fileContent.content.split('\n'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBlame([])
      setContent([])
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  // Lines the working tree has beyond the last blame entry (untracked edits).
  const blameByLine = new Map(blame.map(b => [b.finalLine, b]))

  return (
    <div className="git-blame">
      <div className="git-blame-tree">
        <GitFileTree
          root={projectPath}
          selectedPath={filePath}
          onSelect={(absPath, isDirectory) => {
            if (!isDirectory) void loadFile(absPath)
          }}
        />
      </div>
      <div className="git-blame-content">
        {error && <div className="git-error-banner">{error}</div>}
        {loading && <div className="git-diff-empty">Loading…</div>}
        {!loading && !error && !filePath && (
          <div className="git-diff-empty">Select a file to view blame annotations.</div>
        )}
        {!loading && !error && filePath && (
          <table className="git-blame-code">
            <tbody>
              {content.map((line, i) => {
                const b = blameByLine.get(i + 1)
                return (
                  <tr key={i}>
                    <td
                      className="git-blame-cell"
                      title={b ? `${b.summary} — ${b.author}, ${fmtBlameDate.format(new Date(b.authorTime * 1000))}` : undefined}
                    >
                      {b ? (
                        <>
                          <span className="git-blame-sha">{b.shortSha}</span>
                          <span className="git-blame-author">{b.author}</span>
                          <span className="git-blame-date">{fmtBlameDate.format(new Date(b.authorTime * 1000))}</span>
                        </>
                      ) : (
                        <span className="git-blame-uncommitted">·</span>
                      )}
                    </td>
                    <td className="git-blame-line">{line}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
