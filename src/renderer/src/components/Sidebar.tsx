import { useEffect, useRef, useState } from 'react'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'
import TemplatesPanel from './TemplatesPanel'
import SettingsDialog from './SettingsDialog'

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
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
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

  const handleAddAgent = async (input: NewAgentInput) => {
    if (!activePath) return
    try {
      await window.api.addAgent(activePath, input)
      setShowAddAgent(false)
      setError('')
      onRefresh()
      onOpen(activePath)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <aside className="sidebar">
      {error && <div className="sidebar-error">{error}</div>}
      <div className="panel-head">
        <span className="panel-title">Projects</span>
        <div className="sidebar-menu" ref={menuRef}>
          <button className="btn small" title="menu" aria-label="menu" onClick={() => setMenuOpen(v => !v)}>⋯</button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown">
              <button className="menu-item" onClick={() => { closeMenu(); setShowAddProject(true) }}>+ project</button>
              <button className="menu-item" onClick={() => { closeMenu(); setShowTemplates(v => !v) }}>templates</button>
              <button className="menu-item" onClick={() => { closeMenu(); setShowSettings(true) }}>settings</button>
            </div>
          )}
        </div>
      </div>
      <ul className="project-list">
        {workspaces.map(ws => (
          <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
            <div className="project-row" onClick={() => onOpen(ws.projectPath)}>
              <span className="project-name">{ws.name}</span>
              <span className="project-count">{ws.agentCount}</span>
              <button className="btn small" onClick={e => {
                e.stopPropagation()
                onRemove(ws.projectPath)
              }}>x</button>
            </div>
          </li>
        ))}
      </ul>
      {activePath && (
        <button className="btn" onClick={() => setShowAddAgent(true)}>+ agent</button>
      )}
      {showTemplates && <TemplatesPanel templates={templates} onChange={onTemplatesChange} />}
      {showAddProject && (
        <AddProjectDialog onAdd={(p, n) => void handleAddProject(p, n)} onClose={() => setShowAddProject(false)} />
      )}
      {showAddAgent && activePath && (
        <AddAgentDialog
          projectPath={activePath}
          templates={templates}
          onAdd={input => void handleAddAgent(input)}
          onClose={() => setShowAddAgent(false)}
        />
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </aside>
  )
}
