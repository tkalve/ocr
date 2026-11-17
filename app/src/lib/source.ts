export interface ImageSource {
  blob: Blob
  name: string
}

/** What a paste or drop contained: an image file, an image URL, or nothing usable. */
export type Extracted = { kind: 'file'; file: File } | { kind: 'url'; url: string } | { kind: 'none'; hadContent: boolean }

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?|heic|heif)$/i

/**
 * Turns user input into a loadable image URL, or null. In lenient mode
 * (the URL field) a bare "example.com/a.png" is accepted too.
 */
export function normalizeUrl(input: string, lenient = false): string | null {
  let value = input.trim()
  if (!value || /\s/.test(value)) return null
  if (!/^(https?:\/\/|data:image\/|blob:)/i.test(value)) {
    if (!lenient || /^[a-z][a-z0-9+.-]*:/i.test(value) || !/^[^/]+\.[^/]+/.test(value)) return null
    value = `https://${value}`
  }
  return URL.canParse(value) ? value : null
}

export function extract(data: DataTransfer): Extracted {
  const files = Array.from(data.files)
  const file = files.find((f) => f.type.startsWith('image/')) ?? files.find((f) => IMAGE_EXTENSION.test(f.name)) ?? files[0]
  if (file) return { kind: 'file', file }

  // Dragging an image out of a web page: the markup has the real image address,
  // while the URI list may be the link wrapped around it.
  const html = data.getData('text/html')
  if (html) {
    const src = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.getAttribute('src')
    const url = src ? normalizeUrl(src) : null
    if (url) return { kind: 'url', url }
  }

  const uris = data.getData('text/uri-list').split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
  const text = data.getData('text/plain')
  for (const candidate of [...uris, text]) {
    const url = normalizeUrl(candidate)
    if (url) return { kind: 'url', url }
  }
  return { kind: 'none', hadContent: Boolean(html || text || uris.length) }
}

/** Reads an image (or image URL) via the async clipboard API, for the "Paste" button. */
export async function readClipboard(): Promise<Extracted> {
  if (!navigator.clipboard?.read) throw new Error('Press ⌘V / Ctrl+V to paste — this browser has no clipboard button access.')
  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch {
    throw new Error('Clipboard access was blocked. Press ⌘V / Ctrl+V to paste instead.')
  }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) {
      const blob = await item.getType(type)
      return { kind: 'file', file: new File([blob], 'Pasted image', { type }) }
    }
  }
  for (const item of items) {
    if (!item.types.includes('text/plain')) continue
    const url = normalizeUrl(await (await item.getType('text/plain')).text())
    if (url) return { kind: 'url', url }
  }
  return { kind: 'none', hadContent: items.length > 0 }
}

function nameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop()
  if (!last) return url.hostname
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * Downloads an image from a URL. Hosts that allow cross-origin reads are
 * fetched directly; everything else goes through our own /api/image proxy.
 */
export async function fetchImage(href: string): Promise<ImageSource> {
  const url = new URL(href)
  if (url.protocol === 'data:' || url.protocol === 'blob:') {
    const response = await fetch(href).catch(() => null)
    if (!response?.ok) throw new Error('That pasted image data could not be read.')
    return { blob: await response.blob(), name: 'Pasted image' }
  }

  const name = nameFromUrl(url)
  try {
    const direct = await fetch(href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (direct.ok) {
      const blob = await direct.blob()
      // A web page or API response is not an image; the proxy gives a clearer error for those.
      if (blob.size > 0 && !/^(text\/|application\/(json|xml))/.test(blob.type)) return { blob, name }
    }
  } catch {
    // Blocked by CORS, mixed content or the network: let the proxy try.
  }

  const proxied = await fetch(`${import.meta.env.BASE_URL}api/image?url=${encodeURIComponent(href)}`).catch(() => null)
  if (!proxied) throw new Error('Could not load that URL. Check your connection and try again.')
  const type = proxied.headers.get('content-type') ?? ''
  if (proxied.ok && !type.includes('text/html')) {
    try {
      return { blob: await proxied.blob(), name }
    } catch {
      throw new Error('That image could not be downloaded (it may be larger than 25 MB).')
    }
  }
  if (type.includes('application/json')) {
    const body = (await proxied.json().catch(() => null)) as { error?: string } | null
    if (body?.error) throw new Error(body.error)
  }
  throw new Error("That host doesn't allow direct access, and the image proxy isn't available. Download the image and drop it here instead.")
}
