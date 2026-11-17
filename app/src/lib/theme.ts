import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ocr.theme'
const listeners = new Set<() => void>()

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current = initialTheme()
document.documentElement.dataset.theme = current

export function setTheme(theme: Theme): void {
  current = theme
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Not persisting the choice is harmless.
  }
  listeners.forEach((listener) => listener())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
