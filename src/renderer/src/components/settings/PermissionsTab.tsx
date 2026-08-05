import { useState } from 'react'
import type { PermissionRule } from '@shared/types'

interface Props {
  permission: Record<string, PermissionRule>
  onChange: (permission: Record<string, PermissionRule>) => void
}

const DEFAULT_TOOLS = [
  'read', 'write', 'edit', 'glob', 'grep', 'apply-patch', 'todowrite', 'question',
  'webfetch', 'websearch', 'bash', 'skill', 'git', 'task', 'revert'
]

export default function PermissionsTab({ permission, onChange }: Props) {
  const [newTool, setNewTool] = useState('')

  const setRule = (tool: string, rule: PermissionRule) => {
    onChange({ ...permission, [tool]: rule })
  }

  const addRule = () => {
    const tool = newTool.trim()
    if (!tool) return
    onChange({ ...permission, [tool]: 'ask' })
    setNewTool('')
  }

  const allTools = Array.from(new Set([...DEFAULT_TOOLS, ...Object.keys(permission)]))

  return (
    <div className="settings-tab permissions-tab">
      <p className="settings-hint">
        Tool permission rules. Plan mode is always read-only; these rules apply in build mode.
      </p>
      <div className="permission-add">
        <input
          className="input"
          list="permission-tools"
          placeholder="tool name (e.g. bash)"
          value={newTool}
          onChange={e => setNewTool(e.target.value)}
        />
        <datalist id="permission-tools">
          {DEFAULT_TOOLS.map(t => <option key={t} value={t} />)}
        </datalist>
        <button className="btn primary" disabled={!newTool.trim()} onClick={addRule}>Add</button>
      </div>
      <div className="permission-list">
        {allTools.map(tool => (
          <div className="permission-row" key={tool}>
            <span className="permission-tool">{tool}</span>
            <span className="permission-rule">
              <select
                className="input"
                value={permission[tool] ?? 'ask'}
                onChange={e => setRule(tool, e.target.value as PermissionRule)}
              >
                <option value="allow">allow</option>
                <option value="ask">ask</option>
                <option value="deny">deny</option>
              </select>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
