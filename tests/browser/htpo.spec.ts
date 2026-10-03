import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('exports real PDF bytes, keeps two pages and cleans up its document', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const { toPdf } = await import('/src/index.ts' as string);
    const html = `<style>.page{width:210mm;height:297mm}</style>
      <section class="page" data-htpo-page><h1>Türkçe belge</h1><p>Birinci sayfa</p></section>
      <section class="page" data-htpo-page><h1>İkinci sayfa</h1></section>`;
    const count = document.querySelectorAll('iframe[data-htpo]').length;
    const result = await toPdf(html);
    return { pages: result.pages.length, signature: await result.blob.slice(0, 5).text(), size: result.blob.size, cleaned: document.querySelectorAll('iframe[data-htpo]').length === count, warnings: result.diagnostics };
  });
  expect(data.pages).toBe(2); expect(data.signature).toBe('%PDF-'); expect(data.size).toBeGreaterThan(10000); expect(data.cleaned).toBe(true);
});

test('flow pagination repeats table headings and respects forced breaks', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const rows = Array.from({ length: 75 }, (_, i) => `<tr><td>Satır ${i + 1} Türkçe</td><td>Açıklama</td></tr>`).join('');
    const p = await prepare(`<style>body{font-size:14px}table{width:100%;border-collapse:collapse}td,th{padding:12px;border:1px solid #aaa}h2{break-before:page}</style><table><thead><tr><th>Kalem</th><th>Detay</th></tr></thead><tbody>${rows}</tbody></table><h2>Son bölüm</h2><p>Son satır</p>`, { margin: 12, pagination: 'flow' });
    const result = await p.toPdf(); const pages = p.pages; p.dispose();
    return { pages, size: result.blob.size };
  });
  expect(data.pages.length).toBeGreaterThan(3); expect(data.pages.length).toBeLessThan(8); expect(data.size).toBeGreaterThan(20000);
});

test('strips active content and disposes failed jobs', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const before = document.querySelectorAll('iframe[data-htpo]').length;
    const p = await prepare(`<script>parent.document.body.dataset.compromised='yes'</script><img src="data:image/png,broken" onerror="parent.document.body.dataset.compromised='yes'"><p>Safe</p>`, { resourcePolicy: 'warn' });
    p.dispose();
    try { await prepare('<p>Missing selector</p>', { pageSelector: '.missing' }); } catch { /* Expected */ }
    return { active: document.body.dataset.compromised, cleaned: document.querySelectorAll('iframe[data-htpo]').length === before };
  });
  expect(result.active).toBeUndefined(); expect(result.cleaned).toBe(true);
});

test('supports cancellation and refuses unsafe canvas allocation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const controller = new AbortController(); controller.abort();
    let aborted = false; try { await prepare('<p>Test</p>', { signal: controller.signal }); } catch { aborted = true; }
    const p = await prepare('<div data-htpo-page style="width:210mm;height:297mm">Test</div>', { mode: 'raster', maxCanvasPixels: 10 });
    let limit = false; try { await p.toPdf(); } catch (error) { limit = String(error).includes('maxCanvasPixels'); } p.dispose();
    return { aborted, limit };
  });
  expect(result).toEqual({ aborted: true, limit: true });
});

test('raster export paints backgrounds and returns a real PDF', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const p = await prepare('<div data-htpo-page style="width:210mm;height:297mm;background:#ff0000;padding:30px">Türkçe görüntü</div>');
    try {
      const canvas = await p.preview(1, 1);
      const pixel = [...canvas.getContext('2d')!.getImageData(5, 5, 1, 1).data];
      const pdf = await p.toPdf({ mode: 'raster', scale: 1 });
      return { pixel, signature: await pdf.blob.slice(0, 5).text(), diagnostics: pdf.diagnostics };
    } finally { p.dispose(); }
  });
  expect(result.pixel).toEqual([255, 0, 0, 255]); expect(result.signature).toBe('%PDF-');
  expect(result.diagnostics.some((d: { code: string }) => d.code === 'RASTER_TEXT')).toBe(true);
});

test('missing resources fail strictly or produce explicit warnings', async ({ page }) => {
  await page.route('**/missing-image.png', route => route.fulfill({ status: 404, body: 'Missing' }));
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    let strict = false;
    try { await prepare('<img src="/missing-image.png">'); } catch (error) { strict = (error as Error).name === 'ResourceError'; }
    const p = await prepare('<img src="/missing-image.png"><p>Available text</p>', { resourcePolicy: 'warn' });
    const warnings = p.diagnostics; p.dispose();
    return { strict, warnings };
  });
  expect(result.strict).toBe(true); expect(result.warnings.some((d: { code: string }) => d.code === 'RESOURCE_MISSING')).toBe(true);
});

test('mid-render cancellation releases the document and starts no next page', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { toPdf } = await import('/src/index.ts' as string);
    const controller = new AbortController();
    const before = document.querySelectorAll('iframe[data-htpo]').length;
    let aborted = false;
    try {
      await toPdf('<div data-htpo-page style="width:100px;height:100px">One</div><div data-htpo-page style="width:100px;height:100px">Two</div>', {
        signal: controller.signal, onProgress: (p: { phase: string }) => { if (p.phase === 'rendering') controller.abort(); },
      });
    } catch (error) { aborted = (error as Error).name === 'AbortError'; }
    return { aborted, clean: document.querySelectorAll('iframe[data-htpo]').length === before };
  });
  expect(result).toEqual({ aborted: true, clean: true });
});

test('application resource bytes work without cross-origin requests', async ({ page }) => {
  let requests = 0;
  await page.route('https://example.invalid/**', route => { requests++; return route.abort(); });
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const p = await prepare('<style>body{font-family:serif}</style><img src="https://example.invalid/photo.svg" width="40" height="40">', {
      resolveResource: (url: string) => url === 'https://example.invalid/photo.svg' ? new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>'], { type: 'image/svg+xml' }) : undefined,
    });
    try {
      const canvas = await p.preview(1, 1);
      return { pixel: [...canvas.getContext('2d')!.getImageData(5, 5, 1, 1).data], warnings: p.diagnostics.length };
    } finally { p.dispose(); }
  });
  expect(requests).toBe(0); expect(result.pixel).toEqual([0, 0, 255, 255]); expect(result.warnings).toBe(0);
});

test('resolved stylesheets preserve columns and reject Vite JS or HTML responses', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const html = '<link rel="stylesheet" href="https://example.invalid/columns.css"><div class="columns"><div class="column">Left</div><div class="column">Right</div></div>';
    const resolveCss = async () => (await fetch('/tests/fixtures/columns.css', { headers: { Accept: 'text/css' } })).blob();
    const prepared = await prepare(html, { resolveResource: resolveCss });
    let pixels: number[][];
    try {
      const canvas = await prepared.preview(1, 1);
      pixels = [50, 250].map(x => [...canvas.getContext('2d')!.getImageData(x, 50, 1, 1).data]);
    } finally { prepared.dispose(); }
    const before = document.querySelectorAll('iframe[data-htpo]').length;
    const errors: string[] = [];
    for (const source of [html, '<style>@import "https://example.invalid/columns.css";</style><p>Text</p>']) {
      for (const type of ['text/javascript', 'text/html']) {
        try { await prepare(source, { resolveResource: () => new Blob(['not a stylesheet'], { type }) }); }
        catch (error) { errors.push(String(error)); }
      }
    }
    const warned = await prepare(html, { resourcePolicy: 'warn', resolveResource: () => new Blob(['export default {}'], { type: 'text/javascript' }) });
    const diagnostics = warned.diagnostics; warned.dispose();
    return { pixels, errors, diagnostics, clean: before === document.querySelectorAll('iframe[data-htpo]').length };
  });
  expect(result.pixels).toEqual([[0, 0, 255, 255], [255, 0, 0, 255]]);
  expect(result.errors).toHaveLength(4);
  for (const error of result.errors) expect(error).toContain('Expected CSS, received');
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].code).toBe('RESOURCE_MISSING');
  expect(result.clean).toBe(true);
});
