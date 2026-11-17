import { useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { setUiLanguage, UI_LANGUAGES } from '../i18n.ts'
import { canCaptureScreen, type Busy } from '../lib/source.ts'
import { ArrowIcon, ClipboardIcon, LinkIcon, LogoIcon, ScreenIcon, UploadIcon } from './icons.tsx'

interface Props {
  busy: Busy | null
  onPick: () => void
  onPaste: () => void
  onCapture: () => void
  onUrl: (value: string) => boolean
}

export function Landing({ busy, onPick, onPaste, onCapture, onUrl }: Props) {
  const { t, i18n } = useTranslation()
  const [url, setUrl] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (onUrl(url)) setUrl('')
  }

  return (
    <main className="landing">
      <div className="landing-inner">
        <header className="hero">
          <span className="brand-mark">
            <LogoIcon />
          </span>
          <h1>{t('app.title')}</h1>
          <p>{t('landing.tagline')}</p>
        </header>

        <section className="intake" aria-busy={busy !== null}>
          <button type="button" className="dropzone" onClick={onPick} disabled={busy !== null}>
            <span className="dropzone-icon">{busy ? <span className="spinner" /> : <UploadIcon width="26" height="26" />}</span>
            <span className="dropzone-title">{busy ? t(`busy.${busy}`) : t('landing.drop')}</span>
            <span className="dropzone-hint">
              {busy ? t('landing.wait') : <Trans i18nKey="landing.pasteHint" components={{ kbd: <kbd /> }} />}
            </span>
          </button>

          <div className="intake-row">
            <form className="url-form" onSubmit={submit}>
              <LinkIcon className="url-icon" />
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t('landing.urlPlaceholder')}
                aria-label={t('landing.urlLabel')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy !== null}
              />
              <button type="submit" className="icon-button accent" aria-label={t('landing.urlSubmit')} disabled={busy !== null || !url.trim()}>
                <ArrowIcon />
              </button>
            </form>
            <button type="button" className="button" onClick={onPaste} disabled={busy !== null}>
              <ClipboardIcon />
              {t('landing.paste')}
            </button>
            {canCaptureScreen && (
              <button type="button" className="button" onClick={onCapture} disabled={busy !== null}>
                <ScreenIcon />
                {t('landing.screenshot')}
              </button>
            )}
          </div>
        </section>

        <p className="privacy">{t('landing.privacy')}</p>

        <div className="ui-language" role="group" aria-label={t('landing.uiLanguage')}>
          {UI_LANGUAGES.map((language) => (
            <button
              key={language.code}
              type="button"
              lang={language.code}
              className={i18n.resolvedLanguage === language.code ? 'active' : undefined}
              aria-pressed={i18n.resolvedLanguage === language.code}
              onClick={() => setUiLanguage(language.code)}
            >
              {language.name}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
