import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoadedImage } from '../lib/image.ts'
import { formatBytes } from '../lib/format.ts'
import { setUiLanguage, UI_LANGUAGES } from '../i18n.ts'
import { setTheme, useTheme } from '../lib/theme.ts'
import { CheckIcon, GlobeIcon, ImageIcon, LogoIcon, MoonIcon, SunIcon } from './icons.tsx'

export function Header({ image }: { image: LoadedImage | null }) {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">
          <LogoIcon />
        </span>
        <span className="brand-name">ocr.tkalve.dev</span>
        {image && (
          <span className="file-info">
            <ImageIcon width="20" height="20" />
            <span className="file-name" title={image.name}>
              {image.name}
            </span>
            <span className="file-size">{formatBytes(image.size)}</span>
          </span>
        )}
      </div>

      <div className="header-actions">
        <div className="menu" ref={menu}>
          <button
            type="button"
            className="square-button"
            aria-label={t('landing.uiLanguage')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <GlobeIcon />
          </button>
          {open && (
            <div className="menu-list" role="menu">
              {UI_LANGUAGES.map((language) => {
                const active = i18n.resolvedLanguage === language.code
                return (
                  <button
                    key={language.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    lang={language.code}
                    className={active ? 'active' : undefined}
                    onClick={() => {
                      setUiLanguage(language.code)
                      setOpen(false)
                    }}
                  >
                    {language.name}
                    {active && <CheckIcon />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          className="square-button"
          aria-label={t(next === 'light' ? 'theme.toLight' : 'theme.toDark')}
          onClick={() => setTheme(next)}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  )
}
