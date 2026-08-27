import type { CompactionSettings, NotificationsSettings, ToolOutputSettings } from '@shared/types'

interface Props {
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  notifications: NotificationsSettings
  mcpOutput?: { maxTokens?: number }
  /** Active agent's context limit, for the "auto ≈" placeholders. */
  resolvedContextTokens?: number | null
  onChange: (patch: {
    maxSteps: number
    compaction: CompactionSettings
    toolOutput: ToolOutputSettings
    notifications: NotificationsSettings
    mcpOutput?: { maxTokens?: number }
  }) => void
}

// Empty input = undefined = auto-resolved by ratio of the context window.
function numOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function num(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function displaySteps(n: number): string {
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

// Same ratios as COMPACTION_RATIOS in the main process; the renderer cannot
// import main-process token helpers, so placeholders show the token count.
const RATIO = { buffer: 0.15, keepTokens: 0.06, toolOutputMaxChars: 0.015 }

export default function ContextTab({ maxSteps, compaction, toolOutput, notifications, mcpOutput, resolvedContextTokens, onChange }: Props) {
  const setMaxSteps = (value: string) =>
    onChange({ maxSteps: num(value, maxSteps), compaction, toolOutput, notifications, mcpOutput })
  const setComp = (patch: Partial<CompactionSettings>) =>
    onChange({ maxSteps, compaction: { ...compaction, ...patch }, toolOutput, notifications, mcpOutput })
  const setToolOutput = (patch: Partial<ToolOutputSettings>) =>
    onChange({ maxSteps, compaction, toolOutput: { ...toolOutput, ...patch }, notifications, mcpOutput })
  const setNotifications = (patch: Partial<NotificationsSettings>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications: { ...notifications, ...patch }, mcpOutput })
  const setMcpOutput = (patch: Partial<NonNullable<typeof mcpOutput>>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications, mcpOutput: { ...mcpOutput, ...patch } })

  const ctx = typeof resolvedContextTokens === 'number' && resolvedContextTokens > 0 ? resolvedContextTokens : null
  const auto = (key: keyof typeof RATIO) => ctx ? `auto ≈ ${Math.round(ctx * RATIO[key])} tokens` : 'auto'

  return (
    <div className="settings-tab context-tab">
      <section className="settings-section">
        <h4 className="settings-section-header">Limits</h4>
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
            Maximum tool steps before the agent is forced to wrap up (empty = unlimited).
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
          <label className="label">MCP output max tokens</label>
          <input
            className="input"
            type="number"
            min={1000}
            value={mcpOutput?.maxTokens ?? ''}
            placeholder="25000"
            onChange={e => setMcpOutput({ maxTokens: numOrUndefined(e.target.value) })}
          />
          <p className="settings-hint">
            MCP tool results larger than this are written to a file and replaced by a preview. Empty = 25000.
          </p>
        </div>
      </section>

      <details className="settings-section">
        <summary className="settings-section-header">Advanced (compaction tuning — empty = auto)</summary>
        <div className="settings-field">
          <label className="label">Buffer (tokens)</label>
          <input
            className="input"
            type="number"
            min={1000}
            value={compaction.buffer ?? ''}
            placeholder={auto('buffer')}
            onChange={e => setComp({ buffer: numOrUndefined(e.target.value) })}
          />
          <p className="settings-hint">Tokens reserved for the model output before compaction triggers. Empty = auto.</p>
        </div>
        <div className="settings-field">
          <label className="label">Keep recent tokens</label>
          <input
            className="input"
            type="number"
            min={1000}
            value={compaction.keepTokens ?? ''}
            placeholder={auto('keepTokens')}
            onChange={e => setComp({ keepTokens: numOrUndefined(e.target.value) })}
          />
          <p className="settings-hint">Tokens of the recent tail kept verbatim during compaction. Empty = auto.</p>
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
            value={compaction.toolOutputMaxChars ?? ''}
            placeholder={auto('toolOutputMaxChars')}
            onChange={e => setComp({ toolOutputMaxChars: numOrUndefined(e.target.value) })}
          />
          <p className="settings-hint">Tool results sent to the model are truncated to this many characters. Empty = auto.</p>
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
      </details>

      <section className="settings-section">
        <h4 className="settings-section-header">Notifications</h4>
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
      </section>
    </div>
  )
}
