import { useCallback, useEffect, useState } from 'react'
import MarkdownText from './chat/MarkdownText'
import PopupTitleBar from './PopupTitleBar'
import { isHighlightable, preloadLanguage, highlightCode } from './chat/highlight'

interface Props {
  path: string
  root: string
}

export default function FileViewer({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const code = isHighlightable(ext)

  useEffect(() => {
    let alive = true
    // Warm the highlighter + grammar while the content is read over IPC, so
    // the first highlight is near-instant and plain text never flashes.
    const prep = code ? preloadLanguage(ext) : Promise.resolve()
    window.api.getFileContent(filePath)
      .then(async r => {
        let html: string | null = null
        if (code) {
          try {
            await prep
            html = await highlightCode(r.content, ext)
          } catch {
            html = null // highlight failure → fall back to plain text
          }
        }
        if (!alive) return
        setContent(r.content)
        setRaw(false)
        setHighlighted(html)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath, ext, code])

  // Close via Escape; the native title bar provides minimize/maximize/close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copy = useCallback(async () => {
    if (content) await navigator.clipboard.writeText(content)
  }, [content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <div className="viewer">
      <PopupTitleBar title={filePath} />
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Markdown' : 'Raw'}
            </button>
          )}
          {code && !isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Highlighted' : 'Raw'}
            </button>
          )}
          <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          <button className="btn small" onClick={() => void copy()} disabled={!content}>Copy</button>
        </div>
      </div>
      {/* Full-bleed for highlighted code (VS Code look), padded for everything else. */}
      <div className={`viewer-body${code && !raw && highlighted ? ' viewer-body--flush' : ''}`}>
        {error ? (
          <div className="viewer-error">{error}</div>
        ) : content === null ? (
          <div className="viewer-loading">Loading…</div>
        ) : isMarkdown && !raw ? (
          <div className="viewer-md"><MarkdownText text={content} onOpenFile={openLinkedFile} /></div>
        ) : code && !raw && highlighted ? (
          <div className="viewer-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="viewer-pre">{content}</pre>
        )}
      </div>
    </div>
  )
}
