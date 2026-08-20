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

// Warms the engine + grammar for `ext` so the first real highlight is fast.
// Called in parallel with the file-content IPC read; without this the popup's
// first highlight pays engine init (~50ms) + grammar compile (~200ms) after
// the content is already on screen (plain text flashes, then colors pop in).
// A short, representative snippet per language family so the warm pass hits
// the grammar's hot regexes (comments, strings, keywords, functions, numbers).
// Oniguruma compiles lazily per pattern, so tokenizing '' warms nothing.
const WARM_SNIPPETS: Record<string, string> = {
  typescript: `import { a } from 'b'\nexport function f(x: number): number { return x + 1 } // hi\nconst s = "str"`,
  javascript: `import { a } from 'b'\nexport function f(x) { return x + 1 } // hi\nconst s = "str"`,
  tsx: `import { useState } from 'react'\nexport function A() { const [n, setN] = useState(0)\nreturn <div onClick={() => setN(n + 1)}>{n}</div> } // hi`,
  jsx: `import { useState } from 'react'\nexport function A() { const [n, setN] = useState(0)\nreturn <div onClick={() => setN(n + 1)}>{n}</div> } // hi`,
  python: `import os\ndef f(x: int) -> int:\n    return x + 1  # hi\ns = "str"`,
  java: `import java.util.*;\npublic class A { int x = 1; // hi\n  public int f(int n) { return n + 1; } }`,
  vue: `<template><p>{{ msg }}</p></template>\n<script setup>\nconst msg = "hi"\n</script>`,
  c: `#include <stdio.h>\nint main(void) { int x = 1; // hi\n  printf("hi"); return 0; }`,
  cpp: `#include <vector>\nint main() { int x = 1; // hi\n  auto v = std::vector<int>{1,2,3}; return 0; }`,
  css: `.a { color: red; /* hi */ }\n#b { margin: 0 1px; }`,
  json: `{ "a": 1, "b": [1, 2, 3], "c": "hi" }`,
  shellscript: `#!/bin/bash\nx=1\necho "hi" # comment\nfor i in 1 2 3; do echo $i; done`
}

export async function preloadLanguage(ext: string): Promise<void> {
  const lang = mapExtToLang(ext)
  if (!lang) return
  const highlighter = await getHighlighter()
  await highlighter.loadLanguage(lang as BundledLanguage)
  // Compile the grammar's hot patterns once so the real highlight is
  // near-instant (~50ms instead of ~200ms).
  const warm = WARM_SNIPPETS[lang] ?? `const x = 1 // warm\nfunction f() { return "s" }`
  highlighter.codeToHtml(warm, { lang: lang as BundledLanguage, theme: HIGHLIGHT_THEME })
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
