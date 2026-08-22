interface Props {
  projectPath: string
}

export default function GitViewer({ projectPath }: Props) {
  return (
    <div className="git-viewer">
      <div className="git-header">
        <span className="git-title">{projectPath}</span>
      </div>
    </div>
  )
}
