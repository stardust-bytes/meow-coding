import { bundledLanguagesInfo, createHighlighter, createOnigurumaEngine } from 'shiki'
import type { BundledLanguage, Highlighter } from 'shiki'

export const HIGHLIGHT_THEME = 'dark-plus'

// Extension → canonical bundled language id, resolved once from the static
// grammar registry (ids + aliases, e.g. ts → typescript, py → python). The
// registry is data-only, so building this map has no load cost.
const EXT_TO_LANG = new Map<string, string>()
for (const info of bundledLanguagesInfo) {
  EXT_TO_LANG.set(info.id, info.id)
  for (const alias of info.aliases ?? []) {
    if (!EXT_TO_LANG.has(alias)) EXT_TO_LANG.set(alias, info.id)
  }
}

let highlighterPromise: Promise<Highlighter> | null = null

// One lazy highlighter shared by every viewer popup: theme + oniguruma engine
// load once, individual language grammars load on first use via loadLanguage.
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [HIGHLIGHT_THEME],
    langs: [],
    engine: createOnigurumaEngine(() => import('shiki/wasm'))
  })
  return highlighterPromise
}

export function mapExtToLang(ext: string): string | undefined {
  const clean = ext.toLowerCase().replace(/^\./, '')
  if (!clean) return undefined
  return EXT_TO_LANG.get(clean)
}

export function isHighlightable(ext: string): boolean {
  return mapExtToLang(ext) !== undefined
}

// Returns Shiki's highlighted <pre> HTML (VS Code Dark+), or null on any
// failure — unknown grammar, wasm/grammar load error — so the caller falls
// back to its own plain-text rendering and the viewer never breaks.
export async function highlightCode(content: string, ext: string): Promise<string | null> {
  const lang = mapExtToLang(ext)
  if (!lang) return null
  try {
    const highlighter = await getHighlighter()
    await highlighter.loadLanguage(lang as BundledLanguage)
    return highlighter.codeToHtml(content, {
      lang: lang as BundledLanguage,
      theme: HIGHLIGHT_THEME
    })
  } catch {
    return null
  }
}
