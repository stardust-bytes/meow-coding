import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface FileMenuState {
  x: number
  y: number
  absPath: string
}

interface Props {
  menu: FileMenuState | null
  onClose: () => void
}

export default function FileContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null
  const x = Math.min(menu.x, window.innerWidth - 190)
  const y = Math.min(menu.y, window.innerHeight - 80)
  return createPortal(
    <div ref={ref} className="right-panel-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
      <button className="menu-item" onClick={() => { void window.api.openFileInEditor(menu.absPath); onClose() }}>
        Open in VS Code
      </button>
      <button className="menu-item" onClick={() => { void window.api.showFileInFolder(menu.absPath); onClose() }}>
        Reveal in Folder
      </button>
    </div>,
    document.body
  )
}
