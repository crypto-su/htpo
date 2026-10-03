import type { PdfWriter } from './pdf/writer';
import { renderSvg } from './pdf/svg';
import { findFont, type LoadedFont } from './fonts';
import type { Diagnostic, NormalizedOptions, PageSlice } from './types';
import { PT_PER_MM } from './options';
import { svgCanvas } from './snapshot';
import { imageExtension, imageResizePlan, resizedImage, resizeKey } from './images';

interface PaintContext {
  pdf: PdfWriter;
  doc: Document;
  fonts: LoadedFont[];
  diagnostics: Diagnostic[];
  options: NormalizedOptions;
  page: PageSlice;
  factor: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
  measure: CanvasRenderingContext2D;
  imageIds: Map<string, string>;
  warnings: Set<string>;
  textOnly?: boolean;
}

const number = (value: string) => parseFloat(value) || 0;
function rgba(value: string): [number, number, number, number] {
  if (value === 'transparent') return [0, 0, 0, 0];
  const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
}
const px = (c: PaintContext, x: number) => c.offsetX + (x - c.originX) * c.factor;
const py = (c: PaintContext, y: number) => c.offsetY + (y - c.originY) * c.factor;

function warn(c: PaintContext, code: string, message: string) {
  if (c.warnings.has(code)) return;
  c.warnings.add(code);
  c.diagnostics.push({ code, message, severity: 'warning', page: c.page.info.number });
}

function clip(c: PaintContext, rect: { x: number; y: number; width: number; height: number }) {
  c.pdf.rect(px(c, rect.x), py(c, rect.y), rect.width * c.factor, rect.height * c.factor, null);
  c.pdf.clip(); c.pdf.discardPath();
}

function paintBox(el: Element, style: CSSStyleDeclaration, r: DOMRect, c: PaintContext, opacity: number) {
  const { pdf, factor } = c;
  const bg = rgba(style.backgroundColor);
  const radius = Math.min(number(style.borderTopLeftRadius), r.width / 2, r.height / 2) * factor;
  if (bg[3] > 0 && style.backgroundImage === 'none' && style.boxShadow === 'none') {
    pdf.saveGraphicsState(); pdf.setOpacity(opacity * bg[3]);
    pdf.setFillColor(bg[0], bg[1], bg[2]);
    if (radius > 0) pdf.roundedRect(px(c, r.x), py(c, r.y), r.width * factor, r.height * factor, radius, radius, 'F');
    else pdf.rect(px(c, r.x), py(c, r.y), r.width * factor, r.height * factor, 'F');
    pdf.restoreGraphicsState();
  }
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const s = style as unknown as Record<string, string>;
    const width = number(s[`border${side}Width`]);
    const color = rgba(s[`border${side}Color`]);
    const kind = s[`border${side}Style`];
    if (!width || color[3] === 0 || ['none', 'hidden'].includes(kind)) continue;
    pdf.saveGraphicsState(); pdf.setOpacity(opacity * color[3]);
    pdf.setDrawColor(color[0], color[1], color[2]); pdf.setLineWidth(width * factor);
    if (kind === 'dashed' || kind === 'dotted') pdf.setLineDashPattern([width * factor * (kind === 'dashed' ? 3 : 1)], 0);
    const x1 = side === 'Right' ? r.right - width / 2 : r.left + (side === 'Left' ? width / 2 : 0);
    const y1 = side === 'Bottom' ? r.bottom - width / 2 : r.top + (side === 'Top' ? width / 2 : 0);
    const x2 = ['Top', 'Bottom'].includes(side) ? r.right : x1;
    const y2 = ['Left', 'Right'].includes(side) ? r.bottom : y1;
    pdf.line(px(c, x1), py(c, y1), px(c, x2), py(c, y2)); pdf.restoreGraphicsState();
  }
  if (style.filter !== 'none' || style.mixBlendMode !== 'normal') warn(c, 'VECTOR_EFFECT', 'CSS filters and blend modes are not supported in vector mode.');
  if (style.display === 'list-item' && style.listStyleType !== 'none') warn(c, 'LIST_MARKER', 'Automatic list markers are not painted in vector mode yet. Use explicit text markers or raster mode.');
  if (style.transform !== 'none') {
    const matrix = new DOMMatrix(style.transform);
    if (Math.abs(matrix.b) > .001 || Math.abs(matrix.c) > .001) warn(c, 'VECTOR_TRANSFORM', 'Rotated or skewed HTML uses its bounding box in vector mode.');
  }
  if (style.position === 'fixed' && c.page.info.kind === 'flow') warn(c, 'FIXED_FLOW', 'Fixed elements are not automatically repeated in flow mode. Use header/footer options.');
}

async function paintDecoration(style: CSSStyleDeclaration, r: DOMRect, c: PaintContext) {
  if (style.backgroundImage === 'none' && style.boxShadow === 'none') return;
  // Only the background decoration is a bitmap; text and borders remain PDF objects.
  const padding = style.boxShadow === 'none' ? 0 : Math.max(24, ...Array.from(style.boxShadow.matchAll(/(-?[\d.]+)px/g), m => Math.abs(Number(m[1])) * 3));
  const width = r.width + 2 * padding, height = r.height + 2 * padding;
  if (width * height * 4 > c.options.maxCanvasPixels) {
    warn(c, 'DECORATION_TOO_LARGE', 'A background decoration exceeded the pixel budget and was omitted.'); return;
  }
  const div = c.doc.createElement('div'); div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.style.cssText = `position:absolute;left:${padding}px;top:${padding}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;`;
  for (const property of ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin', 'background-clip', 'border-radius', 'box-shadow']) div.style.setProperty(property, style.getPropertyValue(property));
  const markup = new XMLSerializer().serializeToString(div);
  const key = `decoration:${width}:${height}:${markup}`;
  let alias = c.imageIds.get(key);
  if (alias) { await c.pdf.addImage(c.imageIds.get(`decoration-data:${alias}`)!, px(c, r.x - padding), py(c, r.y - padding), width * c.factor, height * c.factor, alias); return; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const canvas = await svgCanvas(svg, width, height, 2, c.options.timeout, c.options.signal);
  alias = `image-${c.imageIds.size}`; c.imageIds.set(key, alias);
  const data = canvas.toDataURL('image/png'); c.imageIds.set(`decoration-data:${alias}`, data);
  await c.pdf.addImage(canvas, px(c, r.x - padding), py(c, r.y - padding), width * c.factor, height * c.factor, alias);
  canvas.width = canvas.height = 0;
}

function drawText(text: string, r: DOMRect | { x: number; y: number; width: number; height: number }, style: CSSStyleDeclaration, c: PaintContext, opacity: number) {
  if (!text.trim() || !r.width || !r.height) return;
  const { pdf, factor, measure } = c;
  const font = findFont(style.fontFamily, style.fontWeight, style.fontStyle, c.fonts);
  const declared = style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (!c.fonts.some(f => [f.family, ...f.aliases].includes(declared))) warn(c, 'FONT_SUBSTITUTED', `Some CSS fonts are not embedded; Htpo Sans is used in the PDF. Supply TTF fonts and aliases to match layout.`);
  const fontSize = number(style.fontSize);
  const color = rgba(style.color);
  measure.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  const metrics = measure.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize * .8;
  const descent = metrics.fontBoundingBoxDescent ?? fontSize * .2;
  const baseline = r.y + (r.height - ascent - descent) / 2 + ascent;
  let value = text;
  if (style.textTransform === 'uppercase') value = value.toLocaleUpperCase(c.doc.documentElement.lang || undefined);
  if (style.textTransform === 'lowercase') value = value.toLocaleLowerCase(c.doc.documentElement.lang || undefined);
  pdf.saveGraphicsState(); pdf.setOpacity(color[3] * opacity);
  pdf.setFont(font.id); pdf.setFontSize(fontSize * factor); pdf.setTextColor(color[0], color[1], color[2]);
  const width = pdf.getTextWidth(value);
  pdf.text(value, px(c, r.x), py(c, baseline), { baseline: 'alphabetic', horizontalScale: width ? r.width * factor / width : 1 });
  if (style.textDecorationLine.includes('underline') || style.textDecorationLine.includes('line-through')) {
    const y = style.textDecorationLine.includes('line-through') ? baseline - fontSize * .3 : baseline + fontSize * .1;
    pdf.setDrawColor(color[0], color[1], color[2]); pdf.setLineWidth(Math.max(.3, fontSize * factor / 18));
    pdf.line(px(c, r.x), py(c, y), px(c, r.x + r.width), py(c, y));
  }
  pdf.restoreGraphicsState();
}

function paintTextNode(node: Text, style: CSSStyleDeclaration, c: PaintContext, opacity: number) {
  const value = node.data;
  if (!value.trim()) return;
  const range = c.doc.createRange();
  const runs: { text: string; rect: DOMRect }[] = [];
  const preserve = ['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace);
  for (let offset = 0; offset < value.length;) {
    const char = String.fromCodePoint(value.codePointAt(offset)!);
    range.setStart(node, offset); range.setEnd(node, offset + char.length); offset += char.length;
    const r = range.getBoundingClientRect();
    if (r.width < .001 || r.height < .001) continue;
    const text = preserve ? char : /\s/.test(char) ? ' ' : char;
    const last = runs.at(-1);
    if (last && Math.abs(last.rect.y - r.y) < .5 && Math.abs(last.rect.right - r.left) < 1 && style.direction !== 'rtl') {
      last.text += text;
      last.rect = new DOMRect(last.rect.x, last.rect.y, r.right - last.rect.x, Math.max(last.rect.height, r.height));
    } else runs.push({ text, rect: r });
  }
  for (const run of runs) drawText(run.text, run.rect, style, c, opacity);
}

function imagePlacement(img: HTMLImageElement, style: CSSStyleDeclaration, r: DOMRect) {
  const left = number(style.borderLeftWidth) + number(style.paddingLeft), top = number(style.borderTopWidth) + number(style.paddingTop);
  const box = new DOMRect(r.x + left, r.y + top, r.width - left - number(style.borderRightWidth) - number(style.paddingRight), r.height - top - number(style.borderBottomWidth) - number(style.paddingBottom));
  let width = box.width, height = box.height;
  if (style.objectFit !== 'fill') {
    const contain = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const ratio = style.objectFit === 'cover' ? Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight) : style.objectFit === 'none' ? 1 : style.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
    width = img.naturalWidth * ratio; height = img.naturalHeight * ratio;
  }
  const pos = style.objectPosition.split(' ');
  const position = (value: string | undefined, free: number) => value?.endsWith('%') ? number(value) * free / 100 : value ? number(value) : free / 2;
  return { box, x: box.x + position(pos[0], box.width - width), y: box.y + position(pos[1], box.height - height), width, height };
}

async function paintImage(img: HTMLImageElement, style: CSSStyleDeclaration, r: DOMRect, c: PaintContext) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  const placement = imagePlacement(img, style, r);
  if (placement.width <= 0 || placement.height <= 0) return;
  const src = img.currentSrc || img.src;
  let alias = c.imageIds.get(src);
  if (!alias) { alias = `image-${c.imageIds.size}`; c.imageIds.set(src, alias); }
  if (c.options.resizeImages && (!c.options.resizeIgnoreExt.length || !c.options.resizeIgnoreExt.includes(imageExtension(src) ?? ''))) {
    const plan = imageResizePlan(placement, img.naturalWidth, img.naturalHeight, c.factor, c.options.resizeDpi);
    if (!plan) return;
    const cropped = plan.crop.width < 1 - 1e-7 || plan.crop.height < 1 - 1e-7;
    if (cropped || plan.pixelWidth < img.naturalWidth || plan.pixelHeight < img.naturalHeight) {
      const key = `resized:${alias}:${resizeKey(plan)}`;
      let resizedAlias = c.imageIds.get(key);
      const { visible } = plan;
      const x = px(c, visible.x), y = py(c, visible.y), width = visible.width * c.factor, height = visible.height * c.factor;
      if (resizedAlias) {
        // addImage reuses the existing object; it does not read img again for this alias.
        await c.pdf.addImage(img, x, y, width, height, resizedAlias); return;
      }
      resizedAlias = `image-${c.imageIds.size}`;
      const resized = await resizedImage(img, plan, c.options.maxCanvasPixels, c.options.imageQuality ?? .95, c.options.resizeLossless, c.options.signal);
      try { await c.pdf.addImage(resized.source, x, y, width, height, resizedAlias); }
      finally { resized.dispose(); }
      c.imageIds.set(key, resizedAlias);
      return;
    }
  }
  c.pdf.saveGraphicsState(); clip(c, placement.box);
  await c.pdf.addImage(img, px(c, placement.x), py(c, placement.y), placement.width * c.factor, placement.height * c.factor, alias);
  c.pdf.restoreGraphicsState();
}

async function paintElement(el: Element, c: PaintContext, inheritedOpacity = 1): Promise<void> {
  const style = c.doc.defaultView!.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
  const r = el.getBoundingClientRect();
  // Ancestors may lie outside the slice while an absolute child still intersects it.
  const intersects = r.bottom > c.originY - 1 && r.top < c.originY + c.page.height + 1;
  const opacity = inheritedOpacity * (parseFloat(style.opacity) || 1);
  c.pdf.saveGraphicsState(); c.pdf.setOpacity(opacity);
  if (intersects && r.width > 0 && r.height > 0) {
    await paintDecoration(style, r, c);
    paintBox(el, style, r, c, opacity);
    if (el.tagName === 'IMG') await paintImage(el as HTMLImageElement, style, r, c);
    if (el.tagName.toLowerCase() === 'svg') {
      await renderSvg(c.pdf, el as SVGSVGElement, { x: px(c, r.x), y: py(c, r.y), width: r.width * c.factor, height: r.height * c.factor }, c.options, inheritedOpacity,
        () => warn(c, 'SVG_RASTERIZED', 'An SVG with features outside the supported geometry subset was rendered as an image. Its text is not selectable.'));
      c.pdf.restoreGraphicsState(); return;
    }
    if (el.tagName === 'A') {
      const href = (el as HTMLAnchorElement).getAttribute('href');
      if (href && /^(https?:|mailto:|tel:)/i.test(href)) c.pdf.link(px(c, r.x), py(c, r.y), r.width * c.factor, r.height * c.factor, { url: href });
    }
  }
  if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflow)) clip(c, r);
  const children = Array.from(el.children);
  // Common report stacking: normal flow first, positioned children in z-index order.
  const z = (child: Element) => { const cs = c.doc.defaultView!.getComputedStyle(child); return cs.position === 'static' ? 0 : parseInt(cs.zIndex) || 0; };
  const negative = children.filter(e => z(e) < 0).sort((a, b) => z(a) - z(b));
  for (const child of negative) await paintElement(child, c, opacity);
  if (intersects) {
    for (const pseudo of ['::before', '::after']) {
      const ps = c.doc.defaultView!.getComputedStyle(el, pseudo);
      if (ps.content && !['none', 'normal', '""', "''"].includes(ps.content) && ps.display !== 'none') {
        if (!/^["']/.test(ps.content)) { warn(c, 'GENERATED_CONTENT', 'Non-text generated CSS content is not supported in vector mode.'); continue; }
        const content = ps.content.replace(/^["']|["']$/g, '');
        drawText(content, r, ps, c, opacity);
      }
    }
  }
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && intersects) paintTextNode(node as Text, style, c, opacity);
    else if (node.nodeType === 1 && z(node as Element) === 0) await paintElement(node as Element, c, opacity);
  }
  for (const child of children.filter(e => z(e) > 0).sort((a, b) => z(a) - z(b))) await paintElement(child, c, opacity);
  c.pdf.restoreGraphicsState();
}

export async function renderVector(pdf: PdfWriter, page: PageSlice, options: NormalizedOptions, fonts: LoadedFont[], diagnostics: Diagnostic[], imageIds: Map<string, string>, warnings: Set<string>) {
  const doc = page.element.ownerDocument;
  const factor = (options.size[0] - options.margin.left - options.margin.right) * PT_PER_MM / page.width;
  const context: PaintContext = { pdf, doc, page, options, fonts, diagnostics, factor, originX: page.x, originY: page.y,
    offsetX: options.margin.left * PT_PER_MM, offsetY: options.margin.top * PT_PER_MM + (page.repeatHeader?.height ?? 0) * factor,
    measure: doc.createElement('canvas').getContext('2d')!, imageIds, warnings,
  };
  pdf.saveGraphicsState();
  clip(context, { x: page.x, y: page.y, width: page.width, height: page.height });
  await paintElement(page.element, context);
  pdf.restoreGraphicsState();
  if (page.repeatHeader) {
    const rect = page.repeatHeader.element.getBoundingClientRect();
    const header = { ...context, originY: rect.y, offsetY: options.margin.top * PT_PER_MM };
    pdf.saveGraphicsState(); clip(header, rect); await paintElement(page.repeatHeader.element, header); pdf.restoreGraphicsState();
  }
}
