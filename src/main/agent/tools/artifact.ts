import path from 'node:path'
import type { ArtifactEntry } from '../../../shared/types'
import type { ToolContext } from './types'

export function recordArtifact(ctx: ToolContext, absPath: string, kind: 'create' | 'edit'): void {
  if (!ctx.onArtifact) return
  const rel = path.relative(ctx.cwd, absPath).replace(/\\/g, '/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return // outside project root
  ctx.onArtifact({
    path: rel,
    absPath,
    kind,
    agentId: ctx.agentId ?? '',
    agentName: ''
  })
}
