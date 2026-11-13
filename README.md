# Compacta PDF

A small web app that shrinks PDF files **entirely in the browser**. Files never leave the user's computer.
It runs [Ghostscript](https://www.ghostscript.com/) compiled to WebAssembly
([@okathira/ghostpdl-wasm](https://github.com/okathira/ghostpdl-wasm) 1.1.0) inside a Web Worker.

A 62-page, 266 MB Canva export comes out at about 5 MB (Equilibrado) in roughly 15 seconds.

## Quality presets

| Preset | Image resolution | JPEG quality | Use for |
|---|---|---|---|
| Menor tamanho | 90 dpi | 65 | WhatsApp, e-mail |
| Equilibrado (default) | 110 dpi | 75 | Everyday use; no visible difference on screen |
| Alta qualidade | 150 dpi | 82 | Printing or projecting |

Text and vector graphics are kept as they are. Only the images are downsampled and re-encoded.
If the result would be larger than the original, the app keeps the original.

## Hosting

It's a static site with no build step. Upload this folder to any static host (GitHub Pages, Netlify, Cloudflare Pages).
It needs to be served over `http(s)`. Opening `index.html` directly from disk won't work, because module workers can't load from `file://`.

Run it locally:

```sh
python3 -m http.server --directory . 8000
# open http://localhost:8000
```

After the first visit, a service worker caches everything, including the 15 MB engine, so the app opens instantly and works offline.
In Safari on macOS, *File → Add to Dock* installs it like a regular app. Chrome and Edge offer *Install* in the address bar.

**When you change any file**, bump `VERSION` in `sw.js`, or returning visitors will keep the cached copy.

## Files

- `index.html`, `styles.css`, `app.js`: the interface (Portuguese)
- `worker.js`: runs Ghostscript on a background thread and reports page progress
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and installability
- `vendor/ghostscript/`: the Ghostscript WebAssembly build and its license

## License

Ghostscript is licensed under the AGPL-3.0 (see `vendor/ghostscript/LICENSE`). If you host this publicly, keep the source available, for example in a public repository.
