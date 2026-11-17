import { createWorker, type ImageLike, type Worker } from 'tesseract.js'
import { rasterizeForOcr, type LoadedImage } from './image.ts'

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrLine {
  words: OcrWord[]
  /** Index of the paragraph this line belongs to. */
  paragraph: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrResult {
  /** Lines in reading order, in image pixel coordinates. */
  lines: OcrLine[]
  text: string
  wordCount: number
  /** 0–100 */
  confidence: number
}

export interface OcrProgress {
  label: string
  /** 0–1, or null when the step has no measurable progress. */
  value: number | null
}

/** Words Tesseract is this unsure about are almost always noise from non-text areas. */
const MIN_WORD_CONFIDENCE = 20

const assetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}tesseract/${path}`, location.href).href

interface Engine {
  lang: string
  /** Resolves when the worker is initialised for `lang`. */
  ready: Promise<Worker>
  /** The underlying worker, regardless of whether a later language switch succeeded. */
  raw: Promise<Worker>
}

let engine: Engine | null = null
let listener: ((progress: OcrProgress) => void) | null = null

function describe(status: string, progress: number): OcrProgress {
  if (status.startsWith('recognizing')) return { label: 'Reading text', value: progress }
  if (status.startsWith('loading language')) return { label: 'Loading language model', value: null }
  return { label: 'Starting OCR engine', value: null }
}

/**
 * Tesseract.js rejects with an unhandled error if a worker is terminated
 * between a call and the moment it posts that call to the worker. So we only
 * terminate once initialisation has settled, and in a later task than any
 * `recognize` call (which posts within microtasks, see `recognize` below).
 */
function dispose(target: Engine) {
  if (engine === target) engine = null
  target.ready
    .catch(() => {})
    .then(() => target.raw)
    .then(
      (worker) => setTimeout(() => void worker.terminate().catch(() => {}), 0),
      () => {},
    )
}

function acquire(lang: string): Engine {
  if (engine?.lang === lang) return engine
  const previous = engine
  const raw = previous
    ? previous.raw
    : createWorker(lang, 1, {
        workerPath: assetUrl('worker.min.js'),
        corePath: assetUrl('core'),
        langPath: assetUrl('lang'),
        workerBlobURL: false,
        logger: (m) => listener?.(describe(m.status, m.progress)),
      })
  const ready = previous
    ? previous.ready.then(async (worker) => {
        await worker.reinitialize(lang, 1)
        return worker
      })
    : raw
  const next: Engine = { lang, ready, raw }
  engine = next
  // A failed start (e.g. offline before the model was cached) must not poison later attempts.
  ready.catch(() => dispose(next))
  return next
}

async function encodePng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not prepare the image for reading.')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Runs OCR on an image. Only one recognition runs at a time: aborting the
 * signal while the engine is reading tears it down, so the next call starts
 * immediately. An engine that is merely starting up is kept and reused.
 */
export async function recognize(
  image: LoadedImage,
  lang: string,
  onProgress: (progress: OcrProgress) => void,
  signal: AbortSignal,
): Promise<OcrResult> {
  signal.throwIfAborted()
  const { canvas, scaleX, scaleY } = rasterizeForOcr(image)
  // Start the engine right away; it loads while the image is being encoded.
  acquire(lang)
  const png = await encodePng(canvas)
  signal.throwIfAborted()

  const current = acquire(lang)
  listener = onProgress
  let reading = false

  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      if (reading) dispose(current)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    const job = current.ready.then((worker) => {
      signal.throwIfAborted()
      reading = true
      // Already-encoded bytes make Tesseract.js post the job without any async image loading.
      return worker.recognize(png as unknown as ImageLike, {}, { text: true, blocks: true })
    })
    job.catch(() => {})
    const { data } = await Promise.race([job, aborted])

    const lines: OcrLine[] = []
    let paragraph = 0
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        let used = false
        for (const line of para.lines) {
          const words: OcrWord[] = []
          for (const word of line.words) {
            const text = word.text.trim()
            if (!text || word.confidence < MIN_WORD_CONFIDENCE) continue
            const x0 = word.bbox.x0 / scaleX
            const x1 = word.bbox.x1 / scaleX
            const y0 = word.bbox.y0 / scaleY
            const y1 = word.bbox.y1 / scaleY
            if (x1 - x0 <= 0 || y1 - y0 <= 0) continue
            words.push({ text, x0, y0, x1, y1 })
          }
          if (words.length === 0) continue
          words.sort((a, b) => a.x0 - b.x0)
          lines.push({
            words,
            paragraph,
            x0: Math.min(...words.map((w) => w.x0)),
            y0: Math.min(...words.map((w) => w.y0)),
            x1: Math.max(...words.map((w) => w.x1)),
            y1: Math.max(...words.map((w) => w.y1)),
          })
          used = true
        }
        if (used) paragraph++
      }
    }

    return {
      lines,
      text: joinLines(lines.map((line) => ({ paragraph: line.paragraph, text: line.words.map((w) => w.text).join(' ') }))),
      wordCount: lines.reduce((n, line) => n + line.words.length, 0),
      confidence: data.confidence,
    }
  } catch (error) {
    // A failed read leaves the engine in an unknown state; start fresh next time.
    if (!signal.aborted && reading) dispose(current)
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (listener === onProgress) listener = null
  }
}

/** Joins lines with newlines, and paragraphs with a blank line. */
export function joinLines(lines: { paragraph: number; text: string }[]): string {
  let out = ''
  let last: number | null = null
  for (const line of lines) {
    if (!line.text) continue
    if (last !== null) out += line.paragraph === last ? '\n' : '\n\n'
    out += line.text
    last = line.paragraph
  }
  return out
}
