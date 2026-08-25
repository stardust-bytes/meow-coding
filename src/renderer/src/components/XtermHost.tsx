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

export default function XtermHost({ agentId, onReady, onDispose, onInput, onResize }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrainsMonoNerdFontMono', 'JetBrains Mono', 'JetBrainsMono Nerd Font Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 14,
      scrollback: 5000,
      cursorStyle: 'bar',
      cursorBlink: true,
      theme: {
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

    return () => {
      ro.disconnect()
      term.dispose()
      onDispose(agentId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="xterm-host" ref={ref} />
}
