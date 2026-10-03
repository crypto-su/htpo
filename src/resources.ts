import type { Diagnostic, NormalizedOptions } from './types';

export class ResourceError extends Error {
  constructor(public readonly resource: string, cause?: unknown, detail?: string) {
    super(`A document resource could not be loaded (${new URL(resource, location.href).origin}). ${detail ?? 'Check its URL, CORS permission, and network access.'}`, { cause });
    this.name = 'ResourceError';
  }
}

export class Resources {
  private cache = new Map<string, Promise<Blob>>();
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private abort = () => this.controller.abort(this.options.signal?.reason);
  constructor(private options: NormalizedOptions, private diagnostics: Diagnostic[]) {
    this.timer = setTimeout(() => this.controller.abort(new DOMException('Resource loading timed out.', 'TimeoutError')), options.timeout);
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.abort();
  }
  check() { this.controller.signal.throwIfAborted(); }
  finishLoading() { clearTimeout(this.timer); }
  dispose() { clearTimeout(this.timer); this.options.signal?.removeEventListener('abort', this.abort); this.controller.abort(); this.cache.clear(); }
  async blob(url: string): Promise<Blob> {
    this.check();
    if (!this.cache.has(url)) this.cache.set(url, (async () => {
      if (!/^(https?:|data:|blob:)/i.test(url)) throw new ResourceError(url);
      try {
        const supplied = await this.options.resolveResource?.(url, this.controller.signal);
        this.check();
        if (supplied) return supplied;
        const pathname = new URL(url).pathname;
        const headers = pathname.endsWith('.css') ? { Accept: 'text/css' } : undefined;
        const r = await fetch(url, { signal: this.controller.signal, credentials: 'same-origin', headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.blob();
      } catch (cause) { this.check(); throw new ResourceError(url, cause); }
    })());
    return this.cache.get(url)!;
  }
  async text(url: string) { return (await this.blob(url)).text(); }
  async stylesheet(url: string): Promise<string> {
    const blob = await this.blob(url);
    const mime = blob.type.split(';')[0].trim().toLowerCase();
    // A dev server may return a JS module, or a missing route may return HTML.
    // Browsers silently discard these as CSS, leaving a plausible but broken PDF.
    if (['text/javascript', 'application/javascript', 'application/x-javascript', 'text/ecmascript', 'application/ecmascript', 'text/html', 'application/xhtml+xml'].includes(mime)) {
      throw new ResourceError(url, undefined, `Expected CSS, received ${mime}. Request stylesheets with Accept: text/css when using resolveResource.`);
    }
    return blob.text();
  }
  async data(url: string): Promise<string> {
    if (url.startsWith('data:')) return url;
    let blob = await this.blob(url);
    if (!blob.type || blob.type === 'application/octet-stream') {
      const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const mime = signature[0] === 255 && signature[1] === 216 ? 'image/jpeg'
        : signature[0] === 137 && signature[1] === 80 ? 'image/png'
        : String.fromCharCode(...signature.slice(0, 3)) === 'GIF' ? 'image/gif' : undefined;
      if (mime) blob = new Blob([blob], { type: mime });
    }
    return blobToDataUrl(blob);
  }
  async optional<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try { return await operation(); } catch (error) {
      this.check();
      if (this.options.resourcePolicy === 'error') throw error;
      this.diagnostics.push({ code: 'RESOURCE_MISSING', severity: 'warning', message: error instanceof Error ? error.message : 'Resource unavailable.' });
      return fallback;
    }
  }
  async css(text: string, base: string, chain: string[] = []): Promise<string> {
    // Resolve imports before URLs, retaining the imported rule's media condition.
    const imports = [...text.matchAll(/@import\s+(?:url\(\s*)?["']?([^\s"'();]+)["']?\s*\)?([^;]*);/gi)];
    for (const match of imports) {
      const url = new URL(match[1], base).href;
      const css = chain.includes(url) ? '' : await this.optional(async () => this.css(await this.stylesheet(url), url, [...chain, url]), '');
      text = text.replace(match[0], match[2].trim() ? `@media ${match[2].trim()} {${css}}` : css);
    }
    const urls = [...new Set([...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1].trim()))];
    const mapped = new Map<string, string>();
    await Promise.all(urls.map(async value => {
      if (value.startsWith('#') || value.startsWith('data:')) return;
      const url = new URL(value, base).href;
      mapped.set(value, await this.optional(() => this.data(url), 'data:,'));
    }));
    return text.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (full, value: string) => mapped.has(value.trim()) ? `url("${mapped.get(value.trim())}")` : full);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
