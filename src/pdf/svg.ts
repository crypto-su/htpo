import type { PdfWriter } from './writer';
import { svgCanvas } from '../snapshot';
import type { NormalizedOptions } from '../types';

type Segment = { op: 'moveTo' | 'lineTo' | 'curveTo' | 'closePath'; args: number[] };
const numeric = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;

/** SVG endpoint arcs become at most four cubic Bézier segments. */
function arc(x: number, y: number, rx: number, ry: number, angle: number, large: number, sweep: number, ex: number, ey: number): Segment[] {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (x === ex && y === ey) return [];
  if (!rx || !ry) return [{ op: 'lineTo', args: [ex, ey] }];
  const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const xp = cos * (x - ex) / 2 + sin * (y - ey) / 2, yp = -sin * (x - ex) / 2 + cos * (y - ey) / 2;
  const radiusScale = Math.sqrt(xp * xp / (rx * rx) + yp * yp / (ry * ry));
  if (radiusScale > 1) { rx *= radiusScale; ry *= radiusScale; }
  const coefficient = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = coefficient * rx * yp / ry, cyp = -coefficient * ry * xp / rx;
  const cx = cos * cxp - sin * cyp + (x + ex) / 2, cy = sin * cxp + cos * cyp + (y + ey) / 2;
  const start = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const point = (a: number) => [cx + rx * cos * Math.cos(a) - ry * sin * Math.sin(a), cy + rx * sin * Math.cos(a) + ry * cos * Math.sin(a)];
  const tangent = (a: number) => [-rx * cos * Math.sin(a) - ry * sin * Math.cos(a), -rx * sin * Math.sin(a) + ry * cos * Math.cos(a)];
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const a = start + delta * i / count, b = start + delta * (i + 1) / count, k = 4 / 3 * Math.tan((b - a) / 4);
    const p = point(a), q = point(b), t = tangent(a), u = tangent(b);
    segments.push({ op: 'curveTo', args: [p[0] + k * t[0], p[1] + k * t[1], q[0] - k * u[0], q[1] - k * u[1], ...q] });
  }
  return segments;
}

export function svgPath(data: string): Segment[] {
  const result: Segment[] = []; let pos = 0, command = '', previous = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0;
  const skip = () => { while (/[\s,]/.test(data[pos] ?? '') && pos < data.length) pos++; };
  const number = (flag = false): number => {
    skip();
    if (flag) { const value = data[pos++]; if (value !== '0' && value !== '1') throw new Error('Invalid SVG arc flag.'); return Number(value); }
    numeric.lastIndex = pos; const match = numeric.exec(data); if (!match) throw new Error('Invalid SVG path number.');
    pos = numeric.lastIndex; const value = Number(match[0]); if (!Number.isFinite(value)) throw new Error('Invalid SVG path coordinate.'); return value;
  };
  while (pos < data.length) {
    skip(); if (pos === data.length) break;
    if (/[a-zA-Z]/.test(data[pos])) command = data[pos++];
    const op = command.toUpperCase(), relative = command !== op, dx = relative ? x : 0, dy = relative ? y : 0;
    if (!result.length && op !== 'M') throw new Error('SVG paths must start with moveto.');
    let args: number[];
    switch (op) {
      case 'M': case 'L':
        x = number() + dx; y = number() + dy; result.push({ op: op === 'M' ? 'moveTo' : 'lineTo', args: [x, y] });
        if (op === 'M') { sx = x; sy = y; command = relative ? 'l' : 'L'; } break;
      case 'H': x = number() + dx; result.push({ op: 'lineTo', args: [x, y] }); break;
      case 'V': y = number() + dy; result.push({ op: 'lineTo', args: [x, y] }); break;
      case 'C': case 'S': {
        const c1 = op === 'C' ? [number() + dx, number() + dy] : ['C', 'S'].includes(previous) ? [2 * x - cx, 2 * y - cy] : [x, y];
        cx = number() + dx; cy = number() + dy; x = number() + dx; y = number() + dy;
        result.push({ op: 'curveTo', args: [...c1, cx, cy, x, y] }); break;
      }
      case 'Q': case 'T': {
        const qx = op === 'Q' ? number() + dx : ['Q', 'T'].includes(previous) ? 2 * x - cx : x;
        const qy = op === 'Q' ? number() + dy : ['Q', 'T'].includes(previous) ? 2 * y - cy : y;
        const ex = number() + dx, ey = number() + dy;
        args = [x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey];
        result.push({ op: 'curveTo', args }); cx = qx; cy = qy; x = ex; y = ey; break;
      }
      case 'A': {
        const rx = number(), ry = number(), rotation = number(), large = number(true), sweep = number(true), ex = number() + dx, ey = number() + dy;
        result.push(...arc(x, y, rx, ry, rotation, large, sweep, ex, ey)); x = ex; y = ey; break;
      }
      case 'Z': result.push({ op: 'closePath', args: [] }); x = sx; y = sy; command = ''; break;
      default: throw new Error(`Unsupported SVG path command: ${command}`);
    }
    previous = op;
  }
  return result;
}

function color(value: string): number[] | undefined {
  if (value === 'none') return undefined;
  const m = value.match(/^rgba?\(([^)]+)\)$/);
  if (!m) throw new Error(`Unsupported SVG paint: ${value}`);
  return m[1].split(/[,\s/]+/).map(Number);
}

/** Basic SVG geometry stays vector. Unsupported SVG features use the browser painter as a whole. */
export async function renderSvg(pdf: PdfWriter, svg: SVGSVGElement, box: { x: number; y: number; width: number; height: number }, options: NormalizedOptions, opacity: number, warning: () => void): Promise<void> {
  const shapes: { el: SVGGraphicsElement; style: CSSStyleDeclaration; opacity: number; path?: Segment[] }[] = [];
  const win = svg.ownerDocument.defaultView!;
  const inspect = (el: Element, inherited: number) => {
    const tag = el.localName, style = win.getComputedStyle(el);
    if (style.display === 'none') return;
    if (['defs', 'title', 'desc', 'metadata', 'style'].includes(tag)) return;
    for (const prop of ['filter', 'mask-image', 'clip-path', 'marker-start', 'marker-mid', 'marker-end']) if (!['', 'none'].includes(style.getPropertyValue(prop))) throw new Error(`SVG ${prop}`);
    if (style.mixBlendMode !== 'normal' || !['normal', 'fill stroke', ''].includes(style.paintOrder)) throw new Error('SVG compositing');
    const alpha = inherited * Number(style.opacity || 1);
    if (tag === 'g' || el === svg) {
      // Group compositing is not equivalent to applying opacity separately to overlapping children.
      if (Number(style.opacity) !== 1) throw new Error('SVG group opacity');
      for (const child of el.children) inspect(child, alpha); return;
    }
    if (!['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon'].includes(tag)) throw new Error(`SVG ${tag}`);
    if (style.visibility === 'hidden') return;
    if (style.vectorEffect !== 'none') throw new Error('SVG vector-effect');
    color(style.fill); color(style.stroke);
    shapes.push({ el: el as SVGGraphicsElement, style, opacity: alpha, path: tag === 'path' ? svgPath(el.getAttribute('d') ?? '') : undefined });
  };
  let fallback = false;
  try { inspect(svg, 1); } catch { fallback = true; }
  if (fallback) {
    warning();
    const scale = options.scale;
    const rect = svg.getBoundingClientRect(), clone = svg.cloneNode(true) as SVGSVGElement;
    const sources = [svg, ...svg.querySelectorAll('*')], targets = [clone, ...clone.querySelectorAll('*')];
    sources.forEach((source, i) => {
      const style = win.getComputedStyle(source);
      targets[i].setAttribute('style', Array.from(style).map(p => {
        const value = style.getPropertyValue(p).replace(/url\(["']?([^"')]+)["']?\)/g, (full, url: string) => {
          const hash = url.indexOf('#');
          return hash >= 0 && (url.startsWith('#') || url.slice(0, hash) === svg.ownerDocument.URL) ? `url("${url.slice(hash)}")` : full;
        });
        return `${p}:${value}`;
      }).join(';'));
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(rect.width)); clone.setAttribute('height', String(rect.height));
    clone.style.width = `${rect.width}px`; clone.style.height = `${rect.height}px`; clone.style.transform = 'none';
    clone.style.position = 'static'; clone.style.left = clone.style.top = '0'; clone.style.margin = '0';
    const fontStyle = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
    fontStyle.textContent = Array.from(svg.ownerDocument.styleSheets).flatMap(sheet => Array.from(sheet.cssRules).filter(rule => rule.type === CSSRule.FONT_FACE_RULE).map(rule => rule.cssText)).join('\n');
    clone.prepend(fontStyle);
    if (Math.ceil(rect.width * scale) * Math.ceil(rect.height * scale) > options.maxCanvasPixels) throw new RangeError('SVG fallback exceeds maxCanvasPixels.');
    const canvas = await svgCanvas(new XMLSerializer().serializeToString(clone), rect.width, rect.height, scale, options.timeout, options.signal);
    pdf.saveGraphicsState(); pdf.setOpacity(opacity); await pdf.addImage(canvas, box.x, box.y, box.width, box.height); pdf.restoreGraphicsState(); canvas.width = canvas.height = 0;
    return;
  }
  const rect = svg.getBoundingClientRect(), fx = box.width / rect.width, fy = box.height / rect.height;
  pdf.saveGraphicsState();
  if (win.getComputedStyle(svg).overflow !== 'visible') { pdf.rect(box.x, box.y, box.width, box.height, null); pdf.clip(); pdf.discardPath(); }
  for (const { el, style, opacity: alpha, path } of shapes) {
    const matrix = el.getScreenCTM(); if (!matrix) continue;
    const fill = color(style.fill), stroke = color(style.stroke);
    if (!fill && !stroke) continue;
    pdf.saveGraphicsState(); pdf.transform([matrix.a * fx, matrix.b * fy, matrix.c * fx, matrix.d * fy, box.x + (matrix.e - rect.x) * fx, box.y + (matrix.f - rect.y) * fy]);
    pdf.setOpacity(opacity * alpha * Number(style.fillOpacity) * (fill?.[3] ?? 1), opacity * alpha * Number(style.strokeOpacity) * (stroke?.[3] ?? 1));
    if (fill) pdf.setFillColor(fill[0], fill[1], fill[2]);
    if (stroke) {
      pdf.setDrawColor(stroke[0], stroke[1], stroke[2]); pdf.setLineWidth(parseFloat(style.strokeWidth));
      pdf.command(`${['butt', 'round', 'square'].indexOf(style.strokeLinecap)} J ${['miter', 'round', 'bevel'].indexOf(style.strokeLinejoin)} j ${parseFloat(style.strokeMiterlimit)} M`);
      pdf.setLineDashPattern(style.strokeDasharray === 'none' ? [] : style.strokeDasharray.split(/[, ]+/).map(parseFloat), parseFloat(style.strokeDashoffset));
    }
    const v = (name: string) => (el as unknown as Record<string, SVGAnimatedLength>)[name].baseVal.value;
    switch (el.localName) {
      case 'rect': {
        const rx = el.hasAttribute('rx') ? v('rx') : v('ry'), ry = el.hasAttribute('ry') ? v('ry') : rx;
        if (rx || ry) pdf.roundedRect(v('x'), v('y'), v('width'), v('height'), rx, ry, null); else pdf.rect(v('x'), v('y'), v('width'), v('height'), null); break;
      }
      case 'circle': case 'ellipse': {
        const x = v('cx'), y = v('cy'), rx = v(el.localName === 'circle' ? 'r' : 'rx'), ry = el.localName === 'circle' ? rx : v('ry'), k = .5522847498307936;
        pdf.moveTo(x + rx, y); pdf.curveTo(x + rx, y + ry * k, x + rx * k, y + ry, x, y + ry);
        pdf.curveTo(x - rx * k, y + ry, x - rx, y + ry * k, x - rx, y); pdf.curveTo(x - rx, y - ry * k, x - rx * k, y - ry, x, y - ry);
        pdf.curveTo(x + rx * k, y - ry, x + rx, y - ry * k, x + rx, y); pdf.closePath(); break;
      }
      case 'line': pdf.moveTo(v('x1'), v('y1')); pdf.lineTo(v('x2'), v('y2')); break;
      case 'polyline': case 'polygon': {
        const points = (el as SVGPolylineElement).points;
        for (let i = 0; i < points.numberOfItems; i++) { const p = points.getItem(i); if (i) pdf.lineTo(p.x, p.y); else pdf.moveTo(p.x, p.y); }
        if (el.localName === 'polygon' && points.numberOfItems) pdf.closePath(); break;
      }
      case 'path': for (const segment of path!) {
        const a = segment.args;
        if (segment.op === 'moveTo') pdf.moveTo(a[0], a[1]); else if (segment.op === 'lineTo') pdf.lineTo(a[0], a[1]);
        else if (segment.op === 'curveTo') pdf.curveTo(a[0], a[1], a[2], a[3], a[4], a[5]); else pdf.closePath();
      } break;
    }
    pdf.paint(fill ? stroke ? 'DF' : 'F' : 'S', style.fillRule === 'evenodd'); pdf.restoreGraphicsState();
  }
  pdf.restoreGraphicsState();
}
