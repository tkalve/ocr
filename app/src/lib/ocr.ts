import { createWorker, PSM, type ImageLike, type Page, type Worker } from 'tesseract.js'
import { rasterizeForOcr, type LoadedImage, type OcrFrame, type Region } from './image.ts'
import { estimateSkew } from './skew.ts'

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
  /** The line the letters sit on, as its two end points. */
  baseline: { x0: number; y0: number; x1: number; y1: number }
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrResult {
  /** The language the text was read as. */
  language: string
  /**
   * The coordinate frame of the lines: a box centred on (`centerX`, `centerY`)
   * of the image. It is the image itself, the area that was read, or, when the
   * text is tilted, a larger box that must be turned by `rotation` (radians,
   * clockwise) about its centre to lie on the image.
   */
  frame: { width: number; height: number; centerX: number; centerY: number; rotation: number }
  /** Lines in reading order, in frame coordinates (image pixels). */
  lines: OcrLine[]
  text: string
  wordCount: number
  /** 0–100 */
  confidence: number
}

export interface OcrProgress {
  step: 'starting' | 'loadingModel' | 'reading' | 'lookingCloser'
  /** 0–1, or null when the step has no measurable progress. */
  value: number | null
}

/** Words Tesseract is this unsure about are almost always noise from non-text areas. */
const MIN_WORD_CONFIDENCE = 20

/**
 * Stray marks: borders, specks and the edges of things read as "|", "!" or "=".
 * Punctuation standing on its own needs this much confidence to be kept.
 */
const MIN_MARK_CONFIDENCE = 60

/** A line of at most two letters or digits is kept only when something on it was read with this confidence. */
const MIN_SHORT_LINE_CONFIDENCE = 75

const letters = (text: string) => text.match(/[\p{L}\p{N}]/gu)?.length ?? 0

/** A line this much further down than the usual line spacing starts a new paragraph. */
const PARAGRAPH_GAP = 1.4

/**
 * Layout modes to try, in order. Automatic layout analysis ignores borders and
 * pictures, which the single-block mode turns into stray "|" and "=" marks, but
 * it can also dismiss a whole image as a picture; single-block then still reads it.
 */
const LAYOUT_MODES = [PSM.AUTO, PSM.SINGLE_BLOCK]

/** How much real text a result holds: confident words with letters or digits in them. */
function substance(result: OcrResult, confidences: Map<OcrWord, number>): number {
  let total = 0
  for (const line of result.lines) {
    for (const word of line.words) {
      const confidence = confidences.get(word) ?? 0
      const characters = word.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
      if (confidence >= 60 && characters >= 2) total += characters * confidence
    }
  }
  return total
}

const assetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}tesseract/${path}`, location.href).href

interface Engine {
  lang: string
  /** Resolves when the worker is ready to read `lang`. */
  ready: Promise<Worker>
}

/** One worker per language in use, so several languages can be read side by side. */
const engines = new Map<string, Engine>()
let listener: ((lang: string, progress: OcrProgress) => void) | null = null

const STARTING: OcrProgress = { step: 'starting', value: null }

function describe(status: string, progress: number): OcrProgress {
  if (status.startsWith('recognizing')) return { step: 'reading', value: progress }
  if (status.startsWith('loading language')) return { step: 'loadingModel', value: null }
  return STARTING
}

/**
 * Tesseract.js rejects with an unhandled error if a worker is terminated
 * between a call and the moment it posts that call to the worker. So we only
 * terminate once initialisation has settled, and in a later task than any
 * `recognize` call (which posts within microtasks, see `recognize` below).
 */
function dispose(target: Engine) {
  if (engines.get(target.lang) === target) engines.delete(target.lang)
  target.ready.then(
    (worker) => setTimeout(() => void worker.terminate().catch(() => {}), 0),
    () => {},
  )
}

function acquire(lang: string): Engine {
  const existing = engines.get(lang)
  if (existing) return existing
  const ready = createWorker(lang, 1, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl('core'),
    langPath: assetUrl('lang'),
    workerBlobURL: false,
    logger: (m) => listener?.(lang, describe(m.status, m.progress)),
  })
  const engine: Engine = { lang, ready }
  engines.set(lang, engine)
  // A failed start (e.g. offline before the model was cached) must not poison later attempts.
  ready.catch(() => dispose(engine))
  return engine
}

async function encodePng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not prepare the image for reading.')
  return new Uint8Array(await blob.arrayBuffer())
}

interface Reading {
  result: OcrResult
  score: number
}

/**
 * Runs OCR on an image. With several languages the image is read in each of
 * them side by side, and the reading with the most confidently read text wins
 * (the first language on a tie). With a region, only that part of the image
 * is read.
 *
 * Only one recognition runs at a time: aborting the signal while an engine is
 * reading tears it down, so the next call starts immediately. An engine that
 * is merely starting up is kept and reused.
 */
export async function recognize(
  image: LoadedImage,
  langs: string[],
  region: Region | null,
  onProgress: (progress: OcrProgress) => void,
  signal: AbortSignal,
): Promise<OcrResult> {
  signal.throwIfAborted()
  // Engines for languages that are no longer wanted give their memory back.
  for (const engine of [...engines.values()]) if (!langs.includes(engine.lang)) dispose(engine)
  const upright = rasterizeForOcr(image, 0, region)
  // Start the engines right away; they load while the image is being prepared.
  for (const lang of langs) acquire(lang)

  // Tilted text is read from a straightened copy. The untouched image is read
  // too and wins unless straightening really helped, so a misjudged tilt (a
  // picture full of slanted lines, say) can never make the result worse.
  const skew = estimateSkew(upright.canvas)
  const frames = skew === 0 ? [upright] : [rasterizeForOcr(image, skew, region), upright]
  const inputs: { frame: OcrFrame; png: Uint8Array }[] = []
  for (const frame of frames) inputs.push({ frame, png: await encodePng(frame.canvas) })
  signal.throwIfAborted()

  // Progress is reported per language; show whichever step is still holding things up.
  const states = new Map<string, OcrProgress>()
  const report = (lang: string, progress: OcrProgress) => {
    states.set(lang, progress)
    const all = langs.map((l) => states.get(l) ?? STARTING)
    const waiting = all.find((state) => state.value === null)
    onProgress(waiting ?? { step: all[0].step, value: all.reduce((sum, state) => sum + (state.value ?? 0), 0) / all.length })
  }
  listener = report
  const reading = new Set<Engine>()

  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      for (const engine of reading) dispose(engine)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    const jobs = langs.map((lang) => {
      const engine = acquire(lang)
      return engine.ready.then(async (worker): Promise<Reading> => {
        let best: Reading | null = null
        let first = true
        for (const { frame, png } of inputs) {
          let found: Reading | null = null
          for (const mode of LAYOUT_MODES) {
            signal.throwIfAborted()
            reading.add(engine)
            if (!first) report(lang, { step: 'lookingCloser', value: null })
            first = false
            // Canvas PNGs carry no DPI; without one Tesseract logs "Estimating resolution" on every run.
            await worker.setParameters({ tessedit_pageseg_mode: mode, user_defined_dpi: '300' })
            signal.throwIfAborted()
            // Already-encoded bytes make Tesseract.js post the job without any async image loading.
            const { data } = await worker.recognize(png as unknown as ImageLike, {}, { text: true, blocks: true })
            const confidences = new Map<OcrWord, number>()
            const result = parse(data, frame, lang, confidences)
            const score = substance(result, confidences)
            if (!found || score > found.score) found = { result, score }
            if (found.score > 0) break
          }
          // Later frames are less processed, so they win ties.
          if (found && (!best || found.score >= best.score)) best = found
        }
        report(lang, { step: 'reading', value: 1 })
        return best!
      })
    })
    const all = Promise.all(jobs)
    all.catch(() => {})
    const readings = await Promise.race([all, aborted])
    return readings.reduce((best, candidate) => (candidate.score > best.score ? candidate : best)).result
  } catch (error) {
    // A failed read leaves the engines in an unknown state; start fresh next time.
    if (!signal.aborted) for (const engine of reading) dispose(engine)
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (listener === report) listener = null
  }
}

function parse(data: Page, frame: OcrFrame, language: string, confidences: Map<OcrWord, number>): OcrResult {
  const { scaleX, scaleY } = frame
  const lines: OcrLine[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const words: OcrWord[] = []
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text || word.confidence < MIN_WORD_CONFIDENCE) continue
          if (letters(text) === 0 && word.confidence < MIN_MARK_CONFIDENCE) continue
          const x0 = word.bbox.x0 / scaleX
          const x1 = word.bbox.x1 / scaleX
          const y0 = word.bbox.y0 / scaleY
          const y1 = word.bbox.y1 / scaleY
          if (x1 - x0 <= 0 || y1 - y0 <= 0) continue
          const parsed = { text, x0, y0, x1, y1 }
          confidences.set(parsed, word.confidence)
          words.push(parsed)
        }
        if (words.length === 0) continue
        const lettersOnLine = words.reduce((sum, word) => sum + letters(word.text), 0)
        const bestConfidence = Math.max(...words.map((word) => confidences.get(word) ?? 0))
        if (lettersOnLine <= 2 && bestConfidence < MIN_SHORT_LINE_CONFIDENCE) continue
        words.sort((a, b) => a.x0 - b.x0)
        const y1 = Math.max(...words.map((w) => w.y1))
        const base = line.baseline
        const hasBaseline = base && [base.x0, base.y0, base.x1, base.y1].every(Number.isFinite) && base.x1 > base.x0
        lines.push({
          words,
          paragraph: 0,
          baseline: hasBaseline
            ? { x0: base.x0 / scaleX, y0: base.y0 / scaleY, x1: base.x1 / scaleX, y1: base.y1 / scaleY }
            : { x0: words[0].x0, y0: y1, x1: words[words.length - 1].x1, y1 },
          x0: Math.min(...words.map((w) => w.x0)),
          y0: Math.min(...words.map((w) => w.y0)),
          x1: Math.max(...words.map((w) => w.x1)),
          y1,
        })
      }
    }
  }
  const kept = withoutGhostLines(lines)
  assignParagraphs(kept)

  return {
    language,
    frame: {
      width: frame.width,
      height: frame.height,
      centerX: frame.centerX,
      centerY: frame.centerY,
      rotation: frame.rotation,
    },
    lines: kept,
    text: joinLines(kept.map((line) => ({ paragraph: line.paragraph, text: line.words.map((w) => w.text).join(' ') }))),
    wordCount: kept.reduce((n, line) => n + line.words.length, 0),
    confidence: data.confidence,
  }
}

/**
 * Drops "ghost" lines: the dots and tall strokes of a line of handwriting are
 * sometimes split off and read as a line of their own ("." "]" "di" "|"). Such
 * a line lies within the band of the real line, inside its width, and holds
 * only a fraction of its text.
 */
function withoutGhostLines(lines: OcrLine[]): OcrLine[] {
  const size = (line: OcrLine) => line.words.reduce((sum, word) => sum + letters(word.text), 0)
  return lines.filter((line) => {
    const height = line.y1 - line.y0
    return !lines.some((host) => {
      if (host === line || size(host) < size(line) * 3) return false
      const overlap = Math.min(line.y1, host.y1) - Math.max(line.y0, host.y0)
      return overlap >= height / 2 && line.x0 >= host.x0 - height && line.x1 <= host.x1 + height
    })
  })
}

/**
 * Groups lines into paragraphs by how they are spaced on the page. Tesseract's
 * own paragraphs are not used: it splits ragged text such as verse or short
 * labels into one paragraph per line.
 *
 * A line starts a new paragraph when it sits clearly further below the
 * previous line than lines usually do, or when it does not follow on from it
 * at all (the next column, a caption off to the side).
 */
function assignParagraphs(lines: OcrLine[]): void {
  /** How far line `i` sits below the line before it, or null when it doesn't continue from it. */
  const drop = (i: number): number | null => {
    const above = lines[i - 1]
    const below = lines[i]
    const left = Math.max(above.x0, below.x0)
    const right = Math.min(above.x1, below.x1)
    if (right <= left) return null
    // Measured at a shared x, so a slight slant in the scan doesn't count as spacing.
    const x = (left + right) / 2
    const at = ({ x0, y0, x1, y1 }: OcrLine['baseline']) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    const distance = at(below.baseline) - at(above.baseline)
    return distance > 0 ? distance : null
  }

  const drops = lines.map((_, i) => (i === 0 ? null : drop(i)))
  const known = drops.filter((d): d is number => d !== null).sort((a, b) => a - b)
  const usual = known.length > 0 ? known[(known.length - 1) >> 1] : 0

  let paragraph = 0
  lines.forEach((line, i) => {
    const distance = drops[i]
    if (i > 0 && (distance === null || distance > usual * PARAGRAPH_GAP)) paragraph++
    line.paragraph = paragraph
  })
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
