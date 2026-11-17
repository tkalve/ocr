import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const LANG_SCOPE = '@tesseract.js-data/'

/**
 * Self-hosts everything the OCR engine needs (worker script, WASM cores and
 * language models) under /tesseract, straight from node_modules, so nothing is
 * ever loaded from a CDN. Every installed @tesseract.js-data/* package becomes
 * an available language.
 */
function ocrAssets(): { plugin: Plugin; languages: string[] } {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const languages = Object.keys(pkg.dependencies ?? {})
    .filter((name) => name.startsWith(LANG_SCOPE))
    .map((name) => name.slice(LANG_SCOPE.length))
    .sort()

  const tesseractDir = path.dirname(require.resolve('tesseract.js/package.json'))
  const coreDir = path.dirname(
    createRequire(path.join(tesseractDir, 'package.json')).resolve('tesseract.js-core/package.json'),
  )

  const files = new Map<string, string>([
    ['tesseract/worker.min.js', path.join(tesseractDir, 'dist/worker.min.js')],
  ])
  for (const variant of ['', '-simd', '-relaxedsimd']) {
    const name = `tesseract-core${variant}-lstm.wasm.js`
    files.set(`tesseract/core/${name}`, path.join(coreDir, name))
  }
  for (const lang of languages) {
    const dir = path.dirname(require.resolve(`${LANG_SCOPE}${lang}/package.json`))
    files.set(`tesseract/lang/${lang}.traineddata.gz`, path.join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`))
  }
  for (const [url, file] of files) {
    if (!existsSync(file)) throw new Error(`OCR asset for /${url} not found at ${file}`)
  }

  const plugin: Plugin = {
    name: 'ocr-assets',
    configureServer(server) {
      const base = server.config.base
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        const file = pathname.startsWith(base) ? files.get(pathname.slice(base.length)) : undefined
        if (!file) return next()
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const [fileName, file] of files) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
      }
    },
  }
  return { plugin, languages }
}

const ocr = ocrAssets()
const apiProxy = { '/api': 'http://localhost:8787' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ocr.plugin],
  define: {
    __OCR_LANGUAGES__: JSON.stringify(ocr.languages),
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
