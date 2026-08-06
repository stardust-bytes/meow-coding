import { useEffect, useState } from 'react'

interface Props {
  onAdd: (projectPath: string, name: string) => void
  onClose: () => void
}

export default function AddProjectDialog({ onAdd, onClose }: Props) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')

  // Close on Escape only — the backdrop no longer closes on outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = async () => {
    const folder = await window.api.pickFolder()
    if (folder) {
      setPath(folder)
      if (!name) setName(folder.split(/[\\/]/).pop() ?? folder)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Add project</h3>
        <label className="label">Folder</label>
        <div className="row">
          <input className="input grow" value={path} onChange={e => setPath(e.target.value)} />
          <button className="btn" onClick={() => void pick()}>browse</button>
        </div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!path || !name} onClick={() => onAdd(path, name)}>
            add
          </button>
        </div>
      </div>
    </div>
  )
}
