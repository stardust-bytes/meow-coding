import { useCallback, useEffect, useState } from 'react'
import type { GitFileChange, GitStatusDetail } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
  status: GitStatusDetail | null
}

function statusIcon(f: GitFileChange): { char: string; cls: string } {
  switch (f.status) {
    case 'added': return { char: 'A', cls: 'add' }
    case 'deleted': return { char: 'D', cls: 'del' }
    case 'renamed': return { char: 'R', cls: 'add' }
    case 'untracked': return { char: 'U', cls: 'add' }
    case 'typechange': return { char: 'T', cls: 'del' }
    default: return { char: 'M', cls: 'mod' }
  }
}

export default function GitChangesTab({ projectPath, status }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [staged, setStaged] = useState(false)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  const stagedFiles = status?.files.filter(f => f.staged) ?? []
  const unstagedFiles = status?.files.filter(f => !f.staged) ?? []

  useEffect(() => {
    setSelected(null)
    setDiff(null)
  }, [status?.branch])

  const selectFile = useCallback(async (f: GitFileChange, useStaged: boolean) => {
    setSelected(f.path)
    setStaged(useStaged)
    setDiffError(null)
    setDiff(null)
    try {
      const raw = await window.api.gitGetDiff(projectPath, f.path, useStaged)
      setDiff(raw)
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  const renderGroup = (title: string, files: GitFileChange[], useStagedDefault: boolean) => (
    <div className="git-changes-group">
      <div className="git-changes-group-title">{title} ({files.length})</div>
      {files.length === 0 && <div className="git-changes-empty">—</div>}
      {files.map(f => {
        const icon = statusIcon(f)
        const canToggle = f.staged && f.unstaged
        return (
          <div key={f.path}>
            <div
              className={`git-change-row ${f.path === selected ? 'active' : ''}`}
              onClick={() => void selectFile(f, useStagedDefault)}
            >
              <span className={`git-change-status ${icon.cls}`}>{icon.char}</span>
              <span className="git-change-path" title={f.path}>{f.path}</span>
            </div>
            {f.path === selected && canToggle && (
              <div className="git-change-toolbar">
                <button className={`btn small ${!staged ? 'active' : ''}`} onClick={() => void selectFile(f, false)}>
                  Unstaged
                </button>
                <button className={`btn small ${staged ? 'active' : ''}`} onClick={() => void selectFile(f, true)}>
                  Staged
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="git-changes">
      <div className="git-changes-list">
        {renderGroup('Staged', stagedFiles, true)}
        {renderGroup('Changes not staged', unstagedFiles, false)}
      </div>
      <div className="git-changes-diff">
        {diffError ? (
          <div className="git-error-banner">{diffError}</div>
        ) : diff === null ? (
          <div className="git-diff-empty">Select a file to view its diff. Changes are read-only here.</div>
        ) : (
          <GitDiffView raw={diff} />
        )}
      </div>
    </div>
  )
}
