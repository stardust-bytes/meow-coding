import { useState } from 'react'

interface Props {
  onAdd: (projectPath: string, name: string) => void
  onClose: () => void
}

export default function AddProjectDialog({ onAdd, onClose }: Props) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')

  const pick = async () => {
    const folder = await window.api.pickFolder()
    if (folder) {
      setPath(folder)
      if (!name) setName(folder.split(/[\\/]/).pop() ?? folder)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
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
