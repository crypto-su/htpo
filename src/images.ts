import { base64Bytes } from './pdf/binary';
import { jpegInfo, jpegWithoutRenderingMetadata } from './pdf/jpeg';

interface Rect { x: number; y: number; width: number; height: number }
export interface ImagePlacement extends Rect { box: Rect }
export interface ImageResizePlan {
  visible: Rect;
  /** Source rectangle as fractions of the embedded image, independent of EXIF. */
  crop: Rect;
  pixelWidth: number;
  pixelHeight: number;
}

/** Resources are inlined as data URLs before painting. Sniff a bounded prefix so
 * extensionless URLs and incorrect server MIME labels still use the real format.
 */
export function imageExtension(src: string): string | undefined {
  const comma = src.indexOf(',');
  if (!/^data:/i.test(src) || comma < 0) return;
  const header = src.slice(0, comma);
  let head = '';
  try {
    head = /;base64$/i.test(header) ? atob(src.slice(comma + 1, comma + 65))
      : src.slice(comma + 1, comma + 193).replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  } catch { /* Unknown encoding: fall back to the declared MIME. */ }
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
  if (head.startsWith('\xff\xd8\xff')) return 'jpeg';
  if (/^GIF8[79]a/.test(head)) return 'gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if (head.startsWith('BM')) return 'bmp';
  if (head.startsWith('II\x2a\0') || head.startsWith('MM\0\x2a')) return 'tiff';
  if (head.startsWith('\0\0\x01\0')) return 'ico';
  if (head.slice(4, 8) === 'ftyp' && /avif|avis/.test(head.slice(8))) return 'avif';
  const mime = header.match(/^data:image\/([^;]+)/i)?.[1].toLowerCase();
  if (!mime) return;
  const aliases: Record<string, string> = { jpg: 'jpeg', pjpeg: 'jpeg', 'x-png': 'png', 'svg+xml': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico', 'x-ms-bmp': 'bmp', tif: 'tiff' };
  return aliases[mime] ?? mime;
}

export function imageResizePlan(placement: ImagePlacement, width: number, height: number, pdfPointsPerCssPixel: number, dpi = 96): ImageResizePlan | undefined {
  const { box } = placement;
  const x = Math.max(box.x, placement.x), y = Math.max(box.y, placement.y);
  const right = Math.min(box.x + box.width, placement.x + placement.width);
  const bottom = Math.min(box.y + box.height, placement.y + placement.height);
  if (right <= x || bottom <= y || width <= 0 || height <= 0) return;
  const visible = { x, y, width: right - x, height: bottom - y };
  const crop = { x: (x - placement.x) / placement.width, y: (y - placement.y) / placement.height,
    width: visible.width / placement.width, height: visible.height / placement.height };
  // Resolve DPI against the final physical PDF size, independent of devicePixelRatio.
  const density = pdfPointsPerCssPixel * dpi / 72;
  const pixels = (display: number, source: number) => Math.max(1, Math.ceil(Math.min(display * density, source) - 1e-7));
  return { visible, crop, pixelWidth: pixels(visible.width, width * crop.width), pixelHeight: pixels(visible.height, height * crop.height) };
}

export function resizeKey(plan: ImageResizePlan): string {
  // Ignore absolute page position and floating-point noise in repeated placements.
  return [plan.pixelWidth, plan.pixelHeight, ...Object.values(plan.crop).map(v => v.toFixed(7))].join(':');
}

/** Canvas is limited to the output dimensions; no full-size canvas is allocated. */
export async function resizedImage(img: HTMLImageElement, plan: ImageResizePlan, maxCanvasPixels: number, jpegQuality: number, lossless: boolean, signal?: AbortSignal): Promise<{ source: HTMLCanvasElement | string; dispose(): void }> {
  signal?.throwIfAborted();
  if (plan.pixelWidth * plan.pixelHeight > maxCanvasPixels) throw new RangeError('Resized image exceeds maxCanvasPixels.');
  const canvas = img.ownerDocument.createElement('canvas');
  canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
  const context = canvas.getContext('2d')!;
  let decoded: HTMLImageElement | undefined, objectUrl: string | undefined;
  try {
    const src = img.currentSrc || img.src;
    const encoded = /^data:[^,]*;base64,/i.test(src) ? src.slice(src.indexOf(',') + 1) : '';
    const isJpeg = encoded.startsWith('/9j/'); // Use actual bytes, including mislabeled images.
    let source = img;
    if (isJpeg) {
      const bytes = base64Bytes(encoded);
      if (jpegInfo(bytes).components !== 4) {
        const stripped = jpegWithoutRenderingMetadata(bytes);
        if (stripped !== bytes) {
          objectUrl = URL.createObjectURL(new Blob([stripped as BlobPart], { type: 'image/jpeg' }));
          decoded = img.ownerDocument.createElement('img'); decoded.src = objectUrl;
          await decoded.decode(); signal?.throwIfAborted(); source = decoded;
        }
      }
    }
    const { crop } = plan;
    // EXIF can swap the browser's intrinsic dimensions. Never upscale the stored
    // pixels even when those dimensions differ from naturalWidth/naturalHeight.
    canvas.width = Math.min(canvas.width, Math.max(1, Math.ceil(crop.width * source.naturalWidth - 1e-7)));
    canvas.height = Math.min(canvas.height, Math.max(1, Math.ceil(crop.height * source.naturalHeight - 1e-7)));
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(source, crop.x * source.naturalWidth, crop.y * source.naturalHeight,
      crop.width * source.naturalWidth, crop.height * source.naturalHeight, 0, 0, canvas.width, canvas.height);
    signal?.throwIfAborted();
    // Passing the canvas writes RGB/alpha with lossless Deflate in the PDF writer.
    return { source: isJpeg && !lossless ? canvas.toDataURL('image/jpeg', jpegQuality) : canvas,
      dispose: () => { canvas.width = canvas.height = 0; } };
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
  finally { if (decoded) decoded.src = ''; if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
