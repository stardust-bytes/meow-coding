import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { normalizeMarkdownTables } from './markdownTable'

interface Props {
  text: string
  onOpenFile?: (path: string) => void
}

marked.setOptions({ gfm: true, breaks: true })

// Looks like a local file path: dot-relative, slash-relative, a Windows drive
// (C:\), or ends with a common file extension. http(s)/mailto links are left
// alone so the existing window-open handler opens them externally.
const PATH_LIKE = /^(\.{0,2}[\\/]|[A-Za-z]:[\\/]|[\\/])|\.\w{1,6}$/i

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
      if (PATH_LIKE.test(href)) {
        a.setAttribute('href', '#')
        a.setAttribute('data-file', href)
        a.classList.add('chat-file-link')
      }
    })
    doc.querySelectorAll('code').forEach(code => {
      const t = code.textContent?.trim() ?? ''
      if (t && PATH_LIKE.test(t)) {
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
