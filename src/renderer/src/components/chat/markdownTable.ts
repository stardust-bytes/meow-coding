const DELIM_CELL_RE = /^:?-+:?$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(c => c.trim())
}

function delimiterCells(line: string): string[] | null {
  const cells = splitRow(line)
  if (cells.length === 0 || !cells.every(c => DELIM_CELL_RE.test(c))) return null
  return cells
}

// LLMs frequently emit a GFM table whose delimiter row has fewer (or more)
// column groups than the header row actually has — e.g. a 3-column header
// followed by "|---|---|". marked's GFM table parser requires the column
// counts to match and silently falls back to a plain paragraph otherwise,
// which is what "table doesn't render" looks like to the user. Repair the
// delimiter row's column count to match its header before handing off to marked.
export function normalizeMarkdownTables(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]
    if (!header.includes('|')) continue
    const headerCells = splitRow(header)
    if (headerCells.length < 2) continue
    const delimCells = delimiterCells(lines[i + 1])
    if (!delimCells || delimCells.length === headerCells.length) continue
    const fill = delimCells[delimCells.length - 1] || '---'
    const fixed = Array.from({ length: headerCells.length }, (_, idx) => delimCells[idx] ?? fill)
    lines[i + 1] = `|${fixed.join('|')}|`
  }
  return lines.join('\n')
}
