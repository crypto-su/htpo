# htpo — HTML to PDF Offline

**Example Site:** [https://htpo.8bit.tr](https://htpo.8bit.tr)

A JavaScript/TypeScript SDK for converting HTML to PDF in the browser. No runtime npm dependencies; the PDF engine and default fonts are included in a single file. **Experimental release: 0.1.0.**

## Recommended for reports

Use these settings as a starting point for report generation in your browser application.

### Direct script

Load one of the following versioned URLs, or use a local copy of the same file.

```html
<button id="download-pdf">Download PDF</button>
<script src="https://cdn.jsdelivr.net/gh/crypto-su/htpo@v0.1.0/dist/htpo.min.js"></script>
<!-- Alternatives: use only one script source.
<script src="https://cdn.jsdelivr.net/npm/@8bit.tr/htpo@0.1.0/dist/htpo.min.js"></script>
<script src="https://unpkg.com/@8bit.tr/htpo@0.1.0/dist/htpo.min.js"></script>
<script src="./dist/htpo.min.js"></script>
-->
<script>
  async function createReport(html) {
    const pdf = await Htpo.toPdf(html, {
      format: 'a4',
      margin: 0,
      mode: 'vector',
      resourcePolicy: 'warn',
    });

    pdf.save('report.pdf');
    // Or upload the Blob to your server (accepting an application/pdf body):
    // await fetch('/api/reports', { method: 'POST', body: pdf.blob });
    return pdf;
  }

  document.querySelector('#download-pdf').onclick = () => createReport('<h1>My report</h1>');
</script>
```

### npm package

See [package installation](#using-the-sdk-in-another-npm-project) for setup.

```js
import { toPdf } from '@8bit.tr/htpo';

async function createReport(html) {
  const pdf = await toPdf(html, {
    format: 'a4',
    margin: 0,
    mode: 'vector',
    resourcePolicy: 'warn',
  });

  pdf.save('report.pdf');
  // Or upload the Blob to your server (accepting an application/pdf body):
  // await fetch('/api/reports', { method: 'POST', body: pdf.blob });
  return pdf;
}
```

Missing resources are reported in `pdf.diagnostics` while generation continues.

## Advanced usage

Load the standalone file from a CDN, or copy [dist/htpo.min.js](dist/htpo.min.js) into your application. No Node.js installation or build step is required. The example below covers every option; omit any you do not need.

```html
<button id="download-pdf">Download PDF</button>
<script src="https://cdn.jsdelivr.net/gh/crypto-su/htpo@v0.1.0/dist/htpo.min.js"></script>
<!-- Alternatives: use only one script source.
<script src="https://cdn.jsdelivr.net/npm/@8bit.tr/htpo@0.1.0/dist/htpo.min.js"></script>
<script src="https://unpkg.com/@8bit.tr/htpo@0.1.0/dist/htpo.min.js"></script>
<script src="./dist/htpo.min.js"></script>
-->
<script>
  const html = `
    <section class="pdf-page">
      <h1>Hello, Htpo!</h1>
      <p>Selectable PDF text with Turkish characters: ç, ğ, ı, İ, ö, ş, ü.</p>
      <a href="https://example.com">Visit the website</a>
    </section>
  `;

  document.querySelector('#download-pdf').addEventListener('click', async () => {
    const controller = new AbortController();
    const resources = new Map(); // Optional: absolute URL → Blob.

    try {
      const pdf = await Htpo.toPdf(html, {
        // Page size and layout
        format: 'a4',               // Default: 'a4'. Also 'a3', 'letter' or [width, height] (mm).
        orientation: 'portrait',   // 'portrait' | 'landscape'; otherwise uses the format's orientation.
        margin: { top: 12, right: 12, bottom: 12, left: 12 }, // mm; also accepts a single number. Default: 0.
        viewportWidth: undefined,  // CSS px; defaults to the printable width at 96 DPI.
        pageSelector: '.pdf-page', // Each match becomes a page. Omit for automatic detection.
        pagination: 'auto',        // 'auto' | 'explicit' | 'flow'; default: 'auto'.
        media: 'screen',           // 'screen' | 'print'; default behavior: 'screen'.
        compatibility: 'modern',  // 'modern' | 'qt-webkit'; default behavior: 'modern'.

        // Resources and styles
        baseUrl: document.baseURI, // Base for relative URLs; defaults to the document/source URL.
        css: `
          body { font-family: 'Htpo Sans', sans-serif; color: #20382e; }
          .pdf-page { width: 100%; height: 273mm; box-sizing: border-box; }
          h1 { color: #42684e; }
        `,                        // Additional CSS for the document; empty by default.
        fonts: [],                // Defaults to embedded Htpo Sans regular/bold.
        // Custom font example (add to the fonts array):
        // { family: 'My Font', src: '/fonts/my-font.ttf',
        //   weight: 400, style: 'normal', aliases: ['Arial'] }
        // src: URL or Uint8Array; weight defaults to 400; style: 'normal' | 'italic'.
        resourcePolicy: 'error',   // 'error' stops; 'warn' skips missing resources and reports them.
        resolveResource: (url, signal) => resources.get(url),
        // May return a Blob / Promise<Blob>; undefined falls through to normal fetch.
        // signal lets you cancel custom loading. No callback is configured by default.

        // PDF and image quality
        mode: 'vector',            // 'vector' | 'raster'; default: 'vector'.
        resizeImages: false,      // Downsamples HTML images in vector PDFs; default: false.
        resizeDpi: 96,             // Target resolution; positive, finite DPI. Default: 96.
        resizeLossless: false,     // Stores resized JPEG pixels losslessly; default: false.
        resizeIgnoreExt: [],       // Formats exempt from resizing: ['png'], ['png', 'jpg'] or 'png'.
        scale: 2,                 // Raster page scale; default: 2. Does not change vector DPI.
        imageType: 'png',          // Raster page format: 'png' | 'jpeg'; default: 'png'.
        imageQuality: 0.95,        // JPEG quality (0–1); default: 0.95.

        // Limits, cancellation and progress
        timeout: 30_000,           // Loading/rendering time limit (ms); default: 30000.
        maxPages: 500,             // Maximum page count; default: 500.
        maxCanvasPixels: 32_000_000, // Pixel limit per canvas; default: 32000000.
        signal: controller.signal, // Cancel with controller.abort(); no external signal by default.
        onProgress: ({ phase, completed, total }) => {
          // phase: 'loading' | 'layout' | 'rendering' | 'complete'.
          console.log(phase, completed, total);
        },                        // Optional progress callback.

        // Document metadata, headers and footers
        title: 'My first document', // Defaults to the source HTML title.
        author: 'My application',  // Empty by default.
        header: '{title}',         // None by default. Plain text, not HTML.
        footer: 'Page {page} / {pages}', // Tokens: {page}, {pages}, {title}.
      });

      pdf.save('document.pdf');
      // pdf.blob → Blob: use it in your own upload/save workflow.
      // pdf.pages → page information; pdf.diagnostics → warnings/information.
      // pdf.durationMs → rendering time; pdf.mode → output mode used.
      console.table(pdf.diagnostics);
    } catch (error) {
      console.error('Failed to create PDF:', error);
    }
  });
</script>
```

Minimal usage: `const pdf = await Htpo.toPdf(html); pdf.save('document.pdf');`. `toPdf` returns the result; only `save()` starts a download. Keep the license notices at the beginning of the standalone JS file.

## Development with npm

With Node.js **22.12+**, run these commands in your cloned project directory:

```sh
npm ci
npm run build
```

Source code lives in `src/`. To watch for changes and automatically update `dist/htpo.min.js`:

```sh
npm run dev
```

`npm run dev` runs the build in watch mode. Run `npm run build` to regenerate all distribution files and TypeScript declarations. Use `npm run build:standalone` for a single build of the standalone file.

| Output | Usage |
| --- | --- |
| `dist/htpo.min.js` | Load directly with `<script>`; exposes `window.Htpo`. Included in the repository. |
| `dist/htpo.js` | ESM for browser applications using tools such as Vite/Webpack. |
| `dist/htpo.umd.cjs` | UMD distribution. |
| `dist/*.d.ts` | TypeScript declarations. |

All distributions embed DejaVu Sans regular/bold fonts. The standalone build requires no additional JS, font or CSS files; images, stylesheets and fonts referenced by your source HTML are loaded separately. Commit the updated `dist/htpo.min.js` alongside source changes.

### Using the SDK in another npm project

Install the published package in your application:

```sh
npm install @8bit.tr/htpo
```

To use a local build instead, create and install a package from this repository:

```sh
# In the htpo directory; automatically runs a full build before packaging.
npm pack

# In your application directory; adjust the path to the generated package.
npm install /path/to/htpo/8bit.tr-htpo-0.1.0.tgz
```

Then import the SDK in your browser code:

```ts
import { toPdf, type HtpoOptions } from '@8bit.tr/htpo';

const options: HtpoOptions = { format: 'a4', margin: 12, mode: 'vector' };
const pdf = await toPdf('<h1>Hello!</h1>', options);
pdf.save('document.pdf');
```

PDF generation requires a browser DOM. npm and Node.js are development and packaging tools; the SDK does not run as a Node.js PDF converter.

### Tests

```sh
npm run typecheck
npm test
npm run test:e2e        # Requires local Google Chrome; starts/stops its own test server.
npm run test:standalone # Full build + standalone JS browser tests.
```

Tests use synthetic data. Temporary output goes into `test-results/` and is excluded from distributions. Turkish and other Unicode text in test fixtures is intentional: it verifies character preservation, font subsetting and text extraction. Optional checks using an independent PDF reader are described in the [PDF engine documentation](docs/PDF_ENGINE.md#validation).

## API

`Htpo.toPdf(source, options)` and `Htpo.prepare(source, options)` accept the same source types:

| Source | Example |
| --- | --- |
| HTML string | `'<h1>Document</h1>'` — a string is always treated as HTML. |
| HTML with a resource base URL | `{ html: '<img src="photo.jpg">', baseUrl: 'https://example.com/docs/' }` |
| HTML URL | `{ url: 'https://example.com/document.html' }` |
| DOM element | `document.querySelector('#document')` — the element must exist. |

DOM elements are cloned along with the document's style elements and stylesheet links. Canvas pixels, Shadow DOM and live changes to form values are not serialized. Input scripts are not executed.

`PdfResult` contains `blob`, `pages`, `diagnostics`, `durationMs`, `mode` and `save(filename?)`. The default filename is `document.pdf`. Each `PageInfo` contains `number` (1-based), `width`/`height` (mm), `sourceTop`/`sourceHeight` (CSS px) and `kind` (`explicit`/`flow`). Each `Diagnostic` contains `code`, `message`, `severity` (`warning`/`info`) and, where applicable, `page`. The SDK exports `ResourceError` for resource errors. `Htpo.saveBlob(blob, filename?)` is also available.

### Preparing, previewing and exporting again

```js
const prepared = await Htpo.prepare(html, { margin: 12 });
try {
  const canvas = await prepared.preview(1, 1.5); // Page number, preview scale.
  document.body.append(canvas);
  const pdf = await prepared.toPdf({ mode: 'vector', resizeImages: true });
  pdf.save('document.pdf');
} finally {
  prepared.dispose();
}
```

The result of `prepare` exposes `pages` and `diagnostics`. Calls to `prepared.toPdf()` can override `mode`, `scale`, `imageType`, `imageQuality`, `resizeImages`, `resizeDpi`, `resizeLossless`, `resizeIgnoreExt` and `onProgress`. Call `dispose()` when finished, after any active render has completed. `toPdf()` handles this cleanup automatically.

`prepared.print()` opens the browser's print dialog and does not return a Blob. Keep the prepared document alive until the print dialog closes.

### Pagination and output behavior

- `pageSelector` makes each match a page. Without a selector, `auto` detects `data-htpo-page` markers or blocks with an explicit height and `position: relative; break-after: page/always`; otherwise it uses flow pagination.
- `explicit` requires explicit page definitions. `flow` splits continuous content into pages, attempting to preserve text and table rows, `rowspan` cells and `break-inside: avoid` blocks. Simple tables repeat their `thead`.
- Content that exceeds an explicit page is clipped and reported as `PAGE_OVERFLOW`. Leave enough margin for headers and footers.
- `vector` produces selectable text, embedded fonts, basic SVG geometry and HTTP(S)/mailto/tel links. Complex SVG may be rasterized and reported as `SVG_RASTERIZED`.
- `raster` stores each page as an image; content text is not selectable and links are not preserved. `scale`, `imageType` and `imageQuality` control output quality.
- `compatibility: 'qt-webkit'` is a limited legacy layout option that rounds line heights to whole pixels and applies `object-fit: fill; image-orientation: none` to images.

### Images, fonts and resources

`resizeImages: true` downsamples HTML images in vector output to their visible PDF area at `resizeDpi`. Source pixels are never enlarged; `object-fit` and `object-position` are taken into account. The original resource is still loaded; resizing reduces the generated PDF, not the download. CSS backgrounds and rasterized SVG fallbacks are outside this option's scope.

`resizeLossless: true` stores resized JPEG pixels without additional JPEG loss; it cannot recover detail lost through downsampling. `resizeIgnoreExt` is case-insensitive and ignores a leading dot; `jpg`/`jpeg` are equivalent. Formats are detected from file contents/MIME information. `imageQuality` does not affect images stored losslessly.

Custom fonts must be static, `glyf`-based TTF files. Each `fonts` entry requires `family` and `src`; `weight`, `style` and `aliases` are optional. Supply regular/bold/italic faces as separate entries. Unmatched families produce `FONT_SUBSTITUTED`; missing characters produce `FONT_GLYPH_MISSING`. WOFF/WOFF2/CFF, variable fonts and GSUB/GPOS shaping are unsupported; use raster mode for complex writing systems. Turkish characters are supported by the embedded fonts.

Resource loading follows the browser's CORS rules. Use same-origin resources, resources with CORS permission or embedded data. `resolveResource(url, signal)` supplies Blob data already available to your application; returning `undefined` falls through to normal `fetch`. Documents without external resources can be generated offline.

Modern browser DOM/Canvas APIs, `CompressionStream` and `DecompressionStream` are required. Cancellation and timeouts are cooperative; long synchronous operations may not stop immediately. Full CSS Fragmentation, all CSS painting behaviors, PDF/A, tagged PDF, form fields, encryption and digital signatures are unsupported. Technical details: [PDF engine](docs/PDF_ENGINE.md), [HTML sanitization](docs/HTML_SANITIZATION.md).

## License

Copyright © 2026 Ugur Yildirim · [8bit.tr](https://8bit.tr) · [info@8bit.tr](mailto:info@8bit.tr)

[MIT license](LICENSE) and [third-party notices](THIRD_PARTY.md). The embedded DejaVu font license is in [assets/fonts/LICENSE.txt](assets/fonts/LICENSE.txt).
