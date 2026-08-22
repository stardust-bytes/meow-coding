import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, File, Folder } from 'lucide-react'
import type { DirEntry } from '@shared/types'

interface Props {
  root: string
  selectedPath: string | null
  onSelect: (absPath: string, isDirectory: boolean) => void
}

interface NodeData {
  loaded: boolean
  loading: boolean
  expanded: boolean
  children: DirEntry[]
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={10}
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    />
  )
}

export default function GitFileTree({ root, selectedPath, onSelect }: Props) {
  const [nodes, setNodes] = useState<Record<string, NodeData>>({})
  const [rootNode, setRootNode] = useState<NodeData>({ loaded: false, loading: false, expanded: false, children: [] })

  const load = useCallback(async (absPath: string) => {
    setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? { loaded: false, loading: false, expanded: false, children: [] }), loading: true } }))
    try {
      const children = await window.api.listDir(absPath)
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? { loaded: false, loading: false, expanded: false, children: [] }), loaded: true, loading: false, children } }))
    } catch {
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? { loaded: false, loading: false, expanded: false, children: [] }), loading: false, loaded: true } }))
    }
  }, [])

  const toggle = useCallback((absPath: string) => {
    setNodes(prev => {
      const n = prev[absPath] ?? { loaded: false, loading: false, expanded: false, children: [] }
      if (!n.loaded && !n.loading) void load(absPath)
      return { ...prev, [absPath]: { ...n, expanded: !n.expanded } }
    })
  }, [load])

  useEffect(() => {
    setNodes({})
    setRootNode({ loaded: false, loading: true, expanded: false, children: [] })
    window.api.listDir(root)
      .then(children => setRootNode({ loaded: true, loading: false, expanded: true, children }))
      .catch(() => setRootNode({ loaded: true, loading: false, expanded: false, children: [] }))
  }, [root])

  const renderDir = (entry: DirEntry, depth: number) => {
    const node = nodes[entry.path] ?? { loaded: false, loading: false, expanded: false, children: [] }
    return (
      <div key={entry.path}>
        <div
          className="git-tree-row"
          style={{ paddingLeft: depth * 14 + 6 }}
          onClick={() => { toggle(entry.path); onSelect(entry.path, true) }}
        >
          <span className="git-tree-chevron"><ChevronIcon open={node.expanded} /></span>
          <Folder size={13} aria-hidden="true" className="git-tree-folder" />
          <span className="git-tree-name">{entry.name}</span>
        </div>
        {node.expanded && node.children.map(c => renderEntry(c, depth + 1))}
      </div>
    )
  }

  const renderFile = (entry: DirEntry, depth: number) => (
    <div
      key={entry.path}
      className={`git-tree-row ${entry.path === selectedPath ? 'active' : ''}`}
      style={{ paddingLeft: depth * 14 + 6 }}
      onClick={() => onSelect(entry.path, false)}
    >
      <span className="git-tree-chevron" />
      <File size={13} aria-hidden="true" className="git-tree-file" />
      <span className="git-tree-name">{entry.name}</span>
    </div>
  )

  const renderEntry = (entry: DirEntry, depth: number) =>
    entry.isDirectory ? renderDir(entry, depth) : renderFile(entry, depth)

  return (
    <div className="git-tree">
      {rootNode.loading ? (
        <div className="git-tree-empty">Loading…</div>
      ) : (
        rootNode.children.map(c => renderEntry(c, 0))
      )}
    </div>
  )
}
