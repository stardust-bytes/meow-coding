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
        background: '#0b0e13',
        foreground: '#cdd3de',
        cursor: '#ff8a66',
        cursorAccent: '#0b0e13',
        selectionBackground: 'rgba(255, 138, 102, 0.25)',
        black: '#0b0e13',
        red: '#ff5f56',
        green: '#4ade9f',
        yellow: '#ffb454',
        blue: '#6cb6ff',
        magenta: '#ff8a66',
        cyan: '#56d4dd',
        white: '#cdd3de',
        brightBlack: '#565e6e',
        brightRed: '#ff7b6b',
        brightGreen: '#6fe8b6',
        brightYellow: '#ffc98a',
        brightBlue: '#8ab9ff',
        brightMagenta: '#ffa88c',
        brightCyan: '#7ee4ea',
        brightWhite: '#eef1f6'
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
