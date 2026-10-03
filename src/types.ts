export type HtmlSource = string | { html: string; baseUrl?: string } | { url: string } | HTMLElement;
export type PdfMode = 'vector' | 'raster';
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'warning' | 'info';
  page?: number;
}
export interface FontSource {
  family: string;
  src: string | Uint8Array;
  weight?: number;
  style?: 'normal' | 'italic';
  /** Additional CSS family names that should use the same font. */
  aliases?: string[];
}
export interface Progress {
  phase: 'loading' | 'layout' | 'rendering' | 'complete';
  completed: number;
  total: number;
}
export interface HtpoOptions {
  /** Millimeters; custom sizes are [width, height]. */
  format?: 'a4' | 'a3' | 'letter' | [number, number];
  orientation?: 'portrait' | 'landscape';
  margin?: number | Partial<{ top: number; right: number; bottom: number; left: number }>;
  /** CSS pixels. Defaults to the printable page width at 96 DPI. */
  viewportWidth?: number;
  /** Each matching element becomes a page; otherwise CSS breaks are detected. */
  pageSelector?: string;
  pagination?: 'auto' | 'explicit' | 'flow';
  media?: 'screen' | 'print';
  /** Approximate QtWebKit's integer line heights and lack of object-fit support. */
  compatibility?: 'modern' | 'qt-webkit';
  baseUrl?: string;
  css?: string;
  fonts?: FontSource[];
  mode?: PdfMode;
  /** Downsample embedded HTML images to their visible PDF area at resizeDpi in vector mode. Defaults to false. */
  resizeImages?: boolean;
  /** Target resolution for resized images; positive finite DPI. Defaults to 96. Never enlarges source pixels. */
  resizeDpi?: number;
  /** Store resized pixels losslessly instead of re-encoding JPEGs. Does not undo downsampling. Defaults to false. */
  resizeLossless?: boolean;
  /** Formats exempt from resizing, e.g. ['png']. Case-insensitive; jpg/jpeg are equivalent. Defaults to []. */
  resizeIgnoreExt?: string | readonly string[];
  scale?: number;
  imageType?: 'png' | 'jpeg';
  imageQuality?: number;
  resourcePolicy?: 'error' | 'warn';
  /** Supply application-owned resource bytes before normal fetch (undefined falls through). */
  resolveResource?: (url: string, signal: AbortSignal) => Blob | undefined | Promise<Blob | undefined>;
  timeout?: number;
  maxPages?: number;
  maxCanvasPixels?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
  title?: string;
  author?: string;
  /** Simple margin furniture. Tokens: {page}, {pages}, {title}. */
  header?: string;
  footer?: string;
}
export interface PageInfo {
  number: number;
  width: number;
  height: number;
  sourceTop: number;
  sourceHeight: number;
  kind: 'explicit' | 'flow';
}
export interface PdfResult {
  blob: Blob;
  pages: PageInfo[];
  diagnostics: Diagnostic[];
  durationMs: number;
  mode: PdfMode;
  save: (filename?: string) => void;
}
export interface NormalizedOptions extends Omit<HtpoOptions, 'format' | 'margin' | 'pagination' | 'mode' | 'resizeIgnoreExt'> {
  size: [number, number];
  margin: { top: number; right: number; bottom: number; left: number };
  pagination: 'auto' | 'explicit' | 'flow';
  mode: PdfMode;
  resizeImages: boolean;
  resizeDpi: number;
  resizeLossless: boolean;
  resizeIgnoreExt: string[];
  scale: number;
  timeout: number;
  maxPages: number;
  maxCanvasPixels: number;
  resourcePolicy: 'error' | 'warn';
  viewportWidth: number;
}
export interface PageSlice {
  info: PageInfo;
  element: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Repeated table header, translated to the start of a continuation page. */
  repeatHeader?: { element: HTMLElement; height: number };
}
