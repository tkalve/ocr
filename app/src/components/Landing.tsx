import { useState, type FormEvent } from 'react'
import { ArrowIcon, ClipboardIcon, LinkIcon, LogoIcon, UploadIcon } from './icons.tsx'

interface Props {
  busy: string | null
  onPick: () => void
  onPaste: () => void
  onUrl: (value: string) => boolean
}

export function Landing({ busy, onPick, onPaste, onUrl }: Props) {
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
          <h1>Copy text from any image</h1>
          <p>Screenshots, photos, scans. Give it an image and select the text right on top of it.</p>
        </header>

        <section className="intake" aria-busy={busy !== null}>
          <button type="button" className="dropzone" onClick={onPick} disabled={busy !== null}>
            <span className="dropzone-icon">{busy ? <span className="spinner" /> : <UploadIcon width="26" height="26" />}</span>
            <span className="dropzone-title">{busy ?? 'Drop an image here, or click to browse'}</span>
            <span className="dropzone-hint">
              {busy ? 'One moment…' : (
                <>
                  or paste one with <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd>
                </>
              )}
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
                placeholder="Paste a link to an image"
                aria-label="Image URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy !== null}
              />
              <button type="submit" className="icon-button accent" aria-label="Load image from URL" disabled={busy !== null || !url.trim()}>
                <ArrowIcon />
              </button>
            </form>
            <button type="button" className="button" onClick={onPaste} disabled={busy !== null}>
              <ClipboardIcon />
              Paste
            </button>
          </div>
        </section>

        <p className="privacy">Text recognition runs entirely in your browser. Your images are never uploaded.</p>
      </div>
    </main>
  )
}
