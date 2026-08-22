export type DiffLineType = 'hunk' | 'ctx' | 'add' | 'del' | 'meta'

export interface DiffLine {
  type: DiffLineType
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  header: string
  lines: DiffLine[]
}

// Parse a unified diff (single file) into hunks with line numbers. The raw
// text is what `git diff` / `git show` emits per file: header lines, then
// `@@ -a,b +c,d @@` hunks.
export function parseUnifiedDiff(raw: string): DiffHunk[] {
  const out: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const push = (line: DiffLine) => {
    if (!cur) return
    cur.lines.push(line)
    if (line.type === 'add') newLine++
    else if (line.type === 'del') oldLine++
    else if (line.type === 'ctx') {
      oldLine++
      newLine++
    }
  }

  for (const rawLine of raw.split('\n')) {
    const m = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (m) {
      cur = {
        oldStart: Number(m[1]),
        oldCount: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newCount: m[4] ? Number(m[4]) : 1,
        header: rawLine,
        lines: []
      }
      oldLine = Number(m[1])
      newLine = Number(m[3])
      out.push(cur)
      continue
    }
    if (!rawLine) {
      // Trailing newline from the final split; empty context lines in real
      // diffs always carry a leading space, so this is never content.
      continue
    }
    if (!cur) {
      // Outside any hunk (file header / binary) — skip content lines.
      continue
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      push({ type: 'add', oldLine: null, newLine, text: rawLine.slice(1) })
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      push({ type: 'del', oldLine, newLine: null, text: rawLine.slice(1) })
    } else if (rawLine === '\\ No newline at end of file') {
      push({ type: 'meta', oldLine: null, newLine: null, text: rawLine })
    } else {
      push({ type: 'ctx', oldLine, newLine, text: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine })
    }
  }
  return out
}
