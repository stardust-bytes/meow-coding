import { useState } from 'react'
import type { NewAgentInput, Template, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import AddAgentDialog from './AddAgentDialog'
import TemplatesPanel from './TemplatesPanel'

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
  const [error, setError] = useState('')

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
        <button className="btn small" onClick={() => setShowAddProject(true)}>+ project</button>
        <button className="btn small" onClick={() => setShowTemplates(v => !v)}>templates</button>
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
    </aside>
  )
}
