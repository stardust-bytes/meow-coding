import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  agentId: string
  onReady: (term: Terminal) => void
  onDispose: (agentId: string) => void
  onInput: (data: string) => void
}

export default function XtermHost({ agentId, onReady, onDispose, onInput }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#e5e5e5'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    term.onData(d => onInput(d))
    onReady(term)
    fit.fit()

    const ro = new ResizeObserver(() => {
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
