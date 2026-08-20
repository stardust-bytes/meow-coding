import { useCallback, useEffect, useState } from 'react'
import MarkdownText from './chat/MarkdownText'
import { isHighlightable, highlightCode } from './chat/highlight'

interface Props {
  path: string
  root: string
}

export default function FileViewer({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.getFileContent(filePath)
      .then(r => {
        if (alive) {
          setContent(r.content)
          setRaw(false)
          setHighlighted(null)
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath])

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

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const code = isHighlightable(ext)

  // Highlight the code once per file (lazy grammar load, memoized result).
  useEffect(() => {
    if (!code || raw || content === null) {
      setHighlighted(null)
      return
    }
    let alive = true
    void highlightCode(content, ext).then(html => {
      if (alive) setHighlighted(html)
    })
    return () => { alive = false }
  }, [code, raw, content, ext])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <div className="viewer">
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
          <button className="btn small" onClick={() => window.close()}>Close</button>
        </div>
      </div>
      <div className="viewer-body">
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
