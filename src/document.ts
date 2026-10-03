import { sanitizeDocument } from './sanitize';
import { fontCss, loadFonts, type LoadedFont } from './fonts';
import { bytesToBase64, Resources } from './resources';
import type { Diagnostic, HtmlSource, NormalizedOptions } from './types';

export interface LoadedDocument { frame: HTMLIFrameElement; doc: Document; resources: Resources; fonts: LoadedFont[] }

function isElement(source: HtmlSource): source is HTMLElement {
  return typeof source === 'object' && 'nodeType' in source && source.nodeType === 1;
}

/** A readable sandbox without script permission; the host owns loading and layout. */
export async function loadDocument(source: HtmlSource, options: NormalizedOptions, diagnostics: Diagnostic[]): Promise<LoadedDocument> {
  if (typeof window === 'undefined') throw new Error('Htpo requires a browser DOM.');
  const resources = new Resources(options, diagnostics);
  let frame: HTMLIFrameElement | undefined;
  try {
    options.onProgress?.({ phase: 'loading', completed: 0, total: 1 });
    let html: string;
    let base = options.baseUrl ?? location.href;
    if (isElement(source)) {
      base = options.baseUrl ?? source.ownerDocument.baseURI;
      html = `<html><head>${Array.from(source.ownerDocument.querySelectorAll('style,link[rel="stylesheet"]')).map(el => el.outerHTML).join('')}</head><body>${source.outerHTML}</body></html>`;
      if (source.querySelector('canvas')) diagnostics.push({ code: 'CANVAS_SOURCE', severity: 'warning', message: 'Live canvas pixels are not copied by HTML serialization. Convert canvas content to images before export.' });
    } else if (typeof source === 'string') html = source;
    else if ('url' in source) { base = new URL(source.url, base).href; html = await resources.text(base); }
    else { html = source.html; base = source.baseUrl ?? base; }
    const parsed = sanitizeDocument(html);
    // Inline everything before installing the document. CSP blocks any missed network reference.
    await Promise.all(Array.from(parsed.querySelectorAll<HTMLLinkElement>('link')).map(async link => {
      if (link.rel !== 'stylesheet') { link.remove(); return; }
      const url = new URL(link.getAttribute('href') ?? '', base).href;
      const text = await resources.optional(async () => resources.css(await resources.stylesheet(url), url, [url]), '');
      const style = parsed.createElement('style'); style.textContent = text;
      if (link.media) style.media = link.media;
      link.replaceWith(style);
    }));
    await Promise.all(Array.from(parsed.querySelectorAll('style')).map(async style => {
      style.textContent = await resources.css(style.textContent ?? '', base);
    }));
    await Promise.all(Array.from(parsed.querySelectorAll<HTMLElement>('[style]')).map(async el => {
      el.setAttribute('style', await resources.css(el.getAttribute('style')!, base));
    }));
    await Promise.all(Array.from(parsed.querySelectorAll('svg image, svg feImage')).map(async image => {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
      if (!href) return;
      const data = await resources.optional(() => resources.data(new URL(href, base).href), 'data:,');
      image.setAttribute('href', data); image.removeAttribute('xlink:href');
    }));
    const images = Array.from(parsed.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(images.map(async img => {
      img.removeAttribute('srcset'); img.removeAttribute('loading'); img.loading = 'eager';
      const url = img.getAttribute('src'); if (!url) return;
      img.src = await resources.optional(() => resources.data(new URL(url, base).href), 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E');
    }));
    for (const a of parsed.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const value = a.getAttribute('href')!;
      if (!value.startsWith('#')) a.href = new URL(value, base).href;
    }
    const fonts = await loadFonts(options.fonts ?? [], resources);
    // CSS TTF faces (such as FontAwesome) can also be embedded in the vector PDF.
    for (const style of parsed.querySelectorAll('style')) {
      for (const match of (style.textContent ?? '').matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
        const family = match[1].match(/font-family\s*:\s*([^;]+)/i)?.[1].trim().replace(/^["']|["']$/g, '');
        const dataUrl = match[1].match(/url\(["']?(data:[^"')]+)["']?\)\s*format\(["']truetype["']\)/i)?.[1];
        if (!family || !dataUrl || fonts.some(f => f.family === family)) continue;
        const data = bytesToBase64(new Uint8Array(await (await resources.blob(dataUrl)).arrayBuffer()));
        fonts.push({ family, aliases: [], data, weight: 400, style: 'normal', id: `htpo-font-${fonts.length}` });
      }
    }
    const override = parsed.createElement('style');
    const customCss = await resources.css(options.css ?? '', base);
    override.textContent = `${fontCss(fonts)}\nhtml {scroll-behavior:auto!important} *,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important} ${customCss}`;
    parsed.head.append(override);
    const defaults = parsed.createElement('style'); defaults.textContent = "body{margin:0;font-family:'Htpo Sans',sans-serif}";
    parsed.head.prepend(defaults);
    frame = document.createElement('iframe'); frame.title = 'Htpo isolated layout'; frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.setAttribute('aria-hidden', 'true'); frame.dataset.htpo = 'layout';
    frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${options.viewportWidth}px;height:1123px;border:0;pointer-events:none;`;
    const loaded = new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(resources.controller.signal.reason); };
      const cleanup = () => resources.controller.signal.removeEventListener('abort', abort);
      frame!.onload = () => { cleanup(); resolve(); };
      resources.controller.signal.addEventListener('abort', abort, { once: true });
    });
    // Parse only a trusted shell. Import the cleaned, resource-inlined DOM below
    // without serializing it back to HTML: CSS/raw-text and namespace mutations
    // must never become markup in a second HTML parse.
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"></head><body></body></html>`;
    document.body.append(frame); await loaded; resources.check();
    const doc = frame.contentDocument!;
    for (const attribute of parsed.documentElement.attributes) doc.documentElement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    for (const attribute of parsed.head.attributes) doc.head.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    for (const node of parsed.head.childNodes) doc.head.append(doc.importNode(node, true));
    doc.body.replaceWith(doc.importNode(parsed.body, true));
    if (options.media === 'print') activatePrintRules(doc);
    await Promise.all(Array.from(doc.images).filter(img => img.hasAttribute('src')).map(img => img.decode().catch(error => {
      if (options.resourcePolicy === 'error') throw error;
      diagnostics.push({ code: 'IMAGE_DECODE', severity: 'warning', message: 'An image could not be decoded.' });
    })));
    await Promise.all(fonts.map(f => doc.fonts.load(`${f.style} ${f.weight} 16px ${JSON.stringify(f.family)}`)));
    await doc.fonts.ready;
    if (options.compatibility === 'qt-webkit') {
      const elements = Array.from(doc.querySelectorAll<HTMLElement>('body, body *')).filter(el => el.namespaceURI !== 'http://www.w3.org/2000/svg');
      const heights = elements.map(el => parseFloat(doc.defaultView!.getComputedStyle(el).lineHeight));
      elements.forEach((el, index) => {
        if (Number.isFinite(heights[index])) el.style.lineHeight = `${Math.round(heights[index])}px`;
        if (el.tagName === 'IMG') { el.style.objectFit = 'fill'; el.style.imageOrientation = 'none'; }
      });
    }
    resources.check(); resources.finishLoading();
    options.onProgress?.({ phase: 'loading', completed: 1, total: 1 });
    return { frame, doc, resources, fonts };
  } catch (error) { frame?.remove(); resources.dispose(); throw error; }
}

function activatePrintRules(doc: Document) {
  const transform = (rules: CSSRuleList): string => Array.from(rules).map(rule => {
    if (rule.type === CSSRule.MEDIA_RULE) {
      const media = rule as CSSMediaRule;
      const condition = media.conditionText.replace(/\bprint\b/g, 'all').replace(/\bscreen\b/g, 'not all');
      return `@media ${condition}{${transform(media.cssRules)}}`;
    }
    return rule.cssText;
  }).join('\n');
  for (const style of doc.querySelectorAll<HTMLStyleElement>('style')) {
    if (style.media) style.media = style.media.replace(/\bprint\b/g, 'all').replace(/\bscreen\b/g, 'not all');
    if (style.sheet) style.textContent = transform(style.sheet.cssRules);
  }
}
