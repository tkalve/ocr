import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BACKDROP_COLORS, type LoadedImage, type Region } from '../lib/image.ts'
import { AUTO, languageChoices, languageName, languagesFor } from '../lib/languages.ts'
import { recognize, type OcrProgress, type OcrResult } from '../lib/ocr.ts'
import { copyText, selectedText, selectionTouches } from '../lib/selection.ts'
import { TextLayer } from './TextLayer.tsx'
import type { Busy } from '../lib/source.ts'
import { AlertIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, CropIcon, LogoIcon, MinusIcon, PlusIcon, RetryIcon, UploadIcon } from './icons.tsx'

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
  onClose: () => void
  notify: (message: string, kind?: 'info' | 'error') => void
}

const STAGE_PADDING = 20
const MAX_FIT_SCALE = 3
const MAX_SCALE = 8
const ZOOM_STEP = 1.3
/** A drawn area smaller than this on screen is taken for a stray click. */
const MIN_AREA_SIZE = 12
const STARTING: OcrState = { status: 'running', progress: { step: 'starting', value: null } }

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function Viewer({ image, busy, language, onLanguage, onPick, onClose, notify }: Props) {
  const { t } = useTranslation()
  // Results are tagged with the run that produced them, so a new run reads as "starting" immediately.
  const [stored, setStored] = useState<{ run: string; state: OcrState } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  /** The part of the image to read, or null for all of it. */
  const [region, setRegion] = useState<Region | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<Region | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

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

    document.addEventListener('copy', onCopy)
    document.addEventListener('keydown', onKeyDown)
    return () => {
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
  }

  function cancelArea() {
    dragStart.current = null
    setDraft(null)
  }

  const shownArea = draft ?? region
  const toggleCrop = () => {
    if (region) setRegion(null)
    setDrawing(!region && !drawing)
  }
  const result = ocr.status === 'done' ? ocr.result : null
  const hasText = result !== null && result.lines.length > 0
  const running = ocr.status === 'running'

  return (
    <div className="viewer">
      <div className="workspace">
        <section className="card image-card">
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
                    {result && <TextLayer ref={layerRef} result={result} scale={scale} showRegions={false} />}
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
            <button
              type="button"
              className={`crop-button${region ? ' on' : drawing ? ' active' : ''}`}
              aria-pressed={drawing || region !== null}
              aria-label={region ? t('viewer.clearCrop') : t('viewer.crop')}
              title={region ? t('viewer.clearCrop') : t('viewer.crop')}
              onClick={toggleCrop}
            >
              <CropIcon />
            </button>
            {drawing && <p className="crop-hint">{region ? t('viewer.cropHint') : t('viewer.cropDrawHint')}</p>}
          </div>

          <div className="zoom" role="group" aria-label={t('viewer.zoom')}>
            <button type="button" className="zoom-button" aria-label={t('viewer.zoomOut')} onClick={() => changeZoom(1 / ZOOM_STEP)} disabled={zoom <= 1}>
              <MinusIcon />
            </button>
            <button type="button" className="zoom-value" onClick={() => setZoom(1)} title={t('viewer.fit')}>
              {scale ? `${Math.round(scale * 100)}%` : '–'}
            </button>
            <button type="button" className="zoom-button" aria-label={t('viewer.zoomIn')} onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= maxZoom}>
              <PlusIcon />
            </button>
          </div>
        </section>

        <section className="card panel" aria-label={t('viewer.text')}>
          <div className="panel-header">
            <h2>{t('viewer.text')}</h2>
            <div className="field">
              <label className="select">
                <select value={language} onChange={(e) => onLanguage(e.target.value)} aria-label={t('viewer.recognitionLanguage')}>
                  {languageChoices().map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <ChevronIcon className="select-chevron" width="16" height="16" />
              </label>
              <span className="field-label">{t('viewer.recognitionLanguage')}</span>
            </div>
          </div>

          <div className="panel-body">
            {running && (
              <div className="state" role="status">
                <span className="state-icon">
                  <LogoIcon width="26" height="26" />
                </span>
                <p className="state-title">{t('viewer.reading')}</p>
                <div
                  className={`progress${ocr.progress.value === null ? ' indeterminate' : ''}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={ocr.progress.value === null ? undefined : Math.round(ocr.progress.value * 100)}
                >
                  <span style={ocr.progress.value === null ? undefined : { width: `${Math.round(ocr.progress.value * 100)}%` }} />
                </div>
                <p className="state-note">
                  {ocr.progress.value === null ? t(`progress.${ocr.progress.step}`) : `${Math.round(ocr.progress.value * 100)}%`}
                </p>
                <p className="placeholder">{t('viewer.placeholder')}</p>
              </div>
            )}
            {ocr.status === 'error' && (
              <div className="state">
                <span className="state-icon danger">
                  <AlertIcon width="26" height="26" />
                </span>
                <p className="state-title">{t('viewer.failedTitle')}</p>
                <p className="state-text">{t('viewer.failedBody')}</p>
                <button type="button" className="button accent" onClick={() => setAttempt((n) => n + 1)}>
                  <RetryIcon />
                  {t('viewer.retry')}
                </button>
              </div>
            )}
            {result && !hasText && (
              <div className="state">
                <span className="state-icon warm">
                  <LogoIcon width="26" height="26" />
                </span>
                <p className="state-title">{t('viewer.noTextTitle')}</p>
                <p className="state-text">{t('viewer.noTextBody')}</p>
                <button type="button" className="button accent" onClick={onPick} disabled={busy !== null}>
                  <UploadIcon />
                  {t('viewer.anotherImage')}
                </button>
              </div>
            )}
            {hasText && <pre className="panel-text">{result.text}</pre>}
          </div>

          <div className="panel-footer">
            {(result || ocr.status === 'error') && (
              <p className={`chip${hasText ? ' success' : ''}`} aria-live="polite">
                {hasText && <CheckIcon width="16" height="16" />}
                {result
                  ? [
                      t('viewer.words', { count: result.wordCount }),
                      ...(hasText ? [t('viewer.accuracy', { percent: Math.round(result.confidence) })] : []),
                      language === AUTO ? languageName(result.language) : languageName(language),
                    ].join(' · ')
                  : t('viewer.failedStatus')}
              </p>
            )}
            <div className="panel-actions">
              <button type="button" className="button" onClick={onClose}>
                <CloseIcon width="16" height="16" />
                {t('viewer.startOver')}
              </button>
              <button type="button" className="button accent" onClick={() => result && copy(result.text)} disabled={!hasText}>
                <CopyIcon />
                {t('viewer.copyAll')}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
