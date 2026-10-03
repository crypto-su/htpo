import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { toPdf, prepare } from '../../src';

declare global {
  interface Window { Htpo: { toPdf: typeof toPdf; prepare: typeof prepare } }
}

const unexpectedRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  unexpectedRequests.length = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5181' && ['/', '/htpo.min.js', '/api/pdf-save'].includes(url.pathname)) return route.continue();
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    unexpectedRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  expect(await page.evaluate(() => ({ htpo: typeof window.Htpo, jspdf: 'jspdf' in window, purifier: 'DOMPurify' in window })))
    .toEqual({ htpo: 'undefined', jspdf: false, purifier: false });
  await page.addScriptTag({ url: '/htpo.min.js' });
});

test.afterEach(() => { expect(unexpectedRequests, 'Standalone must not fetch runtime dependencies, fonts or chunks.').toEqual([]); });

test('distribution contains no removed libraries and sanitizes without a host global', async ({ page }) => {
  for (const name of ['htpo.min.js', 'htpo.js', 'htpo.umd.cjs']) {
    expect(await readFile(`dist/${name}`, 'utf8')).not.toMatch(/dompurify|svg2pdf|jspdf/i);
  }
  const result = await page.evaluate(async () => {
    const prepared = await window.Htpo.prepare('<script>parent.document.body.dataset.compromised=1</script><div onclick="alert(1)"><a href="javascript:alert(1)">Safe</a></div>');
    try {
      const doc = document.querySelector<HTMLIFrameElement>('iframe[data-htpo]')!.contentDocument!;
      return { scripts: doc.querySelectorAll('script').length, events: doc.querySelectorAll('[onclick]').length,
        href: doc.querySelector('a')!.getAttribute('href'), compromised: document.body.dataset.compromised,
        signature: await (await prepared.toPdf()).blob.slice(0, 5).text(), purifier: 'DOMPurify' in window };
    } finally { prepared.dispose(); }
  });
  expect(result).toEqual({ scripts: 0, events: 0, href: null, compromised: undefined, signature: '%PDF-', purifier: false });
});

test('one classic script exports the API and produces a vector PDF with embedded fonts and SVG', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const pdf = await window.Htpo.toPdf(`
      <style>.page{width:210mm;height:297mm;position:relative;padding:30px;box-sizing:border-box}</style>
      <section class="page" data-htpo-page><h1>Türkçe: ŞĞİıçöşü · 911₺</h1>
      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><path d="M5 5H75V75H5Z" fill="#008000"/></svg></section>
      <section class="page" data-htpo-page><p>İkinci sayfa</p></section>
    `);
    return {
      pages: pdf.pages.length, mime: pdf.blob.type, signature: await pdf.blob.slice(0, 5).text(), size: pdf.blob.size,
      diagnostics: pdf.diagnostics, frames: document.querySelectorAll('iframe[data-htpo]').length,
      ownProducer: (await pdf.blob.text()).includes('/Producer (Htpo PDF 0.1.0)'),
      legacyProducer: (await pdf.blob.text()).includes('jsPDF'),
    };
  });
  expect(result).toMatchObject({ pages: 2, mime: 'application/pdf', signature: '%PDF-', diagnostics: [], frames: 0, ownProducer: true, legacyProducer: false });
  expect(result.size).toBeGreaterThan(10000);
});

test('standalone resizeImages embeds the displayed dimensions only when enabled', async ({ page }) => {
  const images = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    canvas.getContext('2d')!.fillRect(0, 0, 1200, 800);
    const prepared = await window.Htpo.prepare(`<img src="${canvas.toDataURL('image/jpeg')}" style="width:100px;height:60px">`);
    try {
      const result = [];
      for (const options of [{ resizeImages: false }, { resizeImages: true }, { resizeImages: true, resizeIgnoreExt: ['JPG'] },
        { resizeImages: true, resizeLossless: true, resizeDpi: 192 }]) {
        const pdf = await prepared.toPdf(options);
        result.push([...((await pdf.blob.text()).matchAll(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)/g))].map(m => [Number(m[1]), Number(m[2])]));
      }
      return result;
    } finally { prepared.dispose(); }
  });
  expect(images).toEqual([[[1200, 800]], [[100, 60]], [[1200, 800]], [[200, 120]]]);
});

test('raster and preview APIs work without extra script or font files', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const prepared = await window.Htpo.prepare('<div data-htpo-page style="width:210mm;height:297mm;background:rgb(0,128,0);padding:30px">Görüntü</div>');
    try {
      const preview = await prepared.preview(1, 1);
      const pixel = [...preview.getContext('2d')!.getImageData(5, 5, 1, 1).data];
      const pdf = await prepared.toPdf({ mode: 'raster', scale: 1 });
      return { pixel, signature: await pdf.blob.slice(0, 5).text(), pages: pdf.pages.length };
    } finally { prepared.dispose(); }
  });
  expect(result).toEqual({ pixel: [0, 128, 0, 255], signature: '%PDF-', pages: 1 });
});

test('HTML to Blob to multipart upload needs no preview or download UI', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/api/pdf-save', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
    const body = request.postDataBuffer()!;
    expect(body.includes(Buffer.from('name="pdf"; filename="rapor.pdf"'))).toBe(true);
    expect(body.includes(Buffer.from('Content-Type: application/pdf'))).toBe(true);
    expect(body.includes(Buffer.from('%PDF-'))).toBe(true);
    await route.fulfill({ json: { saved: true, file: 'rapor.pdf' } });
  });
  const saved = await page.evaluate(async () => {
    const { blob } = await window.Htpo.toPdf('<h1>Backend tarafından hazırlanan HTML</h1>');
    const form = new FormData(); form.append('pdf', blob, 'rapor.pdf');
    const response = await fetch('/api/pdf-save', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Upload failed.');
    return response.json();
  });
  expect(saved).toEqual({ saved: true, file: 'rapor.pdf' });
  expect(downloads).toEqual([]);
  expect(await page.locator('body').innerHTML()).toBe('');
});
