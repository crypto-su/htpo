import { snapshotSvg, svgCanvas } from './snapshot';
import type { PdfWriter } from './pdf/writer';
import type { NormalizedOptions, PageSlice } from './types';
import { PT_PER_MM } from './options';

export async function capturePage(page: PageSlice, options: NormalizedOptions): Promise<HTMLCanvasElement> {
  const headerHeight = page.repeatHeader?.height ?? 0;
  if (Math.ceil(page.width * options.scale) * Math.ceil((page.height + headerHeight) * options.scale) > options.maxCanvasPixels) {
    throw new RangeError('Page exceeds maxCanvasPixels. Reduce scale or choose vector mode.');
  }
  options.signal?.throwIfAborted();
  const capture = (element: HTMLElement, x: number, y: number, width: number, height: number) =>
    svgCanvas(snapshotSvg(element, x, y, width, height), width, height, options.scale, options.timeout, options.signal);
  const rect = page.element.getBoundingClientRect();
  const canvas = await capture(page.element, page.x - rect.x, page.y - rect.y, page.width, page.height);
  options.signal?.throwIfAborted();
  if (!page.repeatHeader) return canvas;
  const headRect = page.repeatHeader.element.getBoundingClientRect();
  const head = await capture(page.repeatHeader.element, page.x - headRect.x, 0, page.width, headerHeight);
  const merged = document.createElement('canvas'); merged.width = canvas.width; merged.height = canvas.height + head.height;
  const ctx = merged.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, merged.width, merged.height);
  ctx.drawImage(head, 0, 0); ctx.drawImage(canvas, 0, head.height); canvas.width = canvas.height = head.width = head.height = 0;
  return merged;
}

export async function renderRaster(pdf: PdfWriter, page: PageSlice, options: NormalizedOptions) {
  const canvas = await capturePage(page, options);
  const width = (options.size[0] - options.margin.left - options.margin.right) * PT_PER_MM;
  const height = width * (page.height + (page.repeatHeader?.height ?? 0)) / page.width;
  const type = options.imageType ?? 'png';
  try {
    await pdf.addImage(type === 'jpeg' ? canvas.toDataURL('image/jpeg', options.imageQuality ?? .95) : canvas, options.margin.left * PT_PER_MM, options.margin.top * PT_PER_MM, width, height);
  } finally { canvas.width = canvas.height = 0; }
}
