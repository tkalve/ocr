const SAMPLE_SIZE = 640
const MAX_POINTS = 80_000
const MAX_ANGLE = 45
/** Smaller tilts than this are read fine as they are. */
const MIN_ANGLE = 1
/** How much sharper the text rows must get for a tilt to be believed. */
const MIN_GAIN = 1.25

/**
 * Estimates how far the text in an image is tilted, in radians (clockwise
 * positive, within ±45°), or 0 when no convincing tilt is found.
 *
 * Text is made of rows: seen along the right direction, the "ink" piles up in
 * the rows and vanishes between them. So we project the image's edge pixels
 * onto the axis perpendicular to each candidate direction and keep the
 * direction whose profile is the most concentrated.
 */
export function estimateSkew(source: HTMLCanvasElement): number {
  const shrink = Math.min(1, SAMPLE_SIZE / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * shrink))
  const height = Math.max(1, Math.round(source.height * shrink))
  if (width < 16 || height < 16) return 0

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)

  const luma = new Uint8Array(width * height)
  for (let i = 0; i < luma.length; i++) {
    luma[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  }

  // Edge pixels stand in for ink, which works for dark-on-light and light-on-dark alike.
  const strength = new Uint16Array(width * height)
  let strongest = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const value = Math.abs(luma[i + 1] - luma[i - 1]) + Math.abs(luma[i + width] - luma[i - width])
      strength[i] = value
      if (value > strongest) strongest = value
    }
  }
  const threshold = Math.max(24, strongest * 0.25)
  let count = 0
  for (let i = 0; i < strength.length; i++) if (strength[i] >= threshold) count++
  if (count < 50) return 0

  const step = Math.max(1, Math.ceil(count / MAX_POINTS))
  const xs = new Float32Array(Math.ceil(count / step))
  const ys = new Float32Array(xs.length)
  let seen = 0
  let points = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (strength[y * width + x] < threshold) continue
      if (seen++ % step === 0) {
        xs[points] = x - width / 2
        ys[points] = y - height / 2
        points++
      }
    }
  }

  const reach = Math.ceil(Math.hypot(width, height) / 2) + 1
  const profile = new Uint32Array(reach * 2 + 1)
  const sharpness = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    profile.fill(0)
    for (let i = 0; i < points; i++) profile[Math.round(ys[i] * cos - xs[i] * sin) + reach]++
    let total = 0
    for (let i = 0; i < profile.length; i++) total += profile[i] * profile[i]
    return total
  }

  let best = 0
  let bestScore = sharpness(0)
  const level = bestScore
  for (let degrees = -MAX_ANGLE; degrees <= MAX_ANGLE; degrees++) {
    const score = sharpness(degrees)
    if (score > bestScore) {
      bestScore = score
      best = degrees
    }
  }
  const coarse = best
  for (let tenth = -9; tenth <= 9; tenth++) {
    const degrees = coarse + tenth / 10
    if (Math.abs(degrees) > MAX_ANGLE) continue
    const score = sharpness(degrees)
    if (score > bestScore) {
      bestScore = score
      best = degrees
    }
  }

  if (Math.abs(best) < MIN_ANGLE || bestScore < level * MIN_GAIN) return 0
  return (best * Math.PI) / 180
}
