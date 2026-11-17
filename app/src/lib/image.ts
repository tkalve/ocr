export interface LoadedImage {
  /** Object URL for display. Owned by whoever holds the LoadedImage. */
  url: string
  name: string
  width: number
  height: number
  /** Set when the image has transparency: the backdrop that keeps its content readable. */
  backdrop: 'light' | 'dark' | null
  element: HTMLImageElement
}

export class ImageError extends Error {}

export async function loadImage(blob: Blob, name: string): Promise<LoadedImage> {
  if (blob.size === 0) throw new ImageError('That file is empty.')
  const url = URL.createObjectURL(blob)
  const element = new Image()
  element.decoding = 'async'
  element.src = url
  try {
    await element.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageError("That doesn't look like an image this browser can open.")
  }
  const { naturalWidth: width, naturalHeight: height } = element
  if (!width || !height) {
    URL.revokeObjectURL(url)
    throw new ImageError('That image has no size, so there is nothing to read.')
  }
  return { url, name, width, height, backdrop: detectBackdrop(element), element }
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

/**
 * Renders the image to an opaque canvas sized for OCR. Going through a canvas
 * applies EXIF orientation and rasterises SVGs exactly as they are displayed,
 * so OCR coordinates always line up with what the user sees. Small images are
 * upscaled because Tesseract is far more accurate on larger glyphs.
 */
export function rasterizeForOcr(image: LoadedImage): { canvas: HTMLCanvasElement; scaleX: number; scaleY: number } {
  const { width, height } = image
  const longest = Math.max(width, height)
  let scale = longest < 700 ? 3 : longest < 1600 ? 2 : 1
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / longest)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('Could not prepare the image for reading.')
  ctx.fillStyle = BACKDROP_COLORS[image.backdrop ?? 'light']
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.element, 0, 0, canvas.width, canvas.height)
  return { canvas, scaleX: canvas.width / width, scaleY: canvas.height / height }
}
