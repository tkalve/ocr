import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import nb from './locales/nb.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}

/** Interface languages, each named in its own language. */
export const UI_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'nb', name: 'Norsk' },
] as const

export type UiLanguage = (typeof UI_LANGUAGES)[number]['code']

const STORAGE_KEY = 'ocr.uiLanguage'
const isUiLanguage = (code: unknown): code is UiLanguage => UI_LANGUAGES.some((l) => l.code === code)

/** The saved choice, or else the first browser language we have a translation for. */
function initialLanguage(): UiLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isUiLanguage(stored)) return stored
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const primary = tag.toLowerCase().split('-')[0]
    // Bokmål, Nynorsk and the generic "no" all get the Norwegian translation.
    if (primary === 'nb' || primary === 'nn' || primary === 'no') return 'nb'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

function applyToDocument() {
  document.documentElement.lang = i18n.language
  document.title = i18n.t('app.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.t('app.description'))
}

i18n.on('languageChanged', applyToDocument)

void i18n.use(initReactI18next).init({
  // Both translations must have exactly the same keys.
  resources: { en: { translation: en satisfies typeof nb }, nb: { translation: nb satisfies typeof en } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
})
applyToDocument()

export function setUiLanguage(code: UiLanguage): void {
  void i18n.changeLanguage(code)
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Not persisting the choice is harmless.
  }
}

export default i18n
