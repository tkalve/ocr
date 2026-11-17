# Professor Kalve's Optical Miracle Machine

[Open the app](https://ocr.tkalve.dev/): drop, paste, upload, link, or screenshot an image, then select and copy its recognized text directly over the image.

OCR runs entirely in your browser with [Tesseract.js](https://github.com/naptha/tesseract.js). The OCR engine and language models are self-hosted by the app; images are not uploaded for OCR. English and Norwegian are supported by the interface, and OCR languages are selectable.

## Development

Install dependencies from each project directory:

```bash
cd app && npm ci
cd ../api && npm ci
```

Run the app at `http://localhost:5173`:

```bash
cd app && npm run dev
```

The frontend works on its own for local images. To use the remote-image proxy for URLs blocked by CORS, run the Worker in another terminal at `http://localhost:8787`:

```bash
cd api && npm run dev
```

## Checks

Run from the relevant project directory:

```bash
cd app && npm run build && npm run lint
```

```bash
cd api && npm run typecheck
```

## Languages and translations

Each installed `@tesseract.js-data/*` package is discovered by the Vite config and becomes an OCR language. To add one, install its package in `app`, then add its display name to both `app/src/locales/en.json` and `app/src/locales/nb.json`.

The “Auto” OCR choice reads in English and Norwegian and selects the result with the most confidently recognized text. The interface follows the browser language and supports English and Norwegian; keep the translation JSON files' keys in sync.

## Deployment

The Cloudflare Worker serves both the built frontend and `/api` endpoints. Deploy from `api/` with `npm run deploy`. GitHub Actions also deploys on pushes to `main`.

See the [security reporting policy](SECURITY.md), the [public security.txt](https://ocr.tkalve.dev/security.txt), and [LICENSE](LICENSE).
