import type { CompactionSettings, NotificationsSettings, ToolOutputSettings } from '@shared/types'

interface Props {
  maxContextTokens: number
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  notifications: NotificationsSettings
  onChange: (patch: { maxContextTokens: number; maxSteps: number; compaction: CompactionSettings; toolOutput: ToolOutputSettings; notifications: NotificationsSettings }) => void
}

function num(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function displaySteps(n: number): string {
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

export default function ContextTab({ maxContextTokens, maxSteps, compaction, toolOutput, notifications, onChange }: Props) {
  const setTokens = (value: string) =>
    onChange({ maxContextTokens: num(value, maxContextTokens), maxSteps, compaction, toolOutput, notifications })
  const setMaxSteps = (value: string) =>
    onChange({ maxContextTokens, maxSteps: num(value, maxSteps), compaction, toolOutput, notifications })
  const setComp = (patch: Partial<CompactionSettings>) =>
    onChange({ maxContextTokens, maxSteps, compaction: { ...compaction, ...patch }, toolOutput, notifications })
  const setToolOutput = (patch: Partial<ToolOutputSettings>) =>
    onChange({ maxContextTokens, maxSteps, compaction, toolOutput: { ...toolOutput, ...patch }, notifications })
  const setNotifications = (patch: Partial<NotificationsSettings>) =>
    onChange({ maxContextTokens, maxSteps, compaction, toolOutput, notifications: { ...notifications, ...patch } })

  return (
    <div className="settings-tab context-tab">
      <div className="settings-field">
        <label className="label">Max context tokens</label>
        <input
          className="input"
          type="number"
          min={1000}
          value={maxContextTokens}
          onChange={e => setTokens(e.target.value)}
        />
        <p className="settings-hint">
          Fallback model context limit in tokens, used when the model's limit is not known from the catalog.
        </p>
      </div>

      <div className="settings-field">
        <label className="label">Max steps per turn</label>
        <input
          className="input"
          type="number"
          min={1}
          value={displaySteps(maxSteps)}
          placeholder="unlimited"
          onChange={e => setMaxSteps(e.target.value)}
        />
        <p className="settings-hint">
          Maximum tool steps before the agent is forced to wrap up (Infinity = unlimited).
        </p>
      </div>

      <div className="settings-field">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={compaction.auto}
            onChange={e => setComp({ auto: e.target.checked })}
          />
          Auto-compact context when approaching the limit
        </label>
      </div>

      <div className="settings-field">
        <label className="label">Buffer (tokens)</label>
        <input
          className="input"
          type="number"
          min={100}
          value={compaction.buffer}
          onChange={e => setComp({ buffer: num(e.target.value, compaction.buffer) })}
        />
        <p className="settings-hint">Tokens reserved for the model output before compaction triggers.</p>
      </div>

      <div className="settings-field">
        <label className="label">Keep recent tokens</label>
        <input
          className="input"
          type="number"
          min={100}
          value={compaction.keepTokens}
          onChange={e => setComp({ keepTokens: num(e.target.value, compaction.keepTokens) })}
        />
        <p className="settings-hint">Tokens of the recent tail kept verbatim during compaction.</p>
      </div>

      <div className="settings-field">
        <label className="label">Tail turns</label>
        <input
          className="input"
          type="number"
          min={0}
          value={compaction.tailTurns}
          onChange={e => setComp({ tailTurns: num(e.target.value, compaction.tailTurns) })}
        />
        <p className="settings-hint">Recent turns kept verbatim during compaction.</p>
      </div>

      <div className="settings-field">
        <label className="label">Tool output max chars</label>
        <input
          className="input"
          type="number"
          min={100}
          value={compaction.toolOutputMaxChars}
          onChange={e => setComp({ toolOutputMaxChars: num(e.target.value, compaction.toolOutputMaxChars) })}
        />
        <p className="settings-hint">Tool results sent to the model are truncated to this many characters.</p>
      </div>

      <div className="settings-field">
        <label className="label">Tool output max bytes</label>
        <input
          className="input"
          type="number"
          min={1000}
          value={toolOutput.maxBytes}
          onChange={e => setToolOutput({ maxBytes: num(e.target.value, toolOutput.maxBytes) })}
        />
        <p className="settings-hint">
          Tool results larger than this are written to a file and replaced by a head/tail preview.
        </p>
      </div>

      <div className="settings-field">
        <label className="label">Tool output max lines</label>
        <input
          className="input"
          type="number"
          min={100}
          value={toolOutput.maxLines}
          onChange={e => setToolOutput({ maxLines: num(e.target.value, toolOutput.maxLines) })}
        />
        <p className="settings-hint">Maximum lines kept in the tool-result preview.</p>
      </div>

      <div className="settings-field">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={notifications.needsInput}
            onChange={e => setNotifications({ needsInput: e.target.checked })}
          />
          Notify when the agent needs input
        </label>
      </div>
      <div className="settings-field">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={notifications.onDone}
            onChange={e => setNotifications({ onDone: e.target.checked })}
          />
          Notify when a turn finishes or errors
        </label>
      </div>
    </div>
  )
}
