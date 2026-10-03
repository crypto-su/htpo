import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('exports opt-in resized photos with cropping, alpha, original links and size-specific reuse', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    // A deterministic textured photo surrogate; quadrants expose incorrect crops/orientation.
    const pixels = ctx.createImageData(1200, 800); let seed = 123;
    for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const i = (y * 1200 + x) * 4, noise = seed >>> 27;
      pixels.data[i] = (x < 600 ? 200 : 20) + noise;
      pixels.data[i + 1] = (y < 400 ? 180 : 30) + noise;
      pixels.data[i + 2] = (x >= 600 && y >= 400 ? 200 : 30) + noise;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const jpeg = canvas.toDataURL('image/jpeg', .98);
    // Independent browser pixel reference: resized JPEG decoding without JPEG re-encoding.
    const decoded = new Image(); decoded.src = jpeg; await decoded.decode();
    const expected = [];
    for (const dpi of [96, 192]) {
      const reference = document.createElement('canvas'); reference.width = 100 * dpi / 96; reference.height = 60 * dpi / 96;
      const context = reference.getContext('2d')!; context.imageSmoothingQuality = 'high';
      context.drawImage(decoded, 0, 0, reference.width, reference.height);
      const rgba = context.getImageData(0, 0, reference.width, reference.height).data;
      let rgb = ''; for (let i = 0; i < rgba.length; i += 4) rgb += String.fromCharCode(rgba[i], rgba[i + 1], rgba[i + 2]);
      expected.push({ dpi, width: reference.width, height: reference.height, rgb: btoa(rgb) });
    }
    const jpegBytes = Uint8Array.from(atob(jpeg.split(',')[1]), char => char.charCodeAt(0));
    // APP1 Exif/TIFF with orientation 6. This must keep its pre-resize PDF orientation.
    const app1 = [255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0];
    const oriented = new Uint8Array(jpegBytes.length + app1.length);
    oriented.set(jpegBytes.subarray(0, 2)); oriented.set(app1, 2); oriented.set(jpegBytes.subarray(2), app1.length + 2);
    let encoded = ''; for (let i = 0; i < oriented.length; i += 8192) encoded += String.fromCharCode(...oriented.subarray(i, i + 8192));
    const exif = 'data:image/jpeg;base64,' + btoa(encoded);
    canvas.width = 300; canvas.height = 150; ctx.fillStyle = 'rgba(255,0,0,.5)'; ctx.fillRect(0, 0, 150, 150);
    const alpha = canvas.toDataURL('image/png');
    canvas.width = 20; canvas.height = 10; ctx.fillStyle = '#008000'; ctx.fillRect(0, 0, 20, 10);
    const small = canvas.toDataURL('image/png');
    const html = `<style>.page{width:400px;height:400px;position:relative}.at{position:absolute}img{display:block}a{display:block}</style>
      <section class="page" data-htpo-page><p>Türkçe fotoğraf ŞĞİı</p>
      <a class="at" style="left:10px;top:40px" href="https://example.com/original.jpg?token=keep"><img src="${jpeg}" style="width:100px;height:60px;object-fit:fill"></a>
      <img class="at" src="${jpeg}" style="left:130px;top:40px;width:80px;height:80px;object-fit:cover;object-position:25% 75%">
      <img class="at" src="${jpeg}" style="left:240px;top:40px;width:100px;height:100px;object-fit:contain">
      <div class="at" style="left:10px;top:160px;width:60px;height:30px;background:blue"></div>
      <img class="at" src="${alpha}" style="left:10px;top:160px;width:60px;height:30px">
      <img class="at" src="${alpha.replace('image/png', 'image/jpeg')}" style="left:90px;top:160px;width:60px;height:30px">
      <img class="at" src="${small}" style="left:180px;top:160px;width:100px;height:50px">
      <img class="at" src="${exif}" style="left:10px;top:230px;width:80px;height:80px;object-fit:cover">
      <img class="at" src="${jpeg}" style="left:130px;top:230px;width:80px;height:80px;object-fit:cover;object-position:100% 50%">
      <svg class="at" style="left:240px;top:250px" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>
      </section><section class="page" data-htpo-page><p>İkinci sayfa</p>
      <img class="at" src="${jpeg}" style="left:10px;top:40px;width:80px;height:80px;object-fit:cover;object-position:25% 75%">
      <img class="at" src="${jpeg}" style="left:130px;top:40px;width:200px;height:100px;object-fit:cover">
      <a class="at" style="left:10px;top:200px" href="https://example.com/full.jpg"><img src="${jpeg}" style="width:100px;height:60px;object-fit:fill"></a>
      </section>`;
    const prepared = await prepare(html, { format: [400 * 25.4 / 96, 400 * 25.4 / 96] });
    const exports = [];
    try {
      for (const [name, options] of [['default', {}], ['off', { resizeImages: false }], ['on', { resizeImages: true }],
        ['keep-png', { resizeImages: true, resizeIgnoreExt: ['PNG'] }], ['keep-jpeg', { resizeImages: true, resizeIgnoreExt: '.JPG' }],
        ['lossless-96', { resizeImages: true, resizeLossless: true }],
        ['lossless-192', { resizeImages: true, resizeLossless: true, resizeDpi: 192 }],
        ['jpeg-192', { resizeImages: true, resizeLossless: false, resizeDpi: 192 }],
        ['lossless-keep-png-192', { resizeImages: true, resizeLossless: true, resizeDpi: 192, resizeIgnoreExt: ['png'] }],
        ['disabled-quality', { resizeImages: false, resizeLossless: true, resizeDpi: 192 }],
        ['off-again', { resizeImages: false }]] as const) {
        const pdf = await prepared.toPdf(options);
        const bytes = new Uint8Array(await pdf.blob.arrayBuffer()); let encoded = '';
        for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
        exports.push({ name, size: bytes.length, base64: btoa(encoded), diagnostics: pdf.diagnostics });
      }
      const doc = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-htpo]')].at(-1)!.contentDocument!;
      return { exports, expected, unchangedSource: doc.querySelector('img')!.src === jpeg, link: doc.querySelector('a')!.href };
    } finally { prepared.dispose(); }
  });
  expect(result.unchangedSource).toBe(true); expect(result.link).toBe('https://example.com/original.jpg?token=keep');
  expect(result.exports.find(pdf => pdf.name === 'on')!.size).toBeLessThan(result.exports[0].size / 3);
  await mkdir('test-results/image-resize', { recursive: true });
  await writeFile('test-results/image-resize/expected-lossless.json', JSON.stringify(result.expected));
  for (const pdf of result.exports) {
    expect(pdf.diagnostics).toEqual([]);
    await writeFile(`test-results/image-resize/${pdf.name}.pdf`, Buffer.from(pdf.base64, 'base64'));
  }
});

test('resize exemptions work with misleading URLs/MIME, inherited options and per-export overrides', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare, toPdf } = await import('/src/index.ts' as string);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    canvas.getContext('2d')!.fillRect(0, 0, 1200, 800);
    const jpeg = await (await fetch(canvas.toDataURL('image/jpeg'))).blob();
    canvas.width = 300; canvas.height = 150; canvas.getContext('2d')!.fillRect(0, 0, 300, 150);
    const png = await (await fetch(canvas.toDataURL('image/png'))).blob();
    const html = '<a href="https://example.com/original"><img src="https://example.com/frame.JPG?download=1" style="width:100px;height:60px;object-fit:cover"></a><img src="https://example.com/photo?name=photo.PNG" style="width:100px;height:60px">';
    const options = { resizeImages: true, resizeIgnoreExt: ['PNG'], resolveResource: (url: string) =>
      new Blob([url.includes('/frame.') ? png : jpeg], { type: url.includes('/frame.') ? 'image/jpeg' : 'image/png' }) };
    const dimensions = async (pdf: { blob: Blob }) => [...(await pdf.blob.text()).matchAll(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    const direct = await dimensions(await toPdf(html, options));
    const prepared = await prepare(html, options);
    try {
      const exports = [];
      for (const overrides of [{}, { resizeIgnoreExt: [] }, { resizeIgnoreExt: 'jpg' }, { resizeIgnoreExt: ['png', 'JPEG'] }]) {
        exports.push(await dimensions(await prepared.toPdf(overrides)));
      }
      let rejected = false;
      try { await prepared.toPdf({ resizeIgnoreExt: [42] }); } catch (error) { rejected = String(error).includes('resizeIgnoreExt'); }
      const recovered = await dimensions(await prepared.toPdf());
      return { direct, exports, rejected, recovered };
    } finally { prepared.dispose(); }
  });
  const pngOriginal = [[300, 150], [100, 60]];
  expect(result).toEqual({ direct: pngOriginal,
    exports: [pngOriginal, [[100, 60], [100, 60]], [[100, 60], [1200, 800]], [[300, 150], [1200, 800]]],
    rejected: true, recovered: pngOriginal });
});

test('resizing respects canvas limits, never enlarges small sources and releases failed exports', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare, toPdf } = await import('/src/index.ts' as string);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1000;
    canvas.getContext('2d')!.fillRect(0, 0, 1000, 1000);
    const html = `<img src="${canvas.toDataURL()}" style="width:10px;height:10px">`;
    const before = document.querySelectorAll('iframe[data-htpo]').length;
    const good = await toPdf(html, { resizeImages: true, maxCanvasPixels: 100 });
    const errors = [];
    for (const options of [{ resizeImages: false, maxCanvasPixels: 100 }, { resizeImages: true, maxCanvasPixels: 99 },
      { resizeImages: true, resizeLossless: true, resizeDpi: 192, maxCanvasPixels: 399 }]) {
      try { await toPdf(html, options); } catch (error) { errors.push(String(error)); }
    }
    const prepared = await prepare('<p>Text</p>');
    let invalid = false;
    try { await prepared.toPdf({ resizeImages: 'true' }); } catch (error) { invalid = String(error).includes('boolean'); }
    const afterFailure = await prepared.toPdf({ resizeImages: false }); prepared.dispose();
    return { good: await good.blob.slice(0, 5).text(), errors, invalid,
      recovered: await afterFailure.blob.slice(0, 5).text(), clean: document.querySelectorAll('iframe[data-htpo]').length === before };
  });
  expect(result).toMatchObject({ good: '%PDF-', invalid: true, recovered: '%PDF-', clean: true });
  expect(result.errors).toHaveLength(3); for (const error of result.errors) expect(error).toContain('maxCanvasPixels');
});

test('quality options inherit, override and recover after invalid input', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const html = `<img src="${canvas.toDataURL('image/jpeg')}" style="width:100px;height:60px">`;
    const prepared = await prepare(html, { resizeImages: true, resizeLossless: true, resizeDpi: 192 });
    try {
      const exports = [];
      for (const options of [{}, { resizeLossless: false, resizeDpi: 96 }, { resizeLossless: undefined, resizeDpi: undefined }, { resizeLossless: true, imageQuality: .1 }]) {
        const text = await (await prepared.toPdf(options)).blob.text();
        const match = text.match(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)[\s\S]*?\/Filter \/(\w+)/)!;
        exports.push([Number(match[1]), Number(match[2]), match[3]]);
      }
      const errors = [];
      for (const options of [{ resizeDpi: 0 }, { resizeDpi: Infinity }, { resizeDpi: '150' }, { resizeLossless: 'true' }]) {
        try { await prepared.toPdf(options); } catch (error) { errors.push(String(error)); }
      }
      return { exports, errors, recovered: await (await prepared.toPdf()).blob.slice(0, 5).text() };
    } finally { prepared.dispose(); }
  });
  expect(result.exports).toEqual([[200, 120, 'FlateDecode'], [100, 60, 'DCTDecode'], [200, 120, 'FlateDecode'], [200, 120, 'FlateDecode']]);
  expect(result.errors).toHaveLength(4);
  result.errors.forEach((error, i) => expect(error).toContain(i < 3 ? 'resizeDpi' : 'resizeLossless'));
  expect(result.recovered).toBe('%PDF-');
});

test('raster output keeps its page resolution when image resizing is enabled', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const p = await prepare('<div data-htpo-page style="width:100px;height:100px;background:green">Page</div>', { format: [100 * 25.4 / 96, 100 * 25.4 / 96], mode: 'raster', scale: 2 });
    try {
      const pdf = await p.toPdf({ resizeImages: true, resizeLossless: true, resizeDpi: 300 });
      const bytes = new Uint8Array(await pdf.blob.arrayBuffer()); let encoded = '';
      for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(encoded);
    } finally { p.dispose(); }
  });
  await mkdir('test-results/image-resize', { recursive: true });
  await writeFile('test-results/image-resize/raster.pdf', Buffer.from(result, 'base64'));
});
