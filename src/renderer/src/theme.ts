export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'meow.theme'

export function getTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme?: Theme): void {
  const resolved = theme ?? getTheme()
  document.documentElement.setAttribute('data-theme', resolved)
  // Keep the Windows titleBarOverlay min/max/close buttons in step with the
  // app theme; without this they stay dark even in light mode. The main window
  // is the only one with an overlay, but the call is harmless from popups.
  void window.api?.setTitleBarTheme(resolved)
}

// Popup windows (Git viewer, FileViewer) are separate renderers; they re-apply
// the theme when the main window toggles it via localStorage (`storage` fires
// across same-origin windows).
export function watchTheme(onChange?: (theme: Theme) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return
    const theme = getTheme()
    applyTheme(theme)
    onChange?.(theme)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
