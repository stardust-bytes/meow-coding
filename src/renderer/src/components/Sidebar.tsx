import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  )
}

interface Props {
  workspaces: WorkspaceSummary[]
  templates: Template[]
  activePath: string | null
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  onRefresh: () => void
  onOpenTerminal: (path: string) => void
  onOpenSettings: () => void
}

export default function Sidebar({
  workspaces, templates, activePath, onOpen, onRemove, onRefresh, onOpenTerminal, onOpenSettings
}: Props) {
  const [showAddProject, setShowAddProject] = useState(false)
  const [addAgentPath, setAddAgentPath] = useState<string | null>(null)
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')

  useEffect(() => {
    localStorage.setItem('meow.sidebar.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      // Menu may be portaled to <body>, so also ignore clicks inside it.
      if (target instanceof Element &&
        (target.closest('.project-menu') || target.closest('.project-menu-dropdown'))) return
      setOpenProjectMenu(null)
      setProjectMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenProjectMenu(null)
        setProjectMenuPos(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const handleAddProject = async (projectPath: string, name: string) => {
    try {
      await window.api.addWorkspace(projectPath, name)
      setShowAddProject(false)
      setError('')
      onRefresh()
      onOpen(projectPath)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleAddAgent = async (projectPath: string, input: NewAgentInput) => {
    try {
      await window.api.addAgent(projectPath, input)
      setAddAgentPath(null)
      setError('')
      onRefresh()
      onOpen(projectPath)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {error && <div className="sidebar-error">{error}</div>}
      <div className="panel-head sidebar-head">
        <span className="panel-title">Projects</span>
        <button className="btn primary small" onClick={() => setShowAddProject(true)}>Add Project</button>
        <button
          className={`sidebar-toggle ${collapsed ? 'collapsed' : ''}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(v => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
          </svg>
        </button>
      </div>
      {collapsed ? (
        <ul className="project-rail">
          {workspaces.map(ws => (
            <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
              <button
                className="project-avatar"
                title={ws.name}
                aria-label={ws.name}
                onClick={() => onOpen(ws.projectPath)}
              >
                {ws.name.charAt(0).toUpperCase()}
              </button>
            </li>
          ))}
        </ul>
      ) : (
      <ul className="project-list">
        {workspaces.map(ws => (
          <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
            <div
              className="project-row"
              onClick={() => onOpen(ws.projectPath)}
              onContextMenu={e => {
                e.preventDefault()
                setProjectMenuPos({ x: e.clientX, y: e.clientY })
                setOpenProjectMenu(ws.projectPath)
              }}
            >
              <div className="project-info">
                <span className="project-name">{ws.name}</span>
                <span className="project-path" title={ws.projectPath}>{ws.projectPath}</span>
                <span className="project-count">
                  {ws.agentCount} Agent{ws.agentCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="project-menu" onClick={e => e.stopPropagation()}>
                <button
                  className="btn ghost small"
                  title="Project menu"
                  aria-label={`menu ${ws.name}`}
                  onClick={e => {
                    // Anchor the portaled menu at the button, clamped to the viewport.
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const width = 160
                    const x = Math.max(4, Math.min(r.right - width, window.innerWidth - width - 8))
                    const y = r.bottom + 4
                    setProjectMenuPos({ x, y })
                    setOpenProjectMenu(p => (p === ws.projectPath ? null : ws.projectPath))
                  }}
                >
                  <span className="btn-icon"><MoreIcon /></span>
                </button>
                {openProjectMenu === ws.projectPath && projectMenuPos && createPortal(
                  <div
                    className="sidebar-menu-dropdown project-menu-dropdown"
                    style={{ position: 'fixed', left: projectMenuPos.x, top: projectMenuPos.y, right: 'auto', bottom: 'auto' }}
                  >
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpen(ws.projectPath) }}
                    >
                      Open
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); setAddAgentPath(ws.projectPath) }}
                    >
                      Add Agent
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openInEditor(ws.projectPath) }}
                    >
                      Open in VS Code
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}
                    >
                      Open Folder
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpenTerminal(ws.projectPath) }}
                    >
                      Open Terminal
                    </button>
                    <button
                      className="menu-item danger"
                      onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}
                    >
                      Remove
                    </button>
                  </div>,
                  document.body
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      )}
      {showAddProject && (
        <AddProjectDialog onAdd={(p, n) => void handleAddProject(p, n)} onClose={() => setShowAddProject(false)} />
      )}
      {addAgentPath && (
        <AddAgentDialog
          projectPath={addAgentPath}
          templates={templates}
          onAdd={input => void handleAddAgent(addAgentPath, input)}
          onClose={() => setAddAgentPath(null)}
        />
      )}
      <footer className="sidebar-footer">
        <button
          className="sidebar-settings-btn"
          title="Settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="sidebar-settings-label">Settings</span>
        </button>
      </footer>
    </aside>
  )
}
