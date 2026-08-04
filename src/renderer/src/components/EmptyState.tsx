interface Props {
  hasWorkspace: boolean
}

export default function EmptyState({ hasWorkspace }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-mark">&gt;_</div>
      {hasWorkspace
        ? <p className="subtitle">Workspace đang mở nhưng chưa có agent. Dùng "+ Agent" trong sidebar.</p>
        : <p className="subtitle">Chọn một project ở sidebar, hoặc thêm project mới để bắt đầu.</p>}
    </div>
  )
}
