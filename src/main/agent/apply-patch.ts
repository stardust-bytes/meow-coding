export interface PatchFileIO {
  readFile(filePath: string): string | null
  writeFile(filePath: string, content: string): void
  deleteFile(filePath: string): void
}

export interface AppliedFile {
  filePath: string
  created: boolean
  changed: boolean
}

interface Hunk {
  oldStart: number
  oldCount: number
  body: string[]
}

interface PatchSection {
  oldPath: string | null
  newPath: string | null
  hunks: Hunk[]
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function stripPrefix(p: string): string {
  if (p === '/dev/null') return p
  return p.replace(/^[ab]\//, '')
}

function parsePatch(patch: string): PatchSection[] {
  const sections: PatchSection[] = []
  let current: PatchSection | null = null
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('--- ')) {
      if (current && current.hunks.length === 0 && current.oldPath === null) {
        current.oldPath = stripPrefix(raw.slice(4))
      } else {
        current = { oldPath: stripPrefix(raw.slice(4)), newPath: null, hunks: [] }
        sections.push(current)
      }
    } else if (raw.startsWith('+++ ')) {
      if (!current) throw new Error('patch: +++ before ---')
      current.newPath = stripPrefix(raw.slice(4))
    } else if (raw.startsWith('@@ ')) {
      if (!current) throw new Error('patch: hunk before header')
      const m = HUNK_RE.exec(raw)
      if (!m) throw new Error(`patch: malformed hunk header: ${raw}`)
      current.hunks.push({
        oldStart: Number(m[1]),
        oldCount: m[2] !== undefined ? Number(m[2]) : 1,
        body: []
      })
    } else if (raw === '') {
      continue
    } else if (current && current.hunks.length > 0) {
      current.hunks[current.hunks.length - 1].body.push(raw)
    } else if (raw.trim() !== '') {
      throw new Error(`patch: unexpected line: ${raw}`)
    }
  }
  return sections.filter(s => s.newPath !== null)
}

function applyHunk(lines: string[], hunk: Hunk): string[] {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const line of hunk.body) {
    if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      const content = line.slice(1)
      oldLines.push(content)
      newLines.push(content)
    } else if (line.startsWith('\\')) {
      continue
    } else {
      throw new Error(`patch: malformed hunk line: ${line}`)
    }
  }
  if (oldLines.length !== hunk.oldCount) {
    throw new Error(
      `patch: hunk line count mismatch (expected ${hunk.oldCount}, got ${oldLines.length})`
    )
  }
  if (hunk.oldCount === 0) {
    const at = Math.max(0, hunk.oldStart)
    return [...lines.slice(0, at), ...newLines, ...lines.slice(at)]
  }
  const start = hunk.oldStart - 1
  for (let i = 0; i < oldLines.length; i++) {
    if (start + i >= lines.length) {
      throw new Error('patch: hunk extends past end of file')
    }
    if (lines[start + i] !== oldLines[i]) {
      throw new Error(
        `patch: context mismatch at line ${start + i + 1} (expected "${oldLines[i]}", got "${lines[start + i]}")`
      )
    }
  }
  return [...lines.slice(0, start), ...newLines, ...lines.slice(start + oldLines.length)]
}

function applySection(section: PatchSection, io: PatchFileIO): AppliedFile {
  const isDelete = section.newPath === '/dev/null'
  if (isDelete) {
    if (section.oldPath && section.oldPath !== '/dev/null') io.deleteFile(section.oldPath)
    return { filePath: section.oldPath ?? '', created: false, changed: true }
  }
  const target = section.newPath as string
  const original = io.readFile(target)
  const lines = original === null ? [] : original.split('\n')
  if (original !== null && original.endsWith('\n')) lines.pop()
  const hadTrailingNL = original !== null ? original.endsWith('\n') : true

  const descending = [...section.hunks].sort((a, b) => b.oldStart - a.oldStart)
  let next = lines
  for (const hunk of descending) {
    next = applyHunk(next, hunk)
  }
  const content = next.join('\n') + (hadTrailingNL ? '\n' : '')
  io.writeFile(target, content)
  return { filePath: target, created: original === null, changed: true }
}

export function applyUnifiedPatch(patch: string, io: PatchFileIO): AppliedFile[] {
  const sections = parsePatch(patch)
  return sections.map(section => applySection(section, io))
}
