const NAMES: Record<string, string> = {
  dan: 'Danish',
  deu: 'German',
  eng: 'English',
  fra: 'French',
  ita: 'Italian',
  nld: 'Dutch',
  nor: 'Norwegian',
  por: 'Portuguese',
  spa: 'Spanish',
  swe: 'Swedish',
}

export interface Language {
  code: string
  name: string
}

/** Shown first, in this order; the rest follow alphabetically. */
const PINNED = ['eng', 'nor']

const rank = (code: string) => (PINNED.includes(code) ? PINNED.indexOf(code) : PINNED.length)

export const LANGUAGES: Language[] = __OCR_LANGUAGES__
  .map((code) => ({ code, name: NAMES[code] ?? code }))
  .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name))

const STORAGE_KEY = 'ocr.language'
const FALLBACK = LANGUAGES.some((l) => l.code === 'eng') ? 'eng' : (LANGUAGES[0]?.code ?? 'eng')

export function loadLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  return FALLBACK
}

export function saveLanguage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Not persisting the choice is harmless.
  }
}
