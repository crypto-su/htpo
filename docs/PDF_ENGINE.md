# Htpo PDF engine

Htpo generates PDF files in the browser using its own TypeScript engine. The public API is exposed through `toPdf`, `prepare` and `PdfResult`.

## Architecture

- `src/pdf/writer.ts`: PDF 1.7 objects, byte-based xref offsets, page resources, compressed content streams, drawings, transparency, URI links and metadata.
- `src/pdf/truetype.ts`: Unicode cmap format 4/12 parsing; TTF subsetting for used glyphs and composite glyph components; updated glyph indices, metrics and table checksums.
- `src/pdf/svg.ts`: basic SVG shapes and paths. Transforms and viewBox mapping use browser measurements; supports strokes, fills, dashes, curves, elliptical arcs and viewport clipping.
- `src/pdf/binary.ts`: byte concatenation, Unicode PDF strings and native Deflate compression/decompression.
- `scripts/compressed-fonts.ts`: compresses the default TTF files at build time. The browser decompresses each complete font, preserving its character coverage for HTML layout.

PDF fonts use `Type0` / `CIDFontType2`, `Identity-H`, `CIDToGIDMap` and `ToUnicode`. Different Unicode characters receive separate CIDs even when they map to the same glyph, preserving characters during text extraction. Unused fonts are omitted from the PDF. TrueType hint tables, font names and license information are retained.

RGB/grayscale JPEG streams are embedded without JPEG re-encoding. The browser decodes CMYK JPEG, PNG/WebP/GIF and canvas pixels; RGB data and any alpha mask are stored using lossless Deflate compression. File signatures identify source formats independently of MIME labels. Shared images are embedded once; pages reference only the resources they use.

`resizeImages: true` (default: `false`) adds an optional preprocessing step: `src/images.ts` maps each HTML `<img>` layout to its PDF scale and computes the target dimensions at `resizeDpi` (default: 96). It crops source pixels hidden by `object-fit` and allocates a canvas only at the output dimensions. The cache key combines the source, dimensions and crop, so a larger placement never reuses an undersized bitmap. Each export creates a new cache, preventing DPI/encoding changes from reusing images from a previous export. With `resizeLossless: false`, resized JPEGs are re-encoded at `imageQuality ?? 0.95`; with `true`, canvas pixels go directly through the RGB/Deflate path without further JPEG loss. Other sources already use lossless pixel streams with alpha masks. Source download sizes remain unchanged. Downsampling reduces detail at high zoom or print resolution; `resizeLossless` applies only to encoding after resizing.

DPI is calculated from the final physical PDF dimensions, without multiplying by `scale` or the display's `devicePixelRatio`. Values must be positive and finite. Source dimensions are never exceeded, and `maxCanvasPixels` still applies. The lossless and DPI options affect only HTML images that undergo resizing; format exemptions, raster page resolution, SVG geometry and CSS decorations keep their existing behavior. Options set in `prepare` are inherited and can be overridden per export with `prepared.toPdf`.

`src/pdf/jpeg.ts` reads JPEG headers. Default DeviceRGB/DeviceGray DCT embedding does not apply EXIF orientation or ICC color conversion. During resizing, APP1 segments and ICC-bearing APP2 segments are removed from a temporary JPEG decoding copy to preserve the existing PDF orientation and colors. Other APP2 segments, Adobe APP14 and compressed scan data are retained. The original resource, HTML and image links are unchanged. CSS decorations, inline SVG geometry and raster page resolution are unaffected.

## Supported features

`resizeIgnoreExt` specifies format-based resizing exemptions; the default is `[]`, for example `['png']`. It accepts a single string or an array and normalizes case, leading dots and jpg/jpeg aliases. `src/images.ts` reads a short data header to identify the actual format, falling back to MIME information for unknown types. PNG/JPEG images are therefore classified correctly even when served with misleading extensions or MIME labels. Exempt images follow the original-resolution embedding and cropping path. The option works in `toPdf`/`prepare` and `prepared.toPdf`; passing `[]` during export clears inherited exemptions.

| Feature | Behavior |
| --- | --- |
| PDF text | Selectable Latin/Turkish text and Unicode supported by the font; UTF-16 ToUnicode mappings, including characters outside the BMP. |
| TTF | Static TrueType `glyf` fonts, regular/bold and supplied static italic faces. |
| Shapes | Rectangles, rounded rectangles, lines, Bézier paths, fills/strokes, alpha and clipping. |
| SVG | `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` (M/L/H/V/C/S/Q/T/A/Z), group transforms and solid colors. |
| Complex SVG | Text/use, gradients/patterns, masks/clipPath, filters, markers and group alpha compositing cause the entire SVG to be rasterized by the browser. Reports `SVG_RASTERIZED`. |
| Images | JPEG, PNG, WebP and other static images the browser can decode; transparency masks and shared resource reuse. |
| Links | HTTP(S), mailto and tel URI annotations. |
| Metadata | `Producer: Htpo PDF 0.1.0`, `Creator: Htpo 0.1.0`; Unicode title/author. |

PDF page dimensions cannot exceed 14,400 pt. Compressed fonts require `DecompressionStream`; raster streams require `CompressionStream`. Missing APIs produce explicit errors. Cancellation and timeouts are cooperative during long operations; immediate interruption during compression is not guaranteed.

## Known limitations

General font shaping (GSUB/GPOS), color emoji fonts, CFF/WOFF/WOFF2, variable fonts, PDF/A, tagged PDF, forms, encryption, signatures and bookmarks are not implemented. Unsupported TTF files produce explicit errors. Missing glyphs produce `FONT_GLYPH_MISSING`; although ToUnicode preserves the text, a suitable font is still required to display it. Use raster mode for complex writing systems.

CSS layout and pagination are handled by Htpo's layout layer. Complex overflow, stacking context and transform behavior is not fully supported. Raster fallbacks for complex SVG are also limited by the browser's SVG Image support; vector equivalence is not guaranteed for all SVG/CSS features.

## Validation

```sh
npm test
npm run test:e2e
npm run test:standalone
```

Browser tests generate their own synthetic inputs. Outputs are stored in `test-results/` and excluded from Git and npm packages. To run optional checks with an independent PDF reader, first run `npm run test:e2e`:

```sh
python3 -m venv .venv
.venv/bin/pip install pymupdf pillow
.venv/bin/python scripts/verify-engine.py
.venv/bin/python scripts/verify-image-resize.py
```

Python only opens generated PDFs and checks their structure, text, fonts, image pixels and links; it is not part of PDF generation. Turkish and other Unicode strings in test inputs are intentional regression coverage.

## Format references

File structure, font objects and image objects follow the [ISO 32000-1 PDF specification](https://developer.adobe.com/document-services/docs/assets/35e4369068f86065372c18787171a17e/PDF_ISO_32000-1.pdf). TrueType character mapping and composite glyph structures are based on Microsoft's [cmap](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap) and [glyf](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf) documentation.
