import { PX_PER_MM } from './options';
import type { Diagnostic, NormalizedOptions, PageSlice } from './types';

export interface Interval { top: number; bottom: number }

/** Move a cut backwards until it no longer intersects a protected line/row/block. */
export function safeCut(start: number, limit: number, protectedRanges: Interval[], forced: number[], end: number): number {
  const next = forced.find(y => y > start + .5 && y <= limit + .5);
  let cut = Math.min(next ?? limit, end);
  if (next !== undefined || cut >= end) return cut;
  for (let attempt = 0; attempt <= protectedRanges.length; attempt++) {
    const collisions = protectedRanges.filter(r => r.top < cut - .5 && r.bottom > cut + .5 && r.bottom - r.top <= limit - start + .5 && r.top > start + .5);
    if (!collisions.length) break;
    cut = Math.min(...collisions.map(r => r.top));
  }
  return cut > start + .5 ? cut : Math.min(limit, end);
}

export function paginate(doc: Document, options: NormalizedOptions, diagnostics: Diagnostic[]): PageSlice[] {
  const win = doc.defaultView!;
  const all = Array.from(doc.body.querySelectorAll<HTMLElement>('*'));
  let explicit: HTMLElement[] = [];
  if (options.pagination !== 'flow') {
    explicit = options.pageSelector ? Array.from(doc.querySelectorAll<HTMLElement>(options.pageSelector)) : all.filter(el => {
      const style = win.getComputedStyle(el);
      return el.hasAttribute('data-htpo-page') || (['page', 'always'].includes(style.breakAfter) && el.getBoundingClientRect().height > 100 && style.position === 'relative');
    });
    explicit = explicit.filter(el => !explicit.some(parent => parent !== el && parent.contains(el)));
  }
  if ((options.pageSelector || options.pagination === 'explicit') && !explicit.length) throw new Error('No page elements matched. Check pageSelector or use flow pagination.');
  const result: PageSlice[] = [];
  const add = (element: HTMLElement, x: number, y: number, width: number, height: number, kind: 'explicit' | 'flow', repeatHeader?: PageSlice['repeatHeader']) => {
    if (result.length >= options.maxPages) throw new Error(`Document exceeds maxPages (${options.maxPages}).`);
    result.push({ element, x, y, width, height, repeatHeader, info: { number: result.length + 1, width: options.size[0], height: options.size[1], sourceTop: y, sourceHeight: height, kind } });
  };
  if (explicit.length) {
    for (const element of explicit) {
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const contentRatio = (options.size[1] - options.margin.top - options.margin.bottom) / (options.size[0] - options.margin.left - options.margin.right);
      if (r.height > r.width * contentRatio + 2 || element.scrollHeight > r.height + 2 || element.scrollWidth > r.width + 2) {
        diagnostics.push({ code: 'PAGE_OVERFLOW', severity: 'warning', page: result.length + 1, message: 'Explicit page content exceeds its page box; overflowing content is clipped. Increase the page size or use flow pagination.' });
      }
      add(element, r.x, r.y, r.width, Math.min(r.height, r.width * contentRatio), 'explicit');
    }
    if (!result.length) throw new Error('All page elements are hidden or empty.');
    return result;
  }
  const width = options.viewportWidth;
  const pageHeight = (options.size[1] - options.margin.top - options.margin.bottom) * PX_PER_MM * (width / ((options.size[0] - options.margin.left - options.margin.right) * PX_PER_MM));
  const ranges: Interval[] = [];
  const forced: number[] = [];
  const tables: { top: number; bottom: number; head: HTMLElement; height: number }[] = [];
  let end = 0;
  for (const el of [doc.body, ...all]) {
    const style = win.getComputedStyle(el), r = el.getBoundingClientRect();
    if (style.display === 'none' || !r.height || style.position === 'fixed') continue;
    end = Math.max(end, r.bottom);
    if (['page', 'always', 'left', 'right'].includes(style.breakBefore)) forced.push(r.top);
    if (['page', 'always', 'left', 'right'].includes(style.breakAfter)) forced.push(r.bottom);
    if (style.breakInside.includes('avoid') || ['TR', 'IMG', 'SVG'].includes(el.tagName) || Number(el.getAttribute('rowspan')) > 1) ranges.push({ top: r.top, bottom: r.bottom });
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName) || style.breakAfter.includes('avoid')) {
      const next = el.nextElementSibling?.getBoundingClientRect();
      ranges.push({ top: r.top, bottom: Math.min(next?.bottom ?? r.bottom, r.bottom + 32) });
    }
    if (el.tagName === 'TABLE') {
      const head = el.querySelector<HTMLElement>(':scope > thead');
      if (head) tables.push({ top: r.top, bottom: r.bottom, head, height: head.getBoundingClientRect().height });
    }
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
      const range = doc.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) ranges.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  forced.sort((a, b) => a - b);
  let start = 0;
  do {
    const table = tables.find(t => start > t.top + t.height && start < t.bottom - .5 && t.height < pageHeight / 2);
    const cut = safeCut(start, start + pageHeight - (table?.height ?? 0), ranges, forced, end);
    add(doc.body, 0, start, width, Math.max(1, cut - start), 'flow', table ? { element: table.head, height: table.height } : undefined);
    start = cut;
  } while (start < end - .5);
  if (ranges.some(r => r.bottom - r.top > pageHeight + .5)) diagnostics.push({ code: 'OVERSIZED_BLOCK', severity: 'warning', message: 'A protected block is taller than a page and must be split.' });
  return result;
}
