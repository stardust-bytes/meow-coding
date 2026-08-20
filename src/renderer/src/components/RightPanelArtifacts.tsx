import { useEffect, useRef, useState } from 'react'
import { CirclePlus, Pencil } from 'lucide-react'
import type { ArtifactEntry } from '@shared/types'
import FileContextMenu, { type FileMenuState } from './FileContextMenu'
import { truncatePath } from './truncatePath'

interface Props {
  root: string | null
  artifacts: ArtifactEntry[]
  onClear: () => void
}

function CreateIcon() {
  return <CirclePlus size={12} aria-hidden="true" className="artifact-icon create" />
}

function EditIcon() {
  return <Pencil size={12} aria-hidden="true" className="artifact-icon edit" />
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Shows the tail of a long path (…/file.md) by measuring the real text
// width via canvas — CSS can only ellipsize the end, not the head.
function TruncatedPath({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(text)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) { setDisplay(text); return }
    const measure = (s: string) => { ctx.font = getComputedStyle(el).font; return ctx.measureText(s).width }
    const update = () => {
      const next = truncatePath(text, measure, el.clientWidth)
      setDisplay(prev => (prev === next ? prev : next))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return <span ref={ref} className={className} title={text}>{display}</span>
}

export default function RightPanelArtifacts({ root, artifacts, onClear }: Props) {
  const [menu, setMenu] = useState<FileMenuState | null>(null)

  // Only surface markdown files in the artifacts panel.
  const mdArtifacts = artifacts.filter(a => a.path.toLowerCase().endsWith('.md'))

  // Group by agent, preserving first-seen order.
  const groups: { agentId: string; agentName: string; entries: ArtifactEntry[] }[] = []
  const index = new Map<string, typeof groups[number]>()
  for (const entry of mdArtifacts) {
    let group = index.get(entry.agentId)
    if (!group) {
      group = { agentId: entry.agentId, agentName: entry.agentName || entry.agentId, entries: [] }
      index.set(entry.agentId, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  return (
    <div className="right-panel-body">
      <div className="right-panel-header">
        <span className="right-panel-title">Artifacts</span>
        {mdArtifacts.length > 0 && (
          <button className="btn small" title="Clear artifacts" onClick={onClear}>Clear</button>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="right-panel-empty">No artifacts yet</div>
      ) : (
        <div className="artifacts">
          {groups.map(group => (
            <div key={group.agentId} className="artifact-group">
              <div className="artifact-group-header">
                <span className="artifact-agent">{group.agentName}</span>
                <span className="artifact-badge">{group.entries.length}</span>
              </div>
              {group.entries.map(entry => (
                <div
                  key={entry.id}
                  className="artifact-row"
                  onClick={() => root && void window.api.openFile({ path: entry.absPath, root })}
                  onContextMenu={e => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, absPath: entry.absPath })
                  }}
                >
                  {entry.kind === 'create' ? <CreateIcon /> : <EditIcon />}
                  <TruncatedPath text={entry.path} className="artifact-path" />
                  <span className="artifact-time">{relativeTime(entry.ts)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <FileContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
