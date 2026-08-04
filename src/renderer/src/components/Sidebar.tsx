interface Props {
  workspaces: { projectPath: string; name: string; agentCount: number }[]
  activePath: string | null
  onOpen: (path: string) => void
}

export default function Sidebar({ workspaces, activePath, onOpen }: Props) {
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
