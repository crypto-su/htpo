import type { NormalizedOptions, HtpoOptions } from './types';
export const PX_PER_MM = 96 / 25.4;
export const PT_PER_MM = 72 / 25.4;

export function normalizeResizeIgnoreExt(value: HtpoOptions['resizeIgnoreExt']): string[] {
  if (value === undefined) return [];
  const entries = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(entries) || entries.some(ext => typeof ext !== 'string')) throw new TypeError('resizeIgnoreExt must be an extension string or an array of extension strings.');
  return [...new Set(entries.map(ext => {
    const name = ext.trim().replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]+$/.test(name)) throw new TypeError('resizeIgnoreExt entries must be file extensions, e.g. png or jpg.');
    return name === 'jpg' || name === 'jpe' ? 'jpeg' : name === 'tif' ? 'tiff' : name;
  }))];
}

export function normalizeOptions(input: HtpoOptions = {}): NormalizedOptions {
  const sizes: Record<string, [number, number]> = { a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4] };
  const size = [...(Array.isArray(input.format) ? input.format : sizes[input.format ?? 'a4'])] as [number, number];
  if (input.orientation === 'landscape') size.sort((a, b) => b - a);
  if (input.orientation === 'portrait') size.sort((a, b) => a - b);
  const margin = typeof input.margin === 'number'
    ? { top: input.margin, right: input.margin, bottom: input.margin, left: input.margin }
    : { top: 0, right: 0, bottom: 0, left: 0, ...input.margin };
  if (size.some(v => !Number.isFinite(v) || v <= 0) || Object.values(margin).some(v => !Number.isFinite(v) || v < 0)) {
    throw new RangeError('Page dimensions must be positive and margins must be non-negative.');
  }
  if (margin.left + margin.right >= size[0] || margin.top + margin.bottom >= size[1]) throw new RangeError('Margins leave no printable area.');
  const options = { ...input, size, margin, viewportWidth: input.viewportWidth ?? (size[0] - margin.left - margin.right) * PX_PER_MM,
    pagination: input.pagination ?? 'auto', mode: input.mode ?? 'vector', scale: input.scale ?? 2,
    resizeImages: input.resizeImages ?? false,
    resizeDpi: input.resizeDpi ?? 96,
    resizeLossless: input.resizeLossless ?? false,
    resizeIgnoreExt: normalizeResizeIgnoreExt(input.resizeIgnoreExt),
    timeout: input.timeout ?? 30000, maxPages: input.maxPages ?? 500, maxCanvasPixels: input.maxCanvasPixels ?? 32_000_000,
    resourcePolicy: input.resourcePolicy ?? 'error',
  } satisfies NormalizedOptions;
  for (const key of ['viewportWidth', 'scale', 'resizeDpi', 'timeout', 'maxPages', 'maxCanvasPixels'] as const) {
    if (!Number.isFinite(options[key]) || options[key] <= 0) throw new RangeError(`${key} must be a positive finite number.`);
  }
  if (!Number.isInteger(options.maxPages)) throw new RangeError('maxPages must be an integer.');
  if (typeof options.resizeImages !== 'boolean') throw new TypeError('resizeImages must be a boolean.');
  if (typeof options.resizeLossless !== 'boolean') throw new TypeError('resizeLossless must be a boolean.');
  return options;
}
