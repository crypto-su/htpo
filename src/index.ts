import { PdfWriter } from './pdf/writer';
import { loadDocument, type LoadedDocument } from './document';
import { registerFonts } from './fonts';
import { normalizeOptions, normalizeResizeIgnoreExt, PT_PER_MM } from './options';
import { paginate } from './pagination';
import { capturePage, renderRaster } from './raster';
import { renderVector } from './vector';
import type { Diagnostic, HtmlSource, NormalizedOptions, PageInfo, PageSlice, PdfResult, HtpoOptions } from './types';
export type { Diagnostic, FontSource, HtmlSource, PageInfo, PdfResult, Progress, HtpoOptions, PdfMode } from './types';
export { ResourceError } from './resources';

export function saveBlob(blob: Blob, filename = 'document.pdf'): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export class PreparedDocument {
  private disposed = false;
  private busy = false;
  readonly pages: PageInfo[];
  constructor(private loaded: LoadedDocument, private slices: PageSlice[], private options: NormalizedOptions, readonly diagnostics: Diagnostic[]) {
    this.pages = slices.map(p => ({ ...p.info }));
  }
  private check() {
    if (this.disposed) throw new Error('PreparedDocument is disposed.');
    this.loaded.resources.check();
  }
  async toPdf(overrides: Pick<HtpoOptions, 'mode' | 'scale' | 'imageType' | 'imageQuality' | 'resizeImages' | 'resizeDpi' | 'resizeLossless' | 'resizeIgnoreExt' | 'onProgress'> = {}): Promise<PdfResult> {
    this.check();
    if (this.busy) throw new Error('This document is already rendering.');
    const options = { ...this.options, ...overrides,
      resizeDpi: overrides.resizeDpi === undefined ? this.options.resizeDpi : overrides.resizeDpi,
      resizeLossless: overrides.resizeLossless === undefined ? this.options.resizeLossless : overrides.resizeLossless,
      resizeIgnoreExt: normalizeResizeIgnoreExt(overrides.resizeIgnoreExt === undefined ? this.options.resizeIgnoreExt : overrides.resizeIgnoreExt) };
    if (!Number.isFinite(options.scale) || options.scale <= 0) throw new RangeError('scale must be positive.');
    if (typeof options.resizeImages !== 'boolean') throw new TypeError('resizeImages must be a boolean.');
    if (!Number.isFinite(options.resizeDpi) || options.resizeDpi <= 0) throw new RangeError('resizeDpi must be a positive finite number.');
    if (typeof options.resizeLossless !== 'boolean') throw new TypeError('resizeLossless must be a boolean.');
    this.busy = true;
    const started = performance.now();
    const diagnostics = [...this.diagnostics];
    try {
      const pdf = new PdfWriter(options.size[0] * PT_PER_MM, options.size[1] * PT_PER_MM, options.maxCanvasPixels);
      const title = options.title ?? this.loaded.doc.title ?? 'Document';
      pdf.setProperties({ title, author: options.author ?? '', creator: 'Htpo 0.1.0' });
      registerFonts(pdf, this.loaded.fonts);
      const images = new Map<string, string>(); const warnings = new Set<string>();
      if (options.mode === 'raster') diagnostics.push({ code: 'RASTER_TEXT', severity: 'info', message: 'Raster PDF pages are images; text is not selectable and links are not preserved.' });
      for (const [index, slice] of this.slices.entries()) {
        this.check();
        if (performance.now() - started > options.timeout) throw new DOMException('PDF rendering timed out.', 'TimeoutError');
        options.onProgress?.({ phase: 'rendering', completed: index, total: this.slices.length });
        if (index) pdf.addPage(options.size.map(v => v * PT_PER_MM));
        if (options.mode === 'vector') await renderVector(pdf, slice, options, this.loaded.fonts, diagnostics, images, warnings);
        else await renderRaster(pdf, slice, options);
        this.check();
        const furniture = (template: string) => template.replaceAll('{page}', String(index + 1)).replaceAll('{pages}', String(this.slices.length)).replaceAll('{title}', title);
        pdf.setFont(this.loaded.fonts[0].id); pdf.setFontSize(8); pdf.setTextColor(90);
        if (options.header) pdf.text(furniture(options.header), options.margin.left * PT_PER_MM, Math.max(10, options.margin.top * PT_PER_MM / 2));
        if (options.footer) pdf.text(furniture(options.footer), options.margin.left * PT_PER_MM, options.size[1] * PT_PER_MM - Math.max(6, options.margin.bottom * PT_PER_MM / 2));
        // Yield between pages, keeping progress updates and cancellation responsive.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      this.check();
      const blob = await pdf.output();
      this.check();
      if (performance.now() - started > options.timeout) throw new DOMException('PDF rendering timed out.', 'TimeoutError');
      if (pdf.missingGlyphs.size) diagnostics.push({ code: 'FONT_GLYPH_MISSING', severity: 'warning', message: `The selected fonts lack these characters: ${[...pdf.missingGlyphs].map(cp => `U+${cp.toString(16).toUpperCase()}`).join(', ')}. Supply a font with the required glyphs.` });
      options.onProgress?.({ phase: 'complete', completed: this.slices.length, total: this.slices.length });
      return { blob, pages: this.pages, diagnostics, mode: options.mode, durationMs: performance.now() - started, save: filename => saveBlob(blob, filename) };
    } finally { this.busy = false; }
  }
  async preview(pageNumber = 1, scale = 1): Promise<HTMLCanvasElement> {
    this.check();
    const slice = this.slices[pageNumber - 1]; if (!slice) throw new RangeError('Page number is out of range.');
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('scale must be positive.');
    return capturePage(slice, { ...this.options, scale });
  }
  /** Opens the browser's print dialog. It cannot silently return a PDF Blob. */
  print(): void {
    this.check();
    let style = this.loaded.doc.getElementById('htpo-print');
    if (!style) { style = this.loaded.doc.createElement('style'); style.id = 'htpo-print'; this.loaded.doc.head.append(style); }
    const o = this.options;
    style.textContent = `@page{size:${o.size[0]}mm ${o.size[1]}mm;margin:${o.margin.top}mm ${o.margin.right}mm ${o.margin.bottom}mm ${o.margin.left}mm} @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
    this.loaded.frame.contentWindow!.print();
  }
  dispose(): void {
    if (this.busy) throw new Error('Wait for rendering to finish or abort it before disposing.');
    if (this.disposed) return;
    this.loaded.frame.remove(); this.loaded.resources.dispose(); this.disposed = true;
  }
}

export async function prepare(source: HtmlSource, input: HtpoOptions = {}): Promise<PreparedDocument> {
  const options = normalizeOptions(input); const diagnostics: Diagnostic[] = [];
  const loaded = await loadDocument(source, options, diagnostics);
  try {
    options.onProgress?.({ phase: 'layout', completed: 0, total: 1 });
    const pages = paginate(loaded.doc, options, diagnostics);
    options.onProgress?.({ phase: 'layout', completed: 1, total: 1 });
    return new PreparedDocument(loaded, pages, options, diagnostics);
  } catch (error) { loaded.frame.remove(); loaded.resources.dispose(); throw error; }
}

export async function toPdf(source: HtmlSource, options: HtpoOptions = {}): Promise<PdfResult> {
  const prepared = await prepare(source, options);
  try { return await prepared.toPdf(); } finally { prepared.dispose(); }
}
