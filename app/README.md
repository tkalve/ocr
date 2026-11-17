# Professor Kalve's Optical Miracle Machine

Drop, paste, upload, link or screenshot an image, then select and copy the text right on top of it.

OCR runs entirely in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js). The engine and
language models are served from this app (`/tesseract/*`, copied from `node_modules` by `vite.config.ts`),
so nothing is loaded from a CDN.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
```

Loading an image from a URL falls back to the `/api/image` proxy when the image host doesn't allow
cross-origin reads. Run the Worker alongside for that (Vite proxies `/api` to it):

```bash
cd ../api && npm install && npm run dev   # http://localhost:8787
```

## Languages

Every installed `@tesseract.js-data/*` dependency becomes a selectable language. To add one:

```bash
npm install @tesseract.js-data/fin
```

and give it a display name under `languages` in `src/locales/en.json` and `src/locales/nb.json`.

The default choice, "Auto", reads the image in English and Norwegian side by side and keeps whichever
reading holds the most confidently read text (`AUTO_LANGUAGES` in `src/lib/languages.ts`).

## Translations

The interface is translated with [react-i18next](https://react.i18next.com) into English and Norwegian
(`src/locales/*.json`, set up in `src/i18n.ts`). It follows the browser language, and the choice on the
start page is remembered. Both files must have the same keys; the build fails otherwise.

## Deploy

The Worker in `../api` serves both the built app and the API:

```bash
cd ../api && npm run deploy
```
