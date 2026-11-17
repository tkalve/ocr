# Repository guide

## Build, lint, and run

Run each command from its project directory:

| Project | Command | Purpose |
| --- | --- | --- |
| `app` | `npm run dev` | Start the Vite development server at `http://localhost:5173`. |
| `app` | `npm run build` | Type-check and build the frontend. |
| `app` | `npm run lint` | Run Oxlint. To lint one file, use `npx oxlint src/path/to/file.tsx`. |
| `app` | `npm run preview` | Preview the production build. |
| `api` | `npm run dev` | Start the Cloudflare Worker locally at `http://localhost:8787`. |
| `api` | `npm run typecheck` | Type-check the Worker. |
| `api` | `npm run deploy` | Build the frontend, then deploy the Worker and its assets. |

There is no test runner or test script configured in either project.

## Architecture

- `app/` is a React + TypeScript + Vite single-page app; `api/` is a TypeScript Cloudflare Worker. The Worker serves the built app from `app/dist` and handles `/api/*`, so deployed API requests are same-origin. During development, Vite proxies `/api` to the Worker; run both projects for URL images that need the proxy.
- OCR runs in the browser through Tesseract.js. The Vite plugin in `app/vite.config.ts` discovers installed `@tesseract.js-data/*` packages and serves/emits the Tesseract worker, WASM cores, and language models under `/tesseract/`. Keep these assets self-hosted; the frontend should not rely on a CDN.
- `app/src/App.tsx` handles image acquisition (file, paste, drop, URL, and screen capture), request cancellation, and image URL lifecycle. `Viewer` in `app/src/components/Viewer.tsx` owns OCR runs and viewing controls. `app/src/lib/image.ts` prepares image/region coordinate frames, `ocr.ts` parses Tesseract results into image-space lines and words, and `TextLayer.tsx` maps those coordinates to selectable text over the image. Keep the coordinate frame and paragraph/line boundaries consistent across OCR display and copied text.
- Remote images that cannot be read directly because of CORS fall back to `api/src/index.ts` at `/api/image`. The Worker restricts requests to the app's same-origin fetch, validates public HTTP(S) targets and redirects, and caps response size; preserve these constraints when changing the proxy.

## Repository conventions

- Adding an OCR language means adding its `@tesseract.js-data/<code>` package in `app/package.json` and a display name under `languages` in both `app/src/locales/en.json` and `app/src/locales/nb.json`. The Vite plugin discovers installed language packages automatically; `app/src/lib/languages.ts` controls ordering and the default “Auto” choice.
- UI strings live in the English and Norwegian locale JSON files and are used through `react-i18next`. Keep both locale files in sync: `app/src/i18n.ts` uses TypeScript `satisfies` checks to require matching translation keys.
- TypeScript source imports use explicit `.ts`/`.tsx` extensions, as required by the app's Vite/bundler configuration.
