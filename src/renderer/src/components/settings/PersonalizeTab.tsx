import { useState } from 'react'
import {
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, getFontSize, setFontSize, clampFontSize
} from '../../font'

export default function PersonalizeTab() {
  const [size, setSize] = useState<number>(() => getFontSize())
  const [input, setInput] = useState<string>(() => String(getFontSize()))

  // Persist + normalize the displayed value to the clamped result. Called on
  // blur / Enter and from the stepper/reset, which operate on known values.
  const apply = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) {
      // Invalid or empty: revert the field to the current size.
      setInput(String(size))
      return
    }
    const resolved = setFontSize(n)
    setSize(resolved)
    setInput(String(resolved))
  }

  const step = (delta: number) => apply(String(clampFontSize(size + delta)))

  return (
    <section className="settings-section">
      <h4 className="settings-section-header">Personalize</h4>
      <div className="settings-field">
        <label className="label" htmlFor="fontSize">Font size (px)</label>
        <div className="font-size-row">
          <button className="btn" onClick={() => step(-1)} aria-label="Decrease font size">−</button>
          <input
            id="fontSize"
            className="input font-size-input"
            type="text"
            inputMode="numeric"
            value={input}
            onChange={e => setInput(e.target.value)}
            onBlur={e => apply(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') apply(e.currentTarget.value)
            }}
          />
          <button className="btn" onClick={() => step(1)} aria-label="Increase font size">+</button>
        </div>
        <p className="settings-hint">
          Range {MIN_FONT_SIZE}–{MAX_FONT_SIZE}px. Default {DEFAULT_FONT_SIZE}px.
        </p>
      </div>
      <div>
        <button className="btn" onClick={() => apply(String(DEFAULT_FONT_SIZE))}>
          Reset to {DEFAULT_FONT_SIZE}
        </button>
      </div>
    </section>
  )
}
