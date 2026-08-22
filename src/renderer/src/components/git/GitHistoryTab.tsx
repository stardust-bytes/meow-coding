import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { GitCommit, GitDiffFile, GitDiffResult } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
}

const fmtDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
})

export default function GitHistoryTab({ projectPath }: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [count, setCount] = useState(200)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [compare, setCompare] = useState<string[]>([])
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [fileHistory, setFileHistory] = useState<{ file: string; commits: GitCommit[] } | null>(null)
  const [diffFile, setDiffFile] = useState<GitDiffFile | null>(null)
  const loadToken = useRef(0)

  const loadCommits = useCallback(async (n: number) => {
    setLoading(true)
    try {
      const list = await window.api.gitGetCommits(projectPath, undefined, n)
      setCommits(list)
    } catch {
      /* keep old list */
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void loadCommits(count)
  }, [loadCommits, count])

  const selectCommit = useCallback(async (sha: string) => {
    const token = ++loadToken.current
    setSelected(sha)
    setCompare([])
    setDiffFile(null)
    setDiff(null)
    setDiffError(null)
    try {
      const res = await window.api.gitGetCommitDiff(projectPath, sha)
      if (token !== loadToken.current) return
      setDiff(res)
    } catch (err) {
      if (token !== loadToken.current) return
      setDiffError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  const toggleCompare = useCallback((sha: string) => {
    setSelected(null)
    setDiff(null)
    setCompare(prev => {
      if (prev.includes(sha)) return prev.filter(s => s !== sha)
      if (prev.length >= 2) return [prev[1], sha]
      return [...prev, sha]
    })
  }, [])

  useEffect(() => {
    if (compare.length !== 2) return
    const token = ++loadToken.current
    setDiff(null)
    setDiffError(null)
    setDiffFile(null)
    const [a, b] = compare
    window.api.gitCompareCommits(projectPath, a, b)
      .then(res => {
        if (token === loadToken.current) setDiff(res)
      })
      .catch((err: unknown) => {
        if (token === loadToken.current) setDiffError(err instanceof Error ? err.message : String(err))
      })
  }, [compare, projectPath])

  const openFileHistory = useCallback(async (file: string) => {
    const token = ++loadToken.current
    setDiffFile(null)
    setDiff(null)
    setFileHistory({ file, commits: [] })
    try {
      const list = await window.api.gitGetFileHistory(projectPath, file)
      if (token !== loadToken.current) return
      setFileHistory(prev => (prev && prev.file === file ? { ...prev, commits: list } : prev))
    } catch (err) {
      if (token !== loadToken.current) return
      setDiffError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  const selectDiffFile = useCallback((f: GitDiffFile) => {
    setDiffFile(f)
  }, [])

  const backToCommits = useCallback(() => {
    setFileHistory(null)
    setDiffFile(null)
  }, [])

  const renderFileRows = (files: GitDiffFile[]) => (
    <div className="git-history-files">
      {files.map(f => (
        <button key={f.path} className="git-history-file" onClick={() => selectDiffFile(f)}>
          <span className={`git-change-status ${f.status === 'deleted' ? 'del' : f.status === 'added' ? 'add' : 'mod'}`}>
            {f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
          </span>
          <span className="git-history-file-path" title={f.path}>{f.path}</span>
          <span className="git-history-file-counts">
            {f.additions > 0 && <span className="add">+{f.additions}</span>}
            {f.deletions > 0 && <span className="del">−{f.deletions}</span>}
          </span>
        </button>
      ))}
    </div>
  )

  const diffPane = (
    <div className="git-history-diff">
      {diffError ? (
        <div className="git-error-banner">{diffError}</div>
      ) : diff === null ? (
        <div className="git-diff-empty">
          {compare.length === 2
            ? 'Loading comparison…'
            : 'Select a commit (or check two to compare) to view its diff.'}
        </div>
      ) : (
        <>
          {diffFile ? (
            <GitDiffView raw={diffFile.raw} />
          ) : (
            <>{diff.files.length > 0 ? renderFileRows(diff.files) : <div className="git-diff-empty">No file changes.</div>}</>
          )}
        </>
      )}
    </div>
  )

  const listPane = (
    <div className="git-history-list">
      <div className="git-history-list-header">
        {compare.length > 0 && (
          <span className="git-compare-hint">
            {compare.length === 1 ? `Selected ${compare[0].slice(0, 7)} — pick a second commit` : `Comparing ${compare[0].slice(0, 7)}...${compare[1].slice(0, 7)}`}
          </span>
        )}
        {loading && <span className="git-history-loading">Loading…</span>}
      </div>
      {commits.map(c => (
        <div
          key={c.hash}
          className={`git-commit-row ${c.hash === selected ? 'active' : ''}`}
          onClick={() => void selectCommit(c.hash)}
        >
          <input
            type="checkbox"
            className="git-commit-check"
            checked={compare.includes(c.hash)}
            onClick={e => e.stopPropagation()}
            onChange={() => toggleCompare(c.hash)}
          />
          <div className="git-commit-main">
            <span className="git-commit-subject">{c.subject}</span>
            <span className="git-commit-meta">
              {c.shortHash} · {c.author} · {fmtDate.format(new Date(c.date * 1000))}
            </span>
          </div>
        </div>
      ))}
      <button className="btn small git-load-more" onClick={() => setCount(n => n + 200)}>
        Load more
      </button>
    </div>
  )

  if (fileHistory) {
    return (
      <div className="git-history">
        <div className="git-history-filehistory">
          <button className="btn small" onClick={backToCommits}>
            <ArrowLeft size={13} /> Back to commits
          </button>
          <span className="git-history-filehistory-path" title={fileHistory.file}>{fileHistory.file}</span>
          {fileHistory.commits.map(c => (
            <div key={c.hash} className="git-commit-row" onClick={() => void selectCommit(c.hash)}>
              <div className="git-commit-main">
                <span className="git-commit-subject">{c.subject}</span>
                <span className="git-commit-meta">
                  {c.shortHash} · {c.author} · {fmtDate.format(new Date(c.date * 1000))}
                </span>
              </div>
            </div>
          ))}
        </div>
        {diffPane}
      </div>
    )
  }

  return (
    <div className="git-history">
      {listPane}
      {diffPane}
    </div>
  )
}
