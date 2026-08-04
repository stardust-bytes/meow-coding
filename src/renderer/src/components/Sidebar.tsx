import type { Template, WorkspaceSummary } from '@shared/types'

interface Props {
  workspaces: WorkspaceSummary[]
  templates: Template[]
  activePath: string | null
  onOpen: (path: string) => void
  onRefresh: () => void
  onTemplatesChange: (templates: Template[]) => void
}

export default function Sidebar({
  workspaces, templates, activePath, onOpen, onRefresh, onTemplatesChange
}: Props) {
  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span className="panel-title">Projects</span>
      </div>
      <ul className="project-list">
        {workspaces.map(ws => (
          <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
            <div className="project-row" onClick={() => onOpen(ws.projectPath)}>
              <span className="project-name">{ws.name}</span>
              <span className="project-count">{ws.agentCount}</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
