export function parseCommandInput(raw: string): { isCommand: boolean; prefix: string } {
  const isCommand = raw.startsWith('/') && !raw.includes(' ')
  return { isCommand, prefix: isCommand ? raw.slice(1).toLowerCase() : '' }
}
