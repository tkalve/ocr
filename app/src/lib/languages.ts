import i18n from '../i18n.ts'

export interface Language {
  code: string
  name: string
}

/** Tesseract codes of the bundled languages. */
const CODES: string[] = __OCR_LANGUAGES__

/** Shown first, in this order; the rest follow alphabetically. */
const PINNED = ['eng', 'nor']

const rank = (code: string) => (PINNED.includes(code) ? PINNED.indexOf(code) : PINNED.length)

/** The choice that reads the image in each of AUTO_LANGUAGES and keeps the best result. */
export const AUTO = 'auto'

/** Kept short: every language here is a full extra read of the image. */
export const AUTO_LANGUAGES = ['eng', 'nor'].filter((code) => CODES.includes(code))

const CHOICES = AUTO_LANGUAGES.length > 1 ? [AUTO, ...CODES] : CODES

/** A language's name in the interface language, or its code when it has no translation yet. */
export function languageName(code: string): string {
  const key = `languages.${code}`
  return i18n.exists(key) ? i18n.t(key as 'languages.eng') : code
}

/** What the user can pick from, named and sorted for the current interface language. */
export function languageChoices(): Language[] {
  return CHOICES.map((code) => ({ code, name: languageName(code) })).sort((a, b) => {
    if (a.code === AUTO || b.code === AUTO) return a.code === AUTO ? -1 : 1
    return rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, i18n.language)
  })
}

/** The languages to read with for a choice. */
export const languagesFor = (choice: string) => (choice === AUTO ? AUTO_LANGUAGES : [choice])

const STORAGE_KEY = 'ocr.language'
const FALLBACK = CHOICES[0] ?? 'eng'

export function loadLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && CHOICES.includes(stored)) return stored
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
