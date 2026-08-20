import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, File, Folder } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import FileContextMenu, { type FileMenuState } from './FileContextMenu'

interface Props {
  root: string | null
}

interface NodeData {
  loaded: boolean
  loading: boolean
  error: string | null
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

function FolderIcon() {
  return <Folder size={13} aria-hidden="true" className="tree-icon folder" />
}

function FileIcon() {
  return <File size={13} aria-hidden="true" className="tree-icon file" />
}

export default function RightPanelTree({ root }: Props) {
  const [nodes, setNodes] = useState<Record<string, NodeData>>({})
  const [rootNode, setRootNode] = useState<NodeData>({ loaded: false, loading: false, error: null, expanded: false, children: [] })
  const [menu, setMenu] = useState<FileMenuState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emptyNode = (): NodeData => ({ loaded: false, loading: false, error: null, expanded: false, children: [] })

  const load = useCallback(async (absPath: string) => {
    setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loading: true, error: null } }))
    try {
      const children = await window.api.listDir(absPath)
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loaded: true, loading: false, children } }))
    } catch (err) {
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loading: false, error: err instanceof Error ? err.message : String(err) } }))
    }
  }, [])

  const toggle = useCallback((absPath: string) => {
    const node = nodes[absPath]
    // Lazy-load on first expand; read from render-state closure to stay pure.
    const firstExpand = !node || (!node.expanded && !node.loaded && !node.loading)
    if (firstExpand) void load(absPath)
    setNodes(prev => {
      const n = prev[absPath] ?? emptyNode()
      return { ...prev, [absPath]: { ...n, expanded: !n.expanded } }
    })
  }, [nodes, load])

  const toggleRoot = useCallback(() => {
    if (!root) return
    if (!rootNode.expanded && !rootNode.loaded && !rootNode.loading) {
      window.api.listDir(root)
        .then(children => setRootNode(prev => ({ ...prev, loaded: true, loading: false, children })))
        .catch(err => setRootNode(prev => ({ ...prev, loading: false, error: err instanceof Error ? err.message : String(err) })))
    }
    setRootNode(prev => ({ ...prev, expanded: !prev.expanded }))
  }, [root, rootNode])

  // Root initial load when a project is opened.
  useEffect(() => {
    setNodes({})
    setRootNode({ loaded: false, loading: false, error: null, expanded: false, children: [] })
    if (!root) return
    setRootNode(prev => ({ ...prev, loading: true }))
    window.api.listDir(root)
      .then(children => setRootNode({ loaded: true, loading: false, error: null, expanded: true, children }))
      .catch(err => setRootNode({ loaded: true, loading: false, error: err instanceof Error ? err.message : String(err), expanded: false, children: [] }))
  }, [root])

  // Auto-refresh: re-fetch root + expanded dirs when the project changes.
  useEffect(() => {
    if (!root) return
    const off = window.api.onContextChanged(({ projectPath }) => {
      if (projectPath !== root) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        window.api.listDir(root)
          .then(children => setRootNode(prev => ({ ...prev, loaded: true, loading: false, children })))
          .catch(() => { /* keep old listing */ })
        for (const [absPath, node] of Object.entries(nodes)) {
          if (node.expanded && node.loaded) {
            window.api.listDir(absPath)
              .then(children => setNodes(prev => ({ ...prev, [absPath]: { ...prev[absPath], children } })))
              .catch(() => { /* keep old listing */ })
          }
        }
      }, 500)
    })
    return () => {
      off()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [root, nodes])

  const refresh = useCallback(() => {
    if (!root) return
    void window.api.listDir(root).then(children => setRootNode(prev => ({ ...prev, children })))
  }, [root])

  if (!root) {
    return <div className="right-panel-empty">No project open</div>
  }

  const rootName = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  const renderNode = (entry: DirEntry, depth: number) => {
    const node = nodes[entry.path]
    const isDir = entry.isDirectory
    if (isDir) {
      const data = node ?? { loaded: false, loading: false, error: null, expanded: false, children: [] }
      return (
        <div key={entry.path}>
          <div
            className="tree-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => toggle(entry.path)}
          >
            <span className="tree-chevron"><ChevronIcon open={data.expanded} /></span>
            <FolderIcon />
            <span className="tree-name">{entry.name}</span>
          </div>
          {data.expanded && (
            <div>
              {data.loading && <div className="tree-row tree-dim" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>Loading…</div>}
              {data.error && <div className="tree-row tree-dim tree-error" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>{data.error}</div>}
              {data.loaded && data.children.map(child => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }
    return (
      <div
        key={entry.path}
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => void window.api.openFile({ path: entry.path, root })}
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, absPath: entry.path })
        }}
      >
        <span className="tree-chevron" />
        <FileIcon />
        <span className="tree-name">{entry.name}</span>
      </div>
    )
  }

  return (
    <div className="right-panel-body">
      <div className="right-panel-header">
        <span className="right-panel-title">Explorer</span>
        <button className="btn small" title="Refresh" onClick={refresh}>Refresh</button>
      </div>
      <div className="tree">
        <div className="tree-row tree-root" onClick={toggleRoot}>
          <span className="tree-chevron"><ChevronIcon open={rootNode.expanded} /></span>
          <FolderIcon />
          <span className="tree-name">{rootName}</span>
        </div>
        {rootNode.loading && <div className="tree-row tree-dim" style={{ paddingLeft: 22 }}>Loading…</div>}
        {rootNode.error && <div className="tree-row tree-dim tree-error" style={{ paddingLeft: 22 }}>{rootNode.error}</div>}
        {rootNode.expanded && rootNode.loaded && rootNode.children.map(child => renderNode(child, 1))}
      </div>
      <FileContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
