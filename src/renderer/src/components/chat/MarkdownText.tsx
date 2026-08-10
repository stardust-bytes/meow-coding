import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { normalizeMarkdownTables } from './markdownTable'

interface Props {
  text: string
}

marked.setOptions({ gfm: true, breaks: true })

export default function MarkdownText({ text }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(normalizeMarkdownTables(text), { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [text])
  return <div className="chat-text chat-md" dangerouslySetInnerHTML={{ __html: html }} />
}
