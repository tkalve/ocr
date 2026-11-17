import { memo, useMemo, type CSSProperties, type Ref } from 'react'
import type { OcrLine, OcrResult } from '../lib/ocr.ts'

/**
 * The invisible, selectable text that sits on top of the image.
 *
 * Every OCR line is real inline text, so selection, double-click and
 * drag behave natively. To make that text land exactly on the pixels it
 * was read from, each word gets a letter-spacing that stretches it to its
 * measured width, and each gap is a space stretched with word-spacing.
 * Kerning and ligatures are off (here and in the CSS) so a word's width is
 * exactly the sum of its characters, which is what we measure.
 */
const FONT_FAMILY = 'Arial, Helvetica, sans-serif'
const MEASURE_SIZE = 100

let measureCtx: CanvasRenderingContext2D | null = null
const advances = new Map<string, number>()

/** Advance width of one character at MEASURE_SIZE px. */
function advance(char: string): number {
  let width = advances.get(char)
  if (width === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (!measureCtx) return MEASURE_SIZE / 2
    measureCtx.font = `${MEASURE_SIZE}px ${FONT_FAMILY}`
    width = measureCtx.measureText(char).width
    advances.set(char, width)
  }
  return width
}

type Item = { space: true; wordSpacing: number } | { space: false; text: string; letterSpacing: number }

interface LineLayout {
  style: CSSProperties
  paragraph: number
  items: Item[]
}

function layoutLine(line: OcrLine, index: number): LineLayout {
  const height = line.y1 - line.y0
  const words = line.words.map((word) => {
    const chars = Array.from(word.text)
    return { word, count: chars.length, natural: chars.reduce((sum, c) => sum + advance(c), 0) }
  })

  // Pick the font size whose natural word widths best match the image, so spacing tweaks stay tiny.
  const boxWidth = words.reduce((sum, w) => sum + (w.word.x1 - w.word.x0), 0)
  const naturalWidth = words.reduce((sum, w) => sum + w.natural, 0)
  const ideal = naturalWidth > 0 ? (MEASURE_SIZE * boxWidth) / naturalWidth : height * 0.8
  const fontSize = Math.max(1, Math.min(Math.max(ideal, height * 0.3), height * 1.5))
  const unit = fontSize / MEASURE_SIZE
  const spaceWidth = advance(' ') * unit

  const items: Item[] = []
  let cursor = line.x0
  words.forEach(({ word, count, natural }, i) => {
    if (i > 0) {
      // Words can overlap slightly; never move backwards, just close the gap.
      const gap = Math.max(0, word.x0 - cursor)
      items.push({ space: true, wordSpacing: gap - spaceWidth })
      cursor += gap
    }
    const width = Math.max(1, word.x1 - cursor)
    items.push({ space: false, text: word.text, letterSpacing: (width - natural * unit) / count })
    cursor += width
  })

  return {
    paragraph: line.paragraph,
    items,
    style: {
      left: line.x0,
      top: line.y0,
      height,
      lineHeight: `${height}px`,
      fontSize,
      animationDelay: `${Math.min(index * 14, 700)}ms`,
    },
  }
}

interface Props {
  result: OcrResult
  scale: number
  showRegions: boolean
  ref: Ref<HTMLDivElement>
}

export const TextLayer = memo(function TextLayer({ result, scale, showRegions, ref }: Props) {
  const lines = useMemo(() => result.lines.map(layoutLine), [result])
  const { frame } = result
  // Put the frame's centre where it belongs on the image, turned back if the text was straightened for reading.
  const transform = `scale(${scale}) translate(${frame.centerX}px, ${frame.centerY}px) rotate(${frame.rotation}rad) translate(${-frame.width / 2}px, ${-frame.height / 2}px)`
  return (
    <div
      ref={ref}
      className={`text-layer${showRegions ? ' show-regions' : ''}`}
      style={{ width: frame.width, height: frame.height, transform, fontFamily: FONT_FAMILY }}
    >
      {lines.map((line, i) => (
        <div key={i} className="text-line" data-paragraph={line.paragraph} style={line.style}>
          {line.items.map((item, j) =>
            item.space ? (
              <span key={j} style={{ wordSpacing: item.wordSpacing }}>
                {' '}
              </span>
            ) : (
              <span key={j} style={{ letterSpacing: item.letterSpacing }}>
                {item.text}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  )
})
