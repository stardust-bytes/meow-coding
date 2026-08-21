import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { normalizeMarkdownTables } from './markdownTable'
import { isPathLike } from './markdownPaths'

interface Props {
  text: string
  onOpenFile?: (path: string) => void
}

marked.setOptions({ gfm: true, breaks: true })

export default function MarkdownText({ text, onOpenFile }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(normalizeMarkdownTables(text), { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw)
    // Post-process instead of a custom marked renderer: keeps the default
    // renderer for link text/escaping and avoids global marked.use mutations.
    const doc = new DOMParser().parseFromString(sanitized, 'text/html')
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#') || /^(https?|mailto):/i.test(href)) return
      if (isPathLike(href)) {
        a.setAttribute('href', '#')
        a.setAttribute('data-file', href)
        a.classList.add('chat-file-link')
      }
    })
    doc.querySelectorAll('code').forEach(code => {
      // Code blocks (fenced/indented) are never file links — only inline code
      // can reference a path. Without this a long block whose last line ends
      // in .ext gets underlined like a link.
      if (code.closest('pre')) return
      const t = code.textContent?.trim() ?? ''
      if (isPathLike(t)) {
        code.setAttribute('data-file', t)
        code.classList.add('chat-file-link')
      }
    })
    return doc.body.innerHTML
  }, [text])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onOpenFile) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')
    if (!el) return
    const p = el.getAttribute('data-file')
    if (p) {
      e.preventDefault()
      onOpenFile(p)
    }
  }

  return (
    <div className="chat-text chat-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
