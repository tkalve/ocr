import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BACKDROP_COLORS, type LoadedImage } from '../lib/image.ts'
import { LANGUAGES } from '../lib/languages.ts'
import { recognize, type OcrProgress, type OcrResult } from '../lib/ocr.ts'
import { copyText, selectedText, selectionTouches } from '../lib/selection.ts'
import { TextLayer } from './TextLayer.tsx'
import { canCaptureScreen } from '../lib/source.ts'
import { CopyIcon, ImageIcon, LogoIcon, MinusIcon, PlusIcon, RegionsIcon, ScreenIcon } from './icons.tsx'

type OcrState =
  | { status: 'running'; progress: OcrProgress }
  | { status: 'done'; result: OcrResult }
  | { status: 'error'; message: string }

interface Props {
  image: LoadedImage
  busy: string | null
  language: string
  onLanguage: (code: string) => void
  onPick: () => void
  onCapture: () => void
  onClose: () => void
  notify: (message: string, kind?: 'info' | 'error') => void
}

const STAGE_PADDING = 28
const MAX_FIT_SCALE = 3
const MAX_SCALE = 8
const ZOOM_STEP = 1.3
const STARTING: OcrState = { status: 'running', progress: { label: 'Starting OCR engine', value: null } }

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function Viewer({ image, busy, language, onLanguage, onPick, onCapture, onClose, notify }: Props) {
  // Results are tagged with the run that produced them, so a new run reads as "starting" immediately.
  const [stored, setStored] = useState<{ run: string; state: OcrState } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [showRegions, setShowRegions] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const selectionText = useRef('')

  const run = `${language}:${attempt}`
  const ocr = stored?.run === run ? stored.state : STARTING

  useEffect(() => {
    const controller = new AbortController()
    const set = (state: OcrState) => {
      if (!controller.signal.aborted) setStored({ run, state })
    }
    recognize(image, language, (progress) => set({ status: 'running', progress }), controller.signal).then(
      (result) => set({ status: 'done', result }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        set({ status: 'error', message: 'Text recognition failed. Check your connection and try again.' })
      },
    )
    return () => controller.abort()
  }, [image, language, run])

  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fit = stage
    ? Math.max(
        0.01,
        Math.min(
          (stage.width - STAGE_PADDING * 2) / image.width,
          (stage.height - STAGE_PADDING * 2) / image.height,
          MAX_FIT_SCALE,
        ),
      )
    : null
  const maxZoom = fit ? Math.max(1, MAX_SCALE / fit) : 1
  const scale = fit ? fit * Math.min(zoom, maxZoom) : null

  // Keep the point at the centre of the viewport in place while zooming.
  const previousScale = useRef<number | null>(null)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const previous = previousScale.current
    previousScale.current = scale
    if (!scroller || !scale || !previous || previous === scale) return
    const ratio = scale / previous
    scroller.scrollLeft = (scroller.scrollLeft + scroller.clientWidth / 2) * ratio - scroller.clientWidth / 2
    scroller.scrollTop = (scroller.scrollTop + scroller.clientHeight / 2) * ratio - scroller.clientHeight / 2
  }, [scale])

  const changeZoom = (factor: number) => setZoom((z) => Math.min(maxZoom, Math.max(1, Math.min(z, maxZoom) * factor)))

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const selection = document.getSelection()
      const layer = layerRef.current
      const text = selectionTouches(layer, selection) && layer ? selectedText(layer, selection) : ''
      // Keep the last non-empty text: tapping "Copy" on touch devices can clear the selection first.
      if (text) selectionText.current = text
      setHasSelection(text !== '')
      if (text) setHintDismissed(true)
    }
    const onSelectionChange = () => {
      frame ||= requestAnimationFrame(update)
    }

    const onCopy = (event: ClipboardEvent) => {
      const selection = document.getSelection()
      const layer = layerRef.current
      if (!layer || !selectionTouches(layer, selection) || !event.clipboardData) return
      const text = selectedText(layer, selection)
      if (!text) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
      notify('Copied to clipboard')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      const layer = layerRef.current
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a' && layer) {
        event.preventDefault()
        document.getSelection()?.selectAllChildren(layer)
      } else if (event.key === 'Escape') {
        document.getSelection()?.removeAllRanges()
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('copy', onCopy)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [notify])

  async function copy(text: string) {
    if (!text) return
    if (await copyText(text)) notify('Copied to clipboard')
    else notify('Could not access the clipboard.', 'error')
  }

  const result = ocr.status === 'done' ? ocr.result : null
  const hasText = result !== null && result.lines.length > 0
  const running = ocr.status === 'running'

  return (
    <div className="viewer">
      <header className="toolbar">
        <button type="button" className="brand" onClick={onClose} title="Start over">
          <span className="brand-mark small">
            <LogoIcon width="16" height="16" />
          </span>
          <span className="file-name" title={image.name}>
            {image.name}
          </span>
        </button>

        <div className="toolbar-group">
          <label className="select">
            <span className="visually-hidden">Language of the text</span>
            <select value={language} onChange={(e) => onLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => changeZoom(1 / ZOOM_STEP)} disabled={zoom <= 1}>
              <MinusIcon />
            </button>
            <button type="button" className="zoom-value" onClick={() => setZoom(1)} title="Fit to window">
              {scale ? `${Math.round(scale * 100)}%` : '–'}
            </button>
            <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= maxZoom}>
              <PlusIcon />
            </button>
          </div>

          <button
            type="button"
            className={`icon-button${showRegions ? ' active' : ''}`}
            aria-pressed={showRegions}
            aria-label="Highlight detected text"
            title="Highlight detected text"
            onClick={() => setShowRegions((v) => !v)}
            disabled={!hasText}
          >
            <RegionsIcon />
          </button>

          {canCaptureScreen && (
            <button
              type="button"
              className="icon-button"
              aria-label="Take a screenshot"
              title="Take a screenshot"
              onClick={onCapture}
              disabled={busy !== null}
            >
              <ScreenIcon />
            </button>
          )}

          <button type="button" className="button primary" onClick={onPick} disabled={busy !== null}>
            <ImageIcon />
            <span className="hide-narrow">{busy ?? 'New image'}</span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="stage" ref={stageRef}>
          <div className="stage-scroll" ref={scrollRef}>
            {scale && (
              <div className="canvas-wrap">
                <div
                  className={`canvas${image.backdrop ? '' : ' opaque'}`}
                  style={{
                    width: image.width * scale,
                    height: image.height * scale,
                    backgroundColor: image.backdrop ? BACKDROP_COLORS[image.backdrop] : undefined,
                  }}
                >
                  <img src={image.url} alt={image.name} draggable={false} />
                  {result && (
                    <TextLayer
                      ref={layerRef}
                      result={result}
                      width={image.width}
                      height={image.height}
                      scale={scale}
                      showRegions={showRegions}
                    />
                  )}
                  {running && <div className="scan" aria-hidden="true" />}
                </div>
              </div>
            )}
          </div>

          {running && (
            <div className="status-pill" role="status">
              <span className="spinner" />
              <span>{ocr.progress.label}</span>
              {ocr.progress.value !== null && <span className="status-value">{Math.round(ocr.progress.value * 100)}%</span>}
            </div>
          )}
          {hasText && hasSelection && (
            <button
              type="button"
              className="status-pill action"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => copy(selectionText.current)}
            >
              <CopyIcon />
              Copy selection
            </button>
          )}
          {hasText && !hasSelection && !hintDismissed && <div className="status-pill hint">Drag across the image to select text</div>}
        </div>

        <aside className="panel" aria-label="Recognised text">
          <div className="panel-header">
            <div>
              <h2>Text</h2>
              <p className="panel-meta" aria-live="polite">
                {running && ocr.progress.label + '…'}
                {ocr.status === 'error' && 'Something went wrong'}
                {result &&
                  (hasText
                    ? `${result.wordCount} ${result.wordCount === 1 ? 'word' : 'words'} · ${Math.round(result.confidence)}% confidence`
                    : 'Nothing to read')}
              </p>
            </div>
            <button type="button" className="button" onClick={() => result && copy(result.text)} disabled={!hasText}>
              <CopyIcon />
              Copy all
            </button>
          </div>

          <div className="panel-body">
            {running && (
              <div className="skeleton" aria-hidden="true">
                {[92, 78, 85, 60, 0, 88, 70, 45].map((w, i) => (
                  <span key={i} style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {ocr.status === 'error' && (
              <div className="empty">
                <p>{ocr.message}</p>
                <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              </div>
            )}
            {result && !hasText && (
              <div className="empty">
                <p>No text was found in this image.</p>
                <p className="muted">If the text isn't {LANGUAGES.find((l) => l.code === language)?.name ?? 'this language'}, pick its language above.</p>
              </div>
            )}
            {hasText && <pre className="panel-text">{result.text}</pre>}
          </div>
        </aside>
      </div>
    </div>
  )
}
