import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, GitBranch } from 'lucide-react'
import type { GitBranch as GitBranchType } from '@shared/types'

interface Props {
  projectPath: string
  branches: GitBranchType[]
  current: string | null
  busy: boolean
  onSwitch: (branch: string) => void
  onCreated: () => void
  onError: (error: string, command: string) => void
}

export default function GitBranchSwitcher({ projectPath, branches, current, busy, onSwitch, onCreated, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click. mousedown (not click) so the toggle button still
  // gets its own click to re-open; clicks inside the dropdown are ignored.
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const locals = branches.filter(b => !b.isRemote)
  const remotes = branches.filter(b => b.isRemote)

  const createBranch = async () => {
    const name = newName.trim()
    if (!name || !current) return
    const res = await window.api.gitCreateBranch(projectPath, name, current)
    if (!res.ok) {
      onError(res.error, res.command)
      return
    }
    setNewName('')
    setOpen(false)
    onCreated()
    onSwitch(name)
  }

  return (
    <div className="git-branch-wrap" ref={rootRef}>
      <button
        className="git-branch-current"
        disabled={busy}
        onClick={() => setOpen(v => !v)}
        title="Switch branch"
      >
        <GitBranch size={14} aria-hidden="true" />
        <span>{current ?? '(detached)'}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="git-branch-dropdown">
          <div className="git-branch-section">Local</div>
          {locals.map(b => (
            <button
              key={b.name}
              className={`git-branch-item ${b.name === current ? 'active' : ''}`}
              disabled={busy}
              onClick={() => { setOpen(false); onSwitch(b.name) }}
            >
              <span className="git-branch-check">{b.name === current ? <Check size={13} /> : null}</span>
              {b.name}
            </button>
          ))}
          <div className="git-branch-section">Remote</div>
          {remotes.length === 0 && <div className="git-branch-empty">No remote branches</div>}
          {remotes.map(b => (
            <button
              key={b.name}
              className="git-branch-item"
              disabled={busy}
              onClick={() => { setOpen(false); onSwitch(b.name) }}
            >
              <span className="git-branch-check" />
              {b.name}
            </button>
          ))}
          <div className="git-branch-create">
            <input
              className="input"
              placeholder={`Create new branch from ${current ?? 'HEAD'}`}
              value={newName}
              disabled={busy}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void createBranch()
              }}
            />
            <button className="btn small" disabled={busy || !newName.trim()} onClick={() => void createBranch()}>
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
