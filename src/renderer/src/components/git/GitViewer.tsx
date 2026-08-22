import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, GitBranch, RefreshCw, X } from 'lucide-react'
import type { GitBranch as GitBranchType, GitStatusDetail } from '@shared/types'
import GitBranchSwitcher from './GitBranchSwitcher'
import GitChangesTab from './GitChangesTab'
import GitHistoryTab from './GitHistoryTab'
import GitBlameTab from './GitBlameTab'

interface Props {
  projectPath: string
}

type Tab = 'changes' | 'history' | 'blame'

interface GitError {
  error: string
  command: string
}

interface SwitchDialog {
  branch: string
  dirtyCount: number
  confirmDiscard: boolean
}

export default function GitViewer({ projectPath }: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [status, setStatus] = useState<GitStatusDetail | null>(null)
  const [gitError, setGitError] = useState<GitError | null>(null)
  const [busy, setBusy] = useState(false)
  const [switchDialog, setSwitchDialog] = useState<SwitchDialog | null>(null)
  const [loaded, setLoaded] = useState(false)

  const currentBranch = branches.find(b => b.isCurrent)?.name ?? status?.branch ?? null

  const refresh = useCallback(async () => {
    try {
      const [bs, st] = await Promise.all([
        window.api.gitGetBranches(projectPath),
        window.api.gitGetStatusDetail(projectPath)
      ])
      setBranches(bs)
      setStatus(st)
      setLoaded(true)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'refresh' })
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Close via Escape; the native title bar provides minimize/maximize/close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const switchTo = useCallback(async (branch: string) => {
    if (busy) return
    setGitError(null)
    setBusy(true)
    try {
      const st = await window.api.gitGetStatusDetail(projectPath)
      const dirty = (st?.files ?? []).length > 0
      if (dirty) {
        setSwitchDialog({ branch, dirtyCount: st!.files.length, confirmDiscard: false })
        setBusy(false)
        return
      }
      const res = await window.api.gitCheckout(projectPath, branch)
      if (!res.ok) {
        setGitError({ error: res.error, command: res.command })
      } else {
        await refresh()
      }
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'checkout' })
    } finally {
      setBusy(false)
    }
  }, [projectPath, busy, refresh])

  const doSwitchWithCleanup = useCallback(async (branch: string, mode: 'stash' | 'bring' | 'discard') => {
    setBusy(true)
    setGitError(null)
    try {
      if (mode === 'stash') {
        const stashRes = await window.api.gitStash(projectPath)
        if (!stashRes.ok) {
          setGitError({ error: stashRes.error, command: stashRes.command })
          return
        }
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          await window.api.gitStashPop(projectPath)
          return
        }
        const pop = await window.api.gitStashPop(projectPath)
        if (!pop.ok) {
          // Stash is preserved; surface git's message so the user can resolve.
          setGitError({ error: `${pop.error}\n\nStash "meow-switch" was kept — resolve it and drop it manually.`, command: pop.command })
          return
        }
      } else if (mode === 'discard') {
        const disc = await window.api.gitDiscard(projectPath)
        if (!disc.ok) {
          setGitError({ error: disc.error, command: disc.command })
          return
        }
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          return
        }
      } else {
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          return
        }
      }
      await refresh()
      setSwitchDialog(null)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'switch' })
    } finally {
      setBusy(false)
    }
  }, [projectPath, refresh])

  const copyError = () => {
    if (gitError) void navigator.clipboard.writeText(`git ${gitError.command}\n${gitError.error}`)
  }

  return (
    <div className="git-viewer">
      <div className="git-header">
        <span className="git-title" title={projectPath}>
          <GitBranch size={14} aria-hidden="true" />
          {projectPath}
        </span>
        <GitBranchSwitcher
          projectPath={projectPath}
          branches={branches}
          current={currentBranch}
          busy={busy}
          onSwitch={branch => void switchTo(branch)}
          onCreated={() => void refresh()}
          onError={(error, command) => setGitError({ error, command })}
        />
        <button
          className="git-header-btn"
          title="Refresh"
          aria-label="Refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" className={busy ? 'spin' : undefined} />
        </button>
        <button className="git-header-btn" title="Close (Esc)" aria-label="Close" onClick={() => window.close()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {!loaded && !gitError && <div className="git-diff-empty git-center">Loading…</div>}
      {gitError && (
        <div className="git-error-banner">
          <AlertTriangle size={14} aria-hidden="true" />
          <div className="git-error-body">
            <div className="git-error-command">git {gitError.command}</div>
            <pre className="git-error-text">{gitError.error}</pre>
          </div>
          <div className="git-error-actions">
            <button className="btn small" onClick={copyError}>Copy</button>
            <button className="btn small" onClick={() => setGitError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="git-tabs">
            {(['changes', 'history', 'blame'] as Tab[]).map(t => (
              <button
                key={t}
                className={`git-tab ${tab === t ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setTab(t)}
              >
                {t === 'changes' ? 'Changes' : t === 'history' ? 'History' : 'Blame'}
              </button>
            ))}
          </div>
          <div className="git-body">
            {tab === 'changes' && (
              <GitChangesTab projectPath={projectPath} status={status} />
            )}
            {tab === 'history' && <GitHistoryTab projectPath={projectPath} />}
            {tab === 'blame' && <GitBlameTab projectPath={projectPath} />}
          </div>
        </>
      )}

      {switchDialog && (
        <div className="dialog-backdrop">
          <div className="dialog git-switch-dialog">
            <h3>Switch to "{switchDialog.branch}"?</h3>
            <p className="settings-hint">
              The working tree has {switchDialog.dirtyCount} changed file{switchDialog.dirtyCount === 1 ? '' : 's'} that
              would be carried over. Choose how to handle them:
            </p>
            <div className="git-switch-actions">
              <button className="btn" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'stash')}>
                Stash &amp; switch
              </button>
              <button className="btn" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'bring')}>
                Bring changes
              </button>
              {!switchDialog.confirmDiscard ? (
                <button className="btn danger" disabled={busy} onClick={() => setSwitchDialog({ ...switchDialog, confirmDiscard: true })}>
                  Discard changes
                </button>
              ) : (
                <button className="btn danger" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'discard')}>
                  Confirm discard (loses changes)
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => setSwitchDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
