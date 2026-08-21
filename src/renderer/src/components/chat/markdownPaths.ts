// Looks like a local file path: dot-relative, slash-relative, a Windows drive
// (C:\), or ends with a common file extension. Paths contain no whitespace, so
// a long prose block or code snippet that merely ends in .ext is not a path.
const PATH_LIKE = /^(\.{0,2}[\\/]|[A-Za-z]:[\\/]|[\\/])|\.\w{1,6}$/i

export function isPathLike(text: string): boolean {
  const t = text.trim()
  if (!t || /\s/.test(t)) return false
  return PATH_LIKE.test(t)
}
