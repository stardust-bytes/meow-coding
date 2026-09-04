import { useState } from 'react'
import {
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, getFontSize, setFontSize, clampFontSize
} from '../../font'

export default function PersonalizeTab() {
  const [size, setSize] = useState<number>(() => getFontSize())
  const [input, setInput] = useState<string>(() => String(getFontSize()))

  const commit = (raw: string) => {
    setInput(raw)
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return
    const resolved = setFontSize(n)
    setSize(resolved)
    setInput(String(resolved))
  }

  const step = (delta: number) => commit(String(clampFontSize(size + delta)))

  return (
    <section className="settings-section">
      <h4 className="settings-section-header">Personalize</h4>
      <label className="label" htmlFor="fontSize">Font size (px)</label>
      <div className="font-size-row">
        <button className="btn" onClick={() => step(-1)} aria-label="Decrease font size">−</button>
        <input
          id="fontSize"
          className="font-size-input"
          type="text"
          inputMode="numeric"
          value={input}
          onChange={e => commit(e.target.value)}
        />
        <button className="btn" onClick={() => step(1)} aria-label="Increase font size">+</button>
      </div>
      <p className="settings-hint">
        Range {MIN_FONT_SIZE}–{MAX_FONT_SIZE}px. Default {DEFAULT_FONT_SIZE}px.
      </p>
      <div>
        <button className="btn" onClick={() => commit(String(DEFAULT_FONT_SIZE))}>
          Reset to {DEFAULT_FONT_SIZE}
        </button>
      </div>
    </section>
  )
}
