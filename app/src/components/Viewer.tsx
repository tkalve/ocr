import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BACKDROP_COLORS, type LoadedImage, type Region } from '../lib/image.ts'
import { AUTO, languageChoices, languageName, languagesFor } from '../lib/languages.ts'
import { recognize, type OcrProgress, type OcrResult } from '../lib/ocr.ts'
import { copyText, selectedText, selectionTouches } from '../lib/selection.ts'
import { TextLayer } from './TextLayer.tsx'
import { canCaptureScreen, type Busy } from '../lib/source.ts'
import { CloseIcon, CopyIcon, CropIcon, ImageIcon, LogoIcon, MinusIcon, PlusIcon, RegionsIcon, ScreenIcon } from './icons.tsx'

type OcrState =
  | { status: 'running'; progress: OcrProgress }
  | { status: 'done'; result: OcrResult }
  | { status: 'error' }

interface Props {
  image: LoadedImage
  busy: Busy | null
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
/** A drawn area smaller than this on screen is taken for a stray click. */
const MIN_AREA_SIZE = 12
const STARTING: OcrState = { status: 'running', progress: { step: 'starting', value: null } }

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function Viewer({ image, busy, language, onLanguage, onPick, onCapture, onClose, notify }: Props) {
  const { t } = useTranslation()
  // Results are tagged with the run that produced them, so a new run reads as "starting" immediately.
  const [stored, setStored] = useState<{ run: string; state: OcrState } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [showRegions, setShowRegions] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  /** The part of the image to read, or null for all of it. */
  const [region, setRegion] = useState<Region | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<Region | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const selectionText = useRef('')

  const run = [language, attempt, region ? [region.x, region.y, region.width, region.height].join(',') : 'all'].join(':')
  const ocr = stored?.run === run ? stored.state : STARTING

  useEffect(() => {
    const controller = new AbortController()
    const set = (state: OcrState) => {
      if (!controller.signal.aborted) setStored({ run, state })
    }
    recognize(image, languagesFor(language), region, (progress) => set({ status: 'running', progress }), controller.signal).then(
      (result) => set({ status: 'done', result }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        set({ status: 'error' })
      },
    )
    return () => controller.abort()
  }, [image, language, region, run])

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
      notify(t('toast.copied'))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      const layer = layerRef.current
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a' && layer) {
        event.preventDefault()
        document.getSelection()?.selectAllChildren(layer)
      } else if (event.key === 'Escape') {
        document.getSelection()?.removeAllRanges()
        dragStart.current = null
        setDraft(null)
        setDrawing(false)
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
  }, [notify, t])

  async function copy(text: string) {
    if (!text) return
    if (await copyText(text)) notify(t('toast.copied'))
    else notify(t('toast.clipboardDenied'), 'error')
  }

  /** Where a pointer is on the image, in image pixels. */
  function pointOnImage(event: ReactPointerEvent): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * image.width, image.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * image.height, image.height),
    }
  }

  function areaBetween(a: { x: number; y: number }, b: { x: number; y: number }): Region {
    const x = Math.floor(Math.min(a.x, b.x))
    const y = Math.floor(Math.min(a.y, b.y))
    return { x, y, width: Math.ceil(Math.max(a.x, b.x)) - x, height: Math.ceil(Math.max(a.y, b.y)) - y }
  }

  function startArea(event: ReactPointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = pointOnImage(event)
    setDraft(null)
  }

  function moveArea(event: ReactPointerEvent) {
    if (dragStart.current) setDraft(areaBetween(dragStart.current, pointOnImage(event)))
  }

  function finishArea(event: ReactPointerEvent) {
    const start = dragStart.current
    dragStart.current = null
    setDraft(null)
    if (!start || !scale) return
    const area = areaBetween(start, pointOnImage(event))
    if (area.width * scale < MIN_AREA_SIZE || area.height * scale < MIN_AREA_SIZE) return
    document.getSelection()?.removeAllRanges()
    setRegion(area)
    setDrawing(false)
  }

  function cancelArea() {
    dragStart.current = null
    setDraft(null)
  }

  const shownArea = draft ?? region
  const result = ocr.status === 'done' ? ocr.result : null
  const hasText = result !== null && result.lines.length > 0
  const running = ocr.status === 'running'

  return (
    <div className="viewer">
      <header className="toolbar">
        <button type="button" className="brand" onClick={onClose} title={t('viewer.startOver')}>
          <span className="brand-mark small">
            <LogoIcon width="16" height="16" />
          </span>
          <span className="file-name" title={image.name}>
            {image.name}
          </span>
        </button>

        <div className="toolbar-group">
          <label className="select">
            <span className="visually-hidden">{t('viewer.textLanguage')}</span>
            <select value={language} onChange={(e) => onLanguage(e.target.value)}>
              {languageChoices().map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="zoom" role="group" aria-label={t('viewer.zoom')}>
            <button type="button" className="icon-button" aria-label={t('viewer.zoomOut')} onClick={() => changeZoom(1 / ZOOM_STEP)} disabled={zoom <= 1}>
              <MinusIcon />
            </button>
            <button type="button" className="zoom-value" onClick={() => setZoom(1)} title={t('viewer.fit')}>
              {scale ? `${Math.round(scale * 100)}%` : '–'}
            </button>
            <button type="button" className="icon-button" aria-label={t('viewer.zoomIn')} onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= maxZoom}>
              <PlusIcon />
            </button>
          </div>

          <button
            type="button"
            className={`icon-button${showRegions ? ' active' : ''}`}
            aria-pressed={showRegions}
            aria-label={t('viewer.highlight')}
            title={t('viewer.highlight')}
            onClick={() => setShowRegions((v) => !v)}
            disabled={!hasText}
          >
            <RegionsIcon />
          </button>

          <button
            type="button"
            className={`icon-button${drawing ? ' active' : ''}`}
            aria-pressed={drawing}
            aria-label={t('viewer.selectArea')}
            title={t('viewer.selectArea')}
            onClick={() => setDrawing((v) => !v)}
          >
            <CropIcon />
          </button>

          {canCaptureScreen && (
            <button
              type="button"
              className="icon-button"
              aria-label={t('viewer.takeScreenshot')}
              title={t('viewer.takeScreenshot')}
              onClick={onCapture}
              disabled={busy !== null}
            >
              <ScreenIcon />
            </button>
          )}

          <button type="button" className="button primary" onClick={onPick} disabled={busy !== null}>
            <ImageIcon />
            <span className="hide-narrow">{busy ? t(`busy.${busy}`) : t('viewer.newImage')}</span>
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
                    <TextLayer ref={layerRef} result={result} scale={scale} showRegions={showRegions} />
                  )}
                  {shownArea && (
                    <div
                      className="area"
                      style={{
                        left: shownArea.x * scale,
                        top: shownArea.y * scale,
                        width: shownArea.width * scale,
                        height: shownArea.height * scale,
                      }}
                    />
                  )}
                  {running && (
                    <div
                      className="scan"
                      aria-hidden="true"
                      style={
                        region
                          ? {
                              inset: 'auto',
                              left: region.x * scale,
                              top: region.y * scale,
                              width: region.width * scale,
                              height: region.height * scale,
                            }
                          : undefined
                      }
                    />
                  )}
                  {region && !drawing && (
                    <button
                      type="button"
                      className="area-clear"
                      aria-label={t('viewer.clearArea')}
                      title={t('viewer.clearArea')}
                      style={{
                        // On the area's top right corner, but never pushed off the image.
                        left: Math.min(Math.max((region.x + region.width) * scale, 14), image.width * scale - 14),
                        top: Math.min(Math.max(region.y * scale, 14), image.height * scale - 14),
                      }}
                      onClick={() => setRegion(null)}
                    >
                      <CloseIcon width="14" height="14" />
                    </button>
                  )}
                  {drawing && (
                    <div
                      className="area-draw"
                      onPointerDown={startArea}
                      onPointerMove={moveArea}
                      onPointerUp={finishArea}
                      onPointerCancel={cancelArea}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {drawing && <div className="status-pill note">{t('viewer.areaHint')}</div>}
          {running && !drawing && (
            <div className="status-pill" role="status">
              <span className="spinner" />
              <span>{t(`progress.${ocr.progress.step}`)}</span>
              {ocr.progress.value !== null && <span className="status-value">{Math.round(ocr.progress.value * 100)}%</span>}
            </div>
          )}
          {hasText && hasSelection && !drawing && (
            <button
              type="button"
              className="status-pill action"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => copy(selectionText.current)}
            >
              <CopyIcon />
              {t('viewer.copySelection')}
            </button>
          )}
          {hasText && !hasSelection && !hintDismissed && !drawing && <div className="status-pill hint">{t('viewer.selectHint')}</div>}
        </div>

        <aside className="panel" aria-label={t('viewer.panelLabel')}>
          <div className="panel-header">
            <div>
              <h2>{t('viewer.text')}</h2>
              <p className="panel-meta" aria-live="polite">
                {running && t(`progress.${ocr.progress.step}`) + '…'}
                {ocr.status === 'error' && t('viewer.failed')}
                {result &&
                  (hasText
                    ? [
                        t('viewer.words', { count: result.wordCount }),
                        t('viewer.confidence', { percent: Math.round(result.confidence) }),
                        ...(language === AUTO ? [languageName(result.language)] : []),
                      ].join(' · ')
                    : t('viewer.nothing'))}
              </p>
            </div>
            <button type="button" className="button" onClick={() => result && copy(result.text)} disabled={!hasText}>
              <CopyIcon />
              {t('viewer.copyAll')}
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
                <p>{t('viewer.readFailed')}</p>
                <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                  {t('viewer.tryAgain')}
                </button>
              </div>
            )}
            {result && !hasText && (
              <div className="empty">
                <p>{t('viewer.noText')}</p>
                <p className="muted">{t('viewer.wrongLanguage')}</p>
              </div>
            )}
            {hasText && <pre className="panel-text">{result.text}</pre>}
          </div>
        </aside>
      </div>
    </div>
  )
}
