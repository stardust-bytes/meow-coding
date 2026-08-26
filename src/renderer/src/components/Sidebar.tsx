import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, GitBranch, Moon, PanelLeft, RefreshCw, Settings, Server, Sun } from 'lucide-react'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'
import { applyTheme, type Theme } from '../theme'

function MoreIcon() {
  return <Ellipsis size={14} aria-hidden="true" />
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
  onOpenProviders: () => void
  onOpenGit: (path: string) => void
  onCheckUpdate: () => void
  updateChecking: boolean
}

export default function Sidebar({
  workspaces, templates, activePath, onOpen, onRemove, onRefresh, onOpenTerminal, onOpenSettings, onOpenProviders, onOpenGit, onCheckUpdate, updateChecking
}: Props) {
  const [showAddProject, setShowAddProject] = useState(false)
  const [addAgentPath, setAddAgentPath] = useState<string | null>(null)
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [footerMenuPos, setFooterMenuPos] = useState<{ x: number; bottom: number } | null>(null)
  const [version, setVersion] = useState('')
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('meow.theme') === 'light' ? 'light' : 'dark')

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('meow.theme', theme)
  }, [theme])

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  useEffect(() => {
    localStorage.setItem('meow.sidebar.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      // Menus may be portaled to <body>, so also ignore clicks inside them.
      if (target instanceof Element &&
        (target.closest('.project-menu') || target.closest('.project-menu-dropdown') ||
         target.closest('.sidebar-footer-menu') || target.closest('.sidebar-footer-dropdown'))) return
      setOpenProjectMenu(null)
      setProjectMenuPos(null)
      setFooterMenuOpen(false)
      setFooterMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenProjectMenu(null)
        setProjectMenuPos(null)
        setFooterMenuOpen(false)
        setFooterMenuPos(null)
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
          <PanelLeft size={14} aria-hidden="true" />
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
                      onClick={() => { setOpenProjectMenu(null); onOpenGit(ws.projectPath) }}
                    >
                      <GitBranch size={14} aria-hidden="true" />
                      Git
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
          className="sidebar-settings-btn sidebar-footer-menu"
          title="Menu"
          aria-label="Menu"
          onClick={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const width = 160
            const x = Math.max(4, Math.min(r.right - width, window.innerWidth - width - 8))
            // Footer sits at the bottom edge of the window, so the menu opens
            // upward (bottom-anchored) to stay inside the viewport.
            const bottom = window.innerHeight - r.top + 4
            setFooterMenuPos({ x, bottom })
            setFooterMenuOpen(v => !v)
          }}
        >
          <Settings size={15} aria-hidden="true" />
          <span className="sidebar-settings-label">Menu</span>
        </button>
        {footerMenuOpen && footerMenuPos && createPortal(
          <div
            className="sidebar-menu-dropdown sidebar-footer-dropdown"
            style={{ position: 'fixed', left: footerMenuPos.x, right: 'auto', top: 'auto', bottom: footerMenuPos.bottom }}
          >
            <button
              className="menu-item"
              onClick={() => { setFooterMenuOpen(false); setFooterMenuPos(null); onOpenSettings() }}
            >
              <Settings size={14} aria-hidden="true" />
              Settings
            </button>
            <button
              className="menu-item"
              onClick={() => { setFooterMenuOpen(false); setFooterMenuPos(null); onOpenProviders() }}
            >
              <Server size={14} aria-hidden="true" />
              Providers
            </button>
            <button
              className="menu-item"
              onClick={() => { setTheme(t => t === 'dark' ? 'light' : 'dark') }}
            >
              {theme === 'dark' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <div className="sidebar-update-block">
              <span className="sidebar-update-version">v{version || '…'}</span>
              <div className="sidebar-update-actions">
                <button
                  className="btn small"
                  disabled={updateChecking}
                  onClick={onCheckUpdate}
                >
                  <RefreshCw size={12} aria-hidden="true" className={updateChecking ? 'spin' : undefined} />
                  {updateChecking ? 'Checking…' : 'Check update'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </footer>
    </aside>
  )
}
