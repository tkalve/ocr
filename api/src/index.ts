const MAX_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 20_000

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/image') return proxyImage(request, url)
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler

/**
 * Fetches a remote image on behalf of the frontend, because most image hosts
 * don't send CORS headers and the browser therefore can't read their pixels.
 */
async function proxyImage(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET') return fail(405, 'Method not allowed.')

  // Only our own frontend may use the proxy: this blocks other sites from
  // hotlinking through it and blocks top-level navigations to proxied content.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return fail(403, 'This endpoint can only be used by the app itself.')
  }

  const requested = parseTarget(url.searchParams.get('url'))
  if (!requested) return fail(400, 'That is not a valid public http(s) URL.')
  let target: URL = requested

  let upstream: Response
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    for (let hop = 0; ; hop++) {
      upstream = await fetch(target, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'image/*,*/*;q=0.5',
          'user-agent': 'Mozilla/5.0 (compatible; ocr-image-proxy/1.0)',
        },
      })
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      const location = upstream.headers.get('location')
      await upstream.body?.cancel()
      const next: URL | null = location ? parseTarget(new URL(location, target).href) : null
      if (!next || hop >= MAX_REDIRECTS) return fail(502, 'The image host redirected somewhere we cannot follow.')
      target = next
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return timedOut
      ? fail(504, 'The image host took too long to respond.')
      : fail(502, 'Could not reach the image host.')
  }

  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel()
    return fail(502, `The image host responded with HTTP ${upstream.status}.`)
  }

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const isImage = type.startsWith('image/')
  if (!isImage && type !== '' && type !== 'application/octet-stream') {
    await upstream.body.cancel()
    return fail(415, `That URL points to ${type}, not an image.`)
  }

  if (Number(upstream.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await upstream.body.cancel()
    return fail(413, 'That image is too large (25 MB max).')
  }

  return new Response(capped(upstream.body, MAX_BYTES), {
    headers: {
      'content-type': isImage ? type : 'application/octet-stream',
      'cache-control': 'no-store',
      // The body is untrusted: never let a browser render it as a document.
      'content-disposition': 'attachment',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    },
  })
}

function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength
        if (total > max) controller.error(new Error('Image too large'))
        else controller.enqueue(chunk)
      },
    }),
  )
}

function parseTarget(raw: string | null): URL | null {
  if (!raw || !URL.canParse(raw)) return null
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (isPrivateHost(url.hostname)) return null
  return url
}

/** Rejects hosts that could point back into a private network (SSRF). */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true
  if (!host.includes('.') && !host.startsWith('[')) return true

  // IPv6 literal: only allow global unicast (2000::/3).
  if (host.startsWith('[')) return !/^\[[23]/.test(host)

  // The URL parser normalises every IPv4 spelling (hex, octal, integer) to dotted decimal.
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
}
