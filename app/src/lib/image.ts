import i18n from '../i18n.ts'

export interface LoadedImage {
  /** Object URL for display. Owned by whoever holds the LoadedImage. */
  url: string
  name: string
  /** Size of the source file in bytes. */
  size: number
  width: number
  height: number
  /** Set when the image has transparency: the backdrop that keeps its content readable. */
  backdrop: 'light' | 'dark' | null
  element: HTMLImageElement
}

export class ImageError extends Error {}

export async function loadImage(blob: Blob, name: string): Promise<LoadedImage> {
  if (blob.size === 0) throw new ImageError(i18n.t('errors.emptyFile'))
  const url = URL.createObjectURL(blob)
  const element = new Image()
  element.decoding = 'async'
  element.src = url
  try {
    await element.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageError(i18n.t('errors.notImage'))
  }
  const { naturalWidth: width, naturalHeight: height } = element
  if (!width || !height) {
    URL.revokeObjectURL(url)
    throw new ImageError(i18n.t('errors.noSize'))
  }
  return { url, name, size: blob.size, width, height, backdrop: detectBackdrop(element), element }
}

/** Transparent images need a backdrop that contrasts with their content. */
function detectBackdrop(element: HTMLImageElement): 'light' | 'dark' | null {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(element, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  let transparent = 0
  let weight = 0
  let luminance = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    if (alpha < 0.98) transparent++
    weight += alpha
    luminance += alpha * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
  }
  if (transparent / (size * size) < 0.01) return null
  if (weight === 0) return 'light'
  return luminance / weight > 140 ? 'dark' : 'light'
}

export const BACKDROP_COLORS = { light: '#ffffff', dark: '#14161c' } as const

const MAX_PIXELS = 16_000_000
const MAX_SIDE = 8192

/** A rectangle in image pixels. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** What OCR reads: the image or a part of it, possibly rotated upright, in its own coordinate frame. */
export interface OcrFrame {
  canvas: HTMLCanvasElement
  /** Size of the frame in image pixels. It grows to hold everything that is read when rotated. */
  width: number
  height: number
  /** Where the centre of the frame lies on the image. */
  centerX: number
  centerY: number
  /** Canvas pixels per image pixel. */
  scaleX: number
  scaleY: number
  /** Radians, clockwise positive: how far the frame must be turned about its centre to lie back on the image. */
  rotation: number
}

/** The colour around the edge of an area, used to fill the corners a rotation exposes. */
function edgeColor(image: LoadedImage, area: Region): string {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const backdrop = BACKDROP_COLORS[image.backdrop ?? 'light']
  if (!ctx) return backdrop
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, size, size)
  ctx.setTransform(size / area.width, 0, 0, size / area.height, 0, 0)
  ctx.drawImage(image.element, -area.x, -area.y, image.width, image.height)
  const { data } = ctx.getImageData(0, 0, size, size)
  const channels: number[][] = [[], [], []]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x > 0 && x < size - 1 && y > 0 && y < size - 1) continue
      for (let c = 0; c < 3; c++) channels[c].push(data[(y * size + x) * 4 + c])
    }
  }
  const [r, g, b] = channels.map((values) => values.sort((p, q) => p - q)[values.length >> 1])
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Renders the image to an opaque canvas sized for OCR. Going through a canvas
 * applies EXIF orientation and rasterises SVGs exactly as they are displayed,
 * so OCR coordinates always line up with what the user sees. Small images are
 * upscaled because Tesseract is far more accurate on larger glyphs.
 *
 * The result is greyscale: given colour, Tesseract thresholds the channels
 * separately and loses text whose contrast is mostly in one of them (dark
 * print on a yellow label, say), while luminance keeps it.
 *
 * `rotation` is the tilt of the text (see estimateSkew); the image is turned
 * back by that much so the text lies level in the frame. With a `region`,
 * only that part of the image is rendered and read.
 */
export function rasterizeForOcr(image: LoadedImage, rotation = 0, region: Region | null = null): OcrFrame {
  const area = region ?? { x: 0, y: 0, width: image.width, height: image.height }
  const sin = Math.abs(Math.sin(rotation))
  const cos = Math.abs(Math.cos(rotation))
  const width = area.width * cos + area.height * sin
  const height = area.width * sin + area.height * cos
  const centerX = area.x + area.width / 2
  const centerY = area.y + area.height / 2
  const longest = Math.max(width, height)
  let scale = longest < 700 ? 3 : longest < 1600 ? 2 : 1
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / longest)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const scaleX = canvas.width / width
  const scaleY = canvas.height / height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ImageError(i18n.t('errors.prepare'))
  ctx.fillStyle = rotation === 0 ? BACKDROP_COLORS[image.backdrop ?? 'light'] : edgeColor(image, area)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // From here on we draw in image coordinates, with the centre of the area at the centre of the canvas.
  ctx.save()
  ctx.setTransform(scaleX, 0, 0, scaleY, canvas.width / 2, canvas.height / 2)
  ctx.rotate(-rotation)
  ctx.translate(-centerX, -centerY)
  // Nothing outside the area may be read, also not in the corners a rotation adds.
  ctx.beginPath()
  ctx.rect(area.x, area.y, area.width, area.height)
  ctx.clip()
  if (rotation !== 0 && image.backdrop) {
    ctx.fillStyle = BACKDROP_COLORS[image.backdrop]
    ctx.fillRect(area.x, area.y, area.width, area.height)
  }
  ctx.drawImage(image.element, 0, 0, image.width, image.height)
  ctx.restore()

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = pixels
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma in integer maths.
    const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
    data[i] = luma
    data[i + 1] = luma
    data[i + 2] = luma
  }
  ctx.putImageData(pixels, 0, 0)
  return { canvas, width, height, centerX, centerY, scaleX, scaleY, rotation }
}
