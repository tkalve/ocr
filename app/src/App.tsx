import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landing } from './components/Landing.tsx'
import { Viewer } from './components/Viewer.tsx'
import { UploadIcon } from './components/icons.tsx'
import { loadImage, type LoadedImage } from './lib/image.ts'
import { loadLanguage, saveLanguage } from './lib/languages.ts'
import {
  CancelledError,
  captureScreen,
  extract,
  fetchImage,
  normalizeUrl,
  readClipboard,
  type Busy,
  type Extracted,
  type ImageSource,
} from './lib/source.ts'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))

/** Whether a drag carries something we could turn into an image. */
const isUsefulDrag = (event: DragEvent) =>
  Boolean(event.dataTransfer?.types.some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html'))

export default function App() {
  const { t } = useTranslation()
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [dragging, setDragging] = useState(false)
  const [language, setLanguage] = useState(loadLanguage)

  const request = useRef(0)
  const current = useRef<LoadedImage | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const notify = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setToast({ id: Date.now() + Math.random(), message, kind })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2000)
    return () => clearTimeout(timer)
  }, [toast])

  /** Loads a new image; the latest request always wins. */
  const open = useCallback(
    async (kind: Busy, source: () => Promise<ImageSource>) => {
      const id = ++request.current
      setBusy(kind)
      try {
        const { blob, name } = await source()
        const loaded = await loadImage(blob, name)
        if (id !== request.current) {
          URL.revokeObjectURL(loaded.url)
          return
        }
        if (current.current) URL.revokeObjectURL(current.current.url)
        current.current = loaded
        setToast(null)
        document.getSelection()?.removeAllRanges()
        setImage(loaded)
      } catch (error) {
        if (id === request.current && !(error instanceof CancelledError)) {
          notify(error instanceof Error ? error.message : t('errors.openFailed'), 'error')
        }
      } finally {
        if (id === request.current) setBusy(null)
      }
    },
    [notify, t],
  )

  const openFile = useCallback(
    (file: File) => open('opening', async () => ({ blob: file, name: file.name || t('names.pasted') })),
    [open, t],
  )
  const openUrl = useCallback((url: string) => open('fetching', () => fetchImage(url)), [open])
  const capture = useCallback(() => void open('capturing', captureScreen), [open])

  const openExtracted = useCallback(
    (found: Extracted, emptyMessage: string) => {
      if (found.kind === 'file') void openFile(found.file)
      else if (found.kind === 'url') void openUrl(found.url)
      else notify(emptyMessage, 'error')
    },
    [notify, openFile, openUrl],
  )

  const close = useCallback(() => {
    request.current++
    if (current.current) URL.revokeObjectURL(current.current.url)
    current.current = null
    setBusy(null)
    setImage(null)
  }, [])

  const submitUrl = useCallback(
    (value: string) => {
      const url = normalizeUrl(value, true)
      if (!url) {
        notify(t('errors.notLink'), 'error')
        return false
      }
      void openUrl(url)
      return true
    },
    [notify, openUrl, t],
  )

  const pasteFromClipboard = useCallback(async () => {
    try {
      openExtracted(await readClipboard(), t('errors.clipboardEmpty'))
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errors.clipboardRead'), 'error')
    }
  }, [notify, openExtracted, t])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return
      const found = extract(event.clipboardData)
      // Inside a text field only an actual image is ours; text is left to the field.
      if (isTextField(event.target) && found.kind !== 'file') return
      if (found.kind === 'none' && !found.hadContent) return
      event.preventDefault()
      openExtracted(found, t('errors.pasteEmpty'))
    }

    let depth = 0
    const onDragEnter = (event: DragEvent) => {
      if (!isUsefulDrag(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!isUsefulDrag(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!isUsefulDrag(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      depth = 0
      setDragging(false)
      if (!event.dataTransfer || !isUsefulDrag(event)) return
      event.preventDefault()
      openExtracted(extract(event.dataTransfer), t('errors.dropEmpty'))
    }

    document.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openExtracted, t])

  const pick = useCallback(() => fileInput.current?.click(), [])

  return (
    <>
      {image ? (
        <Viewer
          key={image.url}
          image={image}
          busy={busy}
          language={language}
          onLanguage={(code) => {
            setLanguage(code)
            saveLanguage(code)
          }}
          onPick={pick}
          onCapture={capture}
          onClose={close}
          notify={notify}
        />
      ) : (
        <Landing busy={busy} onPick={pick} onPaste={pasteFromClipboard} onCapture={capture} onUrl={submitUrl} />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void openFile(file)
        }}
      />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <UploadIcon width="34" height="34" />
            <span>{t('landing.dropOverlay')}</span>
          </div>
        </div>
      )}

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.message}
          </div>
        )}
      </div>
    </>
  )
}
