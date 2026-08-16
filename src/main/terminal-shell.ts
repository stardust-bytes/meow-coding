export function resolveShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === 'win32') return 'cmd.exe'
  return env.SHELL || '/bin/bash'
}
