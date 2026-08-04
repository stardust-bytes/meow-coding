import { readFileSync, statSync } from 'node:fs'
import { globSync } from 'glob'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'

const MAX_RESULTS = 200
const MAX_FILE = 1024 * 1024

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a regular expression and return matching file:line entries.',
  schema: z.object({
    pattern: z.string().describe('Regular expression to search for.'),
    path: z.string().optional().describe('Directory to search (default: project root).'),
    include: z.array(z.string()).optional().describe('Glob patterns for files to include, e.g. ["*.ts"].')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { pattern, path: searchPath, include } = input as unknown as {
      pattern: string
      path?: string
      include?: string[]
    }
    let regex: RegExp
    try {
      regex = new RegExp(pattern)
    } catch {
      return { error: `grep: invalid regex: ${pattern}` }
    }
    const dir = resolveCwd(ctx.cwd, searchPath ?? '.')
    const includePatterns = include && include.length > 0 ? include : ['**/*']
    const candidates = globSync(includePatterns, {
      cwd: dir,
      nodir: true,
      posix: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: false
    })
    const hits: string[] = []
    for (const rel of candidates.slice(0, 500)) {
      const full = resolveCwd(dir, rel)
      let text: string
      try {
        const stat = statSync(full)
        if (!stat.isFile() || stat.size > MAX_FILE) continue
        text = readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length && hits.length < MAX_RESULTS; i++) {
        if (regex.test(lines[i])) {
          hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
        }
      }
      if (hits.length >= MAX_RESULTS) break
    }
    if (hits.length === 0) return { output: '(no matches)' }
    return { output: hits.join('\n') }
  }
}
