import { GitStatusService } from '../git-status-service'

export interface EnvSnapshot {
  platform: NodeJS.Platform
  shell: string
  cwd: string
  date: string
  git: { branch: string | null; dirtyCount: number } | null
}

export function detectShell(): string {
  return process.env.SHELL ?? process.env.COMSPEC ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')
}

export async function snapshotEnvironment(cwd: string): Promise<EnvSnapshot> {
  // GitStatusService.get has a 5s timeout and resolves null on any failure, so
  // a slow or missing git never blocks a turn.
  const git = await new GitStatusService().get(cwd)
  return {
    platform: process.platform,
    shell: detectShell(),
    cwd,
    date: new Date().toISOString(),
    git
  }
}

// Fresh git state for tool-result reminders; '' when not a repo or git fails.
export async function gitFreshnessReminder(cwd: string): Promise<string> {
  const git = await new GitStatusService().get(cwd)
  if (!git) return ''
  const branch = git.branch ?? '(detached)'
  return `<system-reminder>\nGit: on ${branch}, ${git.dirtyCount} dirty file(s).\n</system-reminder>`
}
