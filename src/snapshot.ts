import { blobToDataUrl } from './resources';

/** Rasterize an already self-contained SVG using the browser's own CSS painter. */
export async function svgCanvas(svg: string, width: number, height: number, scale: number, timeout: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted();
  const img = new Image();
  const source = await blobToDataUrl(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); img.onload = img.onerror = null; };
    const abort = () => { cleanup(); img.src = ''; reject(signal?.reason); };
    const timer = setTimeout(() => { cleanup(); img.src = ''; reject(new Error('SVG snapshot decoding timed out.')); }, timeout);
    img.onload = () => { cleanup(); resolve(); };
    img.onerror = () => { cleanup(); reject(new Error('Browser could not render this SVG snapshot.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    img.src = source;
  });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale); context.drawImage(img, 0, 0, width, height);
  img.src = '';
  return canvas;
}

function copyStyle(source: Element, target: Element, pseudo?: string): CSSStyleDeclaration {
  const style = source.ownerDocument.defaultView!.getComputedStyle(source, pseudo);
  const svg = target.namespaceURI === 'http://www.w3.org/2000/svg';
  const properties = svg ? ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'color', 'visibility', 'display'] : Array.from(style);
  target.setAttribute('style', properties.map(property => `${property}:${style.getPropertyValue(property)};`).join(''));
  return style;
}

function cloneComputed(source: Element): Element {
  const copy = source.cloneNode(false) as HTMLElement;
  copyStyle(source, copy);
  copy.removeAttribute('id');
  for (const node of source.childNodes) {
    if (node.nodeType === 1) {
      if (['STYLE', 'LINK', 'SCRIPT'].includes((node as Element).tagName)) continue;
      copy.append(cloneComputed(node as Element));
    } else copy.append(node.cloneNode());
  }
  // Resolve generated glyphs, including icon fonts, into real nodes for SVG Image.
  if (source.namespaceURI !== 'http://www.w3.org/2000/svg') {
    for (const pseudo of ['::before', '::after']) {
      const style = source.ownerDocument.defaultView!.getComputedStyle(source, pseudo);
      if (!style.content || ['none', 'normal', '""', "''"].includes(style.content) || style.display === 'none') continue;
      const node = source.ownerDocument.createElement('span');
      copyStyle(source, node, pseudo); node.textContent = style.content.replace(/^["']|["']$/g, '');
      if (pseudo === '::before') copy.prepend(node); else copy.append(node);
    }
  }
  return copy;
}

export function snapshotSvg(element: HTMLElement, x: number, y: number, width: number, height: number): string {
  const doc = element.ownerDocument;
  const copy = cloneComputed(element) as HTMLElement;
  copy.style.position = 'absolute'; copy.style.margin = '0'; copy.style.left = `${-x}px`; copy.style.top = `${-y}px`;
  copy.style.transform = 'none';
  // A page fragment keeps its measured size even when its parent changes.
  const rect = element.getBoundingClientRect();
  copy.style.width = `${rect.width}px`; copy.style.height = `${rect.height}px`; copy.style.boxSizing = 'border-box';
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.cssText = `position:relative;overflow:hidden;width:${width}px;height:${height}px;background:white;`;
  const fontStyle = doc.createElement('style');
  const fontRules: string[] = [];
  for (const sheet of doc.styleSheets) for (const rule of sheet.cssRules) if (rule.type === CSSRule.FONT_FACE_RULE) fontRules.push(rule.cssText);
  fontStyle.textContent = fontRules.join('\n');
  wrapper.append(fontStyle, copy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(wrapper)}</foreignObject></svg>`;
}
