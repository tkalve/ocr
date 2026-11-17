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

/** The choice that reads the image in each of AUTO_LANGUAGES and keeps the best result. */
export const AUTO = 'auto'

/** Kept short: every language here is a full extra read of the image. */
export const AUTO_LANGUAGES = ['eng', 'nor'].filter((code) => __OCR_LANGUAGES__.includes(code))

/** What the user can pick from. */
export const LANGUAGE_CHOICES: Language[] =
  AUTO_LANGUAGES.length > 1 ? [{ code: AUTO, name: 'Auto' }, ...LANGUAGES] : LANGUAGES

export const languageName = (code: string) => NAMES[code] ?? code

/** The languages to read with for a choice. */
export const languagesFor = (choice: string) => (choice === AUTO ? AUTO_LANGUAGES : [choice])

const STORAGE_KEY = 'ocr.language'
const FALLBACK = LANGUAGE_CHOICES[0]?.code ?? 'eng'

export function loadLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && LANGUAGE_CHOICES.some((l) => l.code === stored)) return stored
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
