import { bundledLanguagesInfo, createHighlighter, createOnigurumaEngine } from 'shiki'
import type { BundledLanguage, Highlighter } from 'shiki'

export const HIGHLIGHT_THEMES = ['dark-plus', 'light-plus'] as const
export type HighlightTheme = (typeof HIGHLIGHT_THEMES)[number]

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

// One lazy highlighter shared by every viewer popup: both themes + oniguruma
// engine load once, individual language grammars load on first use via
// loadLanguage.
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [...HIGHLIGHT_THEMES],
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

export function currentHighlightTheme(): HighlightTheme {
  try {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light-plus' : 'dark-plus'
  } catch {
    return 'dark-plus'
  }
}

// Warms the engine + grammar for `ext` so the first real highlight is fast.
// Called in parallel with the file-content IPC read; without this the popup's
// first highlight pays engine init (~50ms) + grammar compile (~200ms) after
// the content is already on screen (plain text flashes, then colors pop in).
// A short, representative snippet per language family so the warm pass hits
// the grammar's hot regexes (comments, strings, keywords, functions, numbers).
// Oniguruma compiles lazily per pattern, so tokenizing '' warms nothing.
const WARM_SNIPPETS: Record<string, string> = {
  typescript: `import { x } from 'y'\nconst s = "warm"\nfunction f(a: number): string { return String(a) } // warm\n`,
  javascript: `import { x } from 'y'\nconst s = "warm"\nfunction f(a) { return String(a) } // warm\n`,
  typescriptreact: `import { useState } from 'react'\nfunction C({ a }: { a: number }) { return <div>{a}</div> }\n`,
  javascriptreact: `import { useState } from 'react'\nfunction C({ a }) { return <div>{a}</div> }\n`,
  python: `import os\n# warm\ndef f(a: int) -> str:\n    return str(a)\n`,
  rust: `use std::fs;\n// warm\nfn main() { let s = String::from("warm"); println!("{}", s); }\n`,
  go: `package main\n// warm\nfunc main() { s := "warm"; println(s) }\n`,
  json: `{ "warm": true, "n": 42, "s": "str" }\n`,
  yaml: `warm: true\nlist:\n  - item1\n  - item2\n`,
  toml: `warm = true\n[section]\nkey = "value"\n`,
  markdown: `# Warm\n\nSome **bold** text and \`code\`.\n`,
  css: `/* warm */\n.a { color: red; padding: 4px; }\n`,
  scss: `/* warm */\n.a { color: red; padding: 4px; }\n`,
  html: `<!-- warm -->\n<div class="a">text</div>\n`,
  xml: `<!-- warm -->\n<root attr="val">text</root>\n`,
  shell: `#!/bin/bash\n# warm\necho "warm"\n`,
  bash: `#!/bin/bash\n# warm\necho "warm"\n`,
  sql: `-- warm\nSELECT * FROM t WHERE id = 1;\n`,
  dockerfile: `FROM node:20\n# warm\nRUN echo "warm"\n`,
}

export async function preloadLanguage(ext: string): Promise<void> {
  const lang = mapExtToLang(ext)
  if (!lang) return
  const highlighter = await getHighlighter()
  await highlighter.loadLanguage(lang as BundledLanguage)
  // Compile the grammar's hot patterns once so the real highlight is
  // near-instant (~50ms instead of ~200ms).
  const warm = WARM_SNIPPETS[lang] ?? `const x = 1 // warm\nfunction f() { return "s" }`
  for (const theme of HIGHLIGHT_THEMES) {
    highlighter.codeToHtml(warm, { lang: lang as BundledLanguage, theme })
  }
}

// Returns Shiki's highlighted <pre> HTML, or null on any failure — unknown
// grammar, wasm/grammar load error — so the caller falls back to its own
// plain-text rendering and the viewer never breaks. Theme is selected from
// the current data-theme attribute (dark-plus / light-plus).
export async function highlightCode(content: string, ext: string): Promise<string | null> {
  const lang = mapExtToLang(ext)
  if (!lang) return null
  try {
    const highlighter = await getHighlighter()
    await highlighter.loadLanguage(lang as BundledLanguage)
    return highlighter.codeToHtml(content, {
      lang: lang as BundledLanguage,
      theme: currentHighlightTheme()
    })
  } catch {
    return null
  }
}