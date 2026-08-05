import { useEffect, useState } from 'react'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'
import TemplatesPanel from './TemplatesPanel'
import SettingsDialog from './settings/SettingsDialog'

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
  onTemplatesChange: (templates: Template[]) => void
}

export default function Sidebar({
  workspaces, templates, activePath, onOpen, onRemove, onRefresh, onTemplatesChange
}: Props) {
  const [showAddProject, setShowAddProject] = useState(false)
  const [addAgentPath, setAddAgentPath] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!(target instanceof Element) || !target.closest('.sidebar-menu, .project-menu')) {
        setMenuOpen(false)
        setOpenProjectMenu(null)
        setProjectMenuPos(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
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

  const closeMenu = () => setMenuOpen(false)

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
    <aside className="sidebar">
      {error && <div className="sidebar-error">{error}</div>}
      <div className="panel-head">
        <span className="panel-title">Projects</span>
        <div className="sidebar-menu">
          <button className="btn ghost small" title="menu" aria-label="menu" onClick={() => setMenuOpen(v => !v)}>
            <span className="btn-icon"><MoreIcon /></span>
          </button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown">
              <button className="menu-item" onClick={() => { closeMenu(); setShowAddProject(true) }}>Add project</button>
              <button className="menu-item" onClick={() => { closeMenu(); setShowTemplates(v => !v) }}>Templates</button>
              <button className="menu-item" onClick={() => { closeMenu(); setShowSettings(true) }}>Settings</button>
            </div>
          )}
        </div>
      </div>
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
              <span className="project-name">{ws.name}</span>
              <span className="project-count">{ws.agentCount}</span>
              <div className="project-menu" onClick={e => e.stopPropagation()}>
                <button
                  className="btn ghost small"
                  title="project menu"
                  aria-label={`menu ${ws.name}`}
                  onClick={() => { setProjectMenuPos(null); setOpenProjectMenu(p => (p === ws.projectPath ? null : ws.projectPath)) }}
                >
                  <span className="btn-icon"><MoreIcon /></span>
                </button>
                {openProjectMenu === ws.projectPath && (
                  <div
                    className="sidebar-menu-dropdown project-menu-dropdown"
                    style={projectMenuPos ? {
                      position: 'fixed',
                      left: projectMenuPos.x,
                      top: projectMenuPos.y,
                      right: 'auto',
                      bottom: 'auto'
                    } : undefined}
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
                      className="menu-item danger"
                      onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {showTemplates && <TemplatesPanel templates={templates} onChange={onTemplatesChange} />}
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
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </aside>
  )
}
