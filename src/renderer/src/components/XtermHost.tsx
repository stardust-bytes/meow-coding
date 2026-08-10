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
      cursorBlink: true
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
