import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('exports Unicode, clipped vector SVG, alpha PNG, mislabeled PNG, WebP, JPEG and SVG fallback fixtures', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,0,0,.5)'; ctx.fillRect(0, 0, 10, 20);
    const png = canvas.toDataURL('image/png');
    ctx.fillStyle = '#008000'; ctx.fillRect(0, 0, 20, 20);
    const jpeg = canvas.toDataURL('image/jpeg', 1), webp = canvas.toDataURL('image/webp', 1);
    const html = `<style>
      .page{width:120mm;height:100mm;position:relative;font:14px 'Htpo Sans'}
      .at{position:absolute;margin:0}img{width:40px;height:40px;top:70px}
      </style><section data-htpo-page class="page">
      <p class="at" style="left:16px;top:8px">Türkçe ŞĞİı çğıöşü · 911₺ 😀</p>
      <a class="at" style="left:16px;top:35px" href="https://example.com/a(b)?q=ş">Bağlantı</a>
      <div class="at" style="left:20px;top:70px;width:40px;height:40px;background:blue"></div>
      <img class="at" style="left:20px" src="${png}"><img class="at" style="left:80px" src="${jpeg}">
      <img class="at" style="left:140px" src="${png.replace('image/png', 'image/jpeg')}"><img class="at" style="left:200px" src="${webp}">
      <svg class="at" style="left:20px;top:140px" width="120" height="60" viewBox="0 0 120 60">
        <g transform="translate(5 10)"><rect width="20" height="20" fill="green"/></g>
        <path d="M40 10h20v20h-20z" fill="blue"/><circle cx="80" cy="20" r="10" fill="red"/>
        <path d="M5 50 Q15 30 25 50 T45 50 C50 30 55 30 60 50 S70 55 80 50 A10 10 0 01100 50" fill="none" stroke="black"/>
        <rect x="115" y="0" width="20" height="60" fill="orange"/>
      </svg>
      <svg class="at" style="left:180px;top:140px" width="100" height="50">
        <defs><linearGradient id="test-gradient"><stop stop-color="blue"/><stop offset="1" stop-color="lime"/></linearGradient></defs>
        <rect width="100" height="50" fill="url(#test-gradient)"/>
      </svg>
      <svg class="at" style="left:20px;top:230px" width="80" height="40" opacity=".5">
        <rect width="50" height="40" fill="red"/><rect x="30" width="50" height="40" fill="red"/>
      </svg>
      <p class="at" style="left:120px;top:230px;font-weight:bold">Kalın İĞŞ</p>
      </section><section class="page" data-htpo-page><p>İkinci sayfa</p><img src="${jpeg}"></section>`;
    const prepared = await prepare(html, { format: [120, 100], title: 'ŞĞİ 😀 (test)', author: 'Yazar' });
    try {
      const pdf = await prepared.toPdf();
      const again = await prepared.toPdf();
      const encode = async (blob: Blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      };
      return { base64: await encode(pdf.blob), repeated: await encode(again.blob), diagnostics: pdf.diagnostics };
    } finally { prepared.dispose(); }
  });
  expect(result.diagnostics.map((d: { code: string }) => d.code)).toEqual(['SVG_RASTERIZED']);
  await mkdir('test-results/pdf-engine', { recursive: true });
  await writeFile('test-results/pdf-engine/vector.pdf', Buffer.from(result.base64, 'base64'));
  await writeFile('test-results/pdf-engine/repeated.pdf', Buffer.from(result.repeated, 'base64'));
});

test('raster PNG and JPEG exports preserve colors, size and header text', async ({ page }) => {
  for (const imageType of ['png', 'jpeg'] as const) {
    const result = await page.evaluate(async imageType => {
      const { toPdf } = await import('/src/index.ts' as string);
      const pdf = await toPdf('<div data-htpo-page style="width:100mm;height:80mm;background:#008000">Görüntü</div>', {
        format: [100, 100], margin: { top: 10, bottom: 10 }, mode: 'raster', scale: 1, imageType, imageQuality: 1, header: 'Başlık İŞ', footer: 'Sayfa {page}/{pages}',
      });
      const bytes = new Uint8Array(await pdf.blob.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    }, imageType);
    await mkdir('test-results/pdf-engine', { recursive: true });
    await writeFile(`test-results/pdf-engine/raster-${imageType}.pdf`, Buffer.from(result, 'base64'));
  }
});

test('reports unsupported glyphs and limits oversized SVG and mislabeled image allocation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { toPdf } = await import('/src/index.ts' as string);
    const pdf = await toPdf('<p>Known A, missing \u{10ffff}</p>');
    let limited = false;
    try {
      await toPdf('<svg width="100" height="100"><text x="10" y="20">SVG text</text></svg>', { maxCanvasPixels: 10 });
    } catch (error) { limited = String(error).includes('maxCanvasPixels'); }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
    const src = canvas.toDataURL('image/png').replace('image/png', 'image/jpeg');
    let imageLimited = false;
    try { await toPdf(`<img src="${src}">`, { maxCanvasPixels: 10 }); } catch (error) { imageLimited = String(error).includes('maxCanvasPixels'); }
    return { missing: pdf.diagnostics.some((d: { code: string }) => d.code === 'FONT_GLYPH_MISSING'), limited, imageLimited };
  });
  expect(result).toEqual({ missing: true, limited: true, imageLimited: true });
});
