interface Props {
  hasWorkspace: boolean
}

export default function EmptyState({ hasWorkspace }: Props) {
  return (
    <div className="empty-state">
      {hasWorkspace
        ? <p className="subtitle">Workspace dang mo nhung chua co agent. Dung "+ Agent" trong sidebar.</p>
        : <p className="subtitle">Chon mot project o sidebar, hoac them project moi de bat dau.</p>}
    </div>
  )
}
