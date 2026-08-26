import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  agentId: string
  onReady: (term: Terminal) => void
  onDispose: (agentId: string) => void
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

// Terminal themes synced with the app's dark/light mode.
const DARK_THEME = {
  background: '#0a0a0b',
  foreground: '#ffffff',
  cursor: '#007acc',
  cursorAccent: '#0a0a0b',
  selectionBackground: 'rgba(0, 122, 204, 0.35)',
  black: '#0a0a0b',
  red: '#f48771',
  green: '#4ec9b0',
  yellow: '#dcdcaa',
  blue: '#4fc3ff',
  magenta: '#c586c0',
  cyan: '#56b6c2',
  white: '#ffffff',
  brightBlack: '#707076',
  brightRed: '#f48771',
  brightGreen: '#4ec9b0',
  brightYellow: '#dcdcaa',
  brightBlue: '#4fc3ff',
  brightMagenta: '#c586c0',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#0066b8',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 102, 184, 0.25)',
  black: '#1e1e1e',
  red: '#d1242f',
  green: '#098658',
  yellow: '#b5890e',
  blue: '#0451a5',
  magenta: '#a317a5',
  cyan: '#0598bc',
  white: '#1e1e1e',
  brightBlack: '#6a6a6a',
  brightRed: '#d1242f',
  brightGreen: '#098658',
  brightYellow: '#b5890e',
  brightBlue: '#0451a5',
  brightMagenta: '#a317a5',
  brightCyan: '#0598bc',
  brightWhite: '#000000'
}

export default function XtermHost({ agentId, onReady, onDispose, onInput, onResize }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    const term = new Terminal({
      fontFamily: "'JetBrainsMonoNerdFontMono', 'JetBrains Mono', 'JetBrainsMono Nerd Font Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 14,
      scrollback: 5000,
      cursorStyle: 'bar',
      cursorBlink: true,
      theme: isLight ? LIGHT_THEME : DARK_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    term.onData(d => onInput(d))
    term.onResize(({ cols, rows }) => onResize(cols, rows))
    onReady(term)
    try {
      fit.fit()
    } catch {
      /* RO will self-correct */
    }

    const ro = new ResizeObserver(() => {
      const el = ref.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
      try {
        fit.fit()
      } catch {
        /* layout may be mid-change */
      }
    })
    ro.observe(ref.current!)

    // Re-theme the terminal live when the user toggles dark/light in the
    // sidebar (localStorage syncs across same-origin windows).
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'meow.theme') return
      term.options.theme = document.documentElement.getAttribute('data-theme') === 'light' ? LIGHT_THEME : DARK_THEME
    }
    window.addEventListener('storage', onStorage)

    return () => {
      ro.disconnect()
      window.removeEventListener('storage', onStorage)
      term.dispose()
      onDispose(agentId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="xterm-host" ref={ref} />
}
