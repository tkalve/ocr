import { useTranslation } from 'react-i18next'
import type { Busy } from '../lib/source.ts'
import { ClipboardIcon, UploadIcon } from './icons.tsx'

interface Props {
  busy: Busy | null
  onPick: () => void
  onPaste: () => void
}

export function Landing({ busy, onPick, onPaste }: Props) {
  const { t } = useTranslation()
  const disabled = busy !== null

  return (
    <div className="dropzone" aria-busy={disabled}>
      <button type="button" className="dropzone-hit" onClick={onPick} disabled={disabled} aria-label={t('landing.drop')} />
      <div className="dropzone-content">
        <span className="dropzone-icon">{busy ? <span className="spinner" /> : <UploadIcon width="28" height="28" />}</span>
        <h1 className="dropzone-title">{busy ? t(`busy.${busy}`) : t('landing.drop')}</h1>
        <p className="dropzone-hint">
          {busy ? (
            t('landing.wait')
          ) : (
            <>
              <span className="pointer-only">{t('landing.browse')}</span>
              <span className="touch-only">{t('landing.browseTouch')}</span>
            </>
          )}
        </p>
        <button type="button" className="button warm" onClick={onPaste} disabled={disabled}>
          <ClipboardIcon />
          {t('landing.paste')}
        </button>
        <p className="dropzone-keys pointer-only">{t('landing.pasteKeys')}</p>
      </div>
    </div>
  )
}
