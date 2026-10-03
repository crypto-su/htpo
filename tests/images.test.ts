import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageExtension, imageResizePlan, resizeKey } from '../src/images';
import { normalizeOptions } from '../src/options';
import { jpegWithoutRenderingMetadata } from '../src/pdf/jpeg';

test('image resizing is opt-in and rejects truthy strings', () => {
  assert.equal(normalizeOptions().resizeImages, false);
  assert.equal(normalizeOptions({ resizeImages: false }).resizeImages, false);
  assert.equal(normalizeOptions({ resizeImages: true }).resizeImages, true);
  assert.throws(() => normalizeOptions({ resizeImages: 'false' as unknown as boolean }), /boolean/);
});

test('resize quality defaults and invalid DPI/lossless values are explicit', () => {
  assert.equal(normalizeOptions().resizeDpi, 96);
  assert.equal(normalizeOptions().resizeLossless, false);
  assert.equal(normalizeOptions({ resizeDpi: 150.5, resizeLossless: true }).resizeDpi, 150.5);
  assert.equal(normalizeOptions({ resizeLossless: true }).resizeLossless, true);
  for (const dpi of [0, -1, NaN, Infinity, '150', true]) {
    assert.throws(() => normalizeOptions({ resizeDpi: dpi as number }), /resizeDpi/);
  }
  for (const lossless of ['true', 'false', 1]) {
    assert.throws(() => normalizeOptions({ resizeLossless: lossless as unknown as boolean }), /resizeLossless/);
  }
});

test('resize exemptions normalize case, dots and JPEG aliases without mutating input', () => {
  assert.deepEqual(normalizeOptions().resizeIgnoreExt, []);
  assert.deepEqual(normalizeOptions({ resizeIgnoreExt: '.PNG' }).resizeIgnoreExt, ['png']);
  const extensions = [' PNG ', 'png', '.JPG', 'jpeg', 'WEBP'];
  assert.deepEqual(normalizeOptions({ resizeIgnoreExt: extensions }).resizeIgnoreExt, ['png', 'jpeg', 'webp']);
  assert.deepEqual(extensions, [' PNG ', 'png', '.JPG', 'jpeg', 'WEBP']);
  for (const value of [null, true, 1, [null], [''], ['png,jpg'], ['image/png']]) {
    assert.throws(() => normalizeOptions({ resizeIgnoreExt: value as unknown as string[] }), /resizeIgnoreExt/);
  }
});

test('resize exemptions detect actual image bytes before MIME labels', () => {
  const url = (bytes: string, mime = 'application/octet-stream') => `data:${mime};base64,${Buffer.from(bytes, 'latin1').toString('base64')}`;
  assert.equal(imageExtension(url('\x89PNG\r\n\x1a\n', 'image/jpeg')), 'png');
  assert.equal(imageExtension(url('\xff\xd8\xff\xe0', 'image/png')), 'jpeg');
  assert.equal(imageExtension(url('RIFF\x08\0\0\0WEBP')), 'webp');
  assert.equal(imageExtension(url('GIF89a')), 'gif');
  assert.equal(imageExtension(url('BM')), 'bmp');
  assert.equal(imageExtension(url('\0\0\0\x20ftypavif')), 'avif');
  assert.equal(imageExtension('data:IMAGE/PNG,%89PNG%0D%0A%1A%0A'), 'png');
  assert.equal(imageExtension('data:image/svg+xml,%3Csvg/%3E'), 'svg');
  assert.equal(imageExtension('data:application/octet-stream;base64,eA=='), undefined);
});

test('resizing crops to the visible object-fit box at the final PDF pixel size', () => {
  const box = { x: 50, y: 100, width: 100, height: 100 };
  const cover = imageResizePlan({ box, x: 0, y: 100, width: 200, height: 100 }, 2000, 1000, .75)!;
  assert.deepEqual(cover, { visible: box, crop: { x: .25, y: 0, width: .5, height: 1 }, pixelWidth: 100, pixelHeight: 100 });
  const contain = imageResizePlan({ box, x: 50, y: 125, width: 100, height: 50 }, 2000, 1000, .75)!;
  assert.deepEqual(contain.visible, { x: 50, y: 125, width: 100, height: 50 });
  assert.deepEqual(contain.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(contain.pixelHeight, 50);
  const doubled = imageResizePlan({ ...box, box }, 2000, 1000, 1.5)!;
  assert.equal(doubled.pixelWidth, 200); assert.equal(doubled.pixelHeight, 200);
  assert.equal(imageResizePlan({ box, x: 200, y: 100, width: 100, height: 100 }, 2000, 1000, .75), undefined);
});

test('small images are never enlarged and cache keys distinguish dimensions and crops', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const small = imageResizePlan({ ...box, box }, 20, 10, .75)!;
  assert.equal(small.pixelWidth, 20); assert.equal(small.pixelHeight, 10);
  const first = imageResizePlan({ box, x: -50, y: 0, width: 200, height: 100 }, 2000, 1000, .75)!;
  const second = imageResizePlan({ box, x: -100, y: 0, width: 200, height: 100 }, 2000, 1000, .75)!;
  const anotherPage = imageResizePlan({ box: { ...box, y: 10000 }, x: -50, y: 10000, width: 200, height: 100 }, 2000, 1000, .75)!;
  assert.notEqual(resizeKey(first), resizeKey(second));
  assert.equal(resizeKey(first), resizeKey(anotherPage));
  assert.notEqual(resizeKey(first), resizeKey({ ...first, pixelWidth: 200 }));
});

test('resize DPI changes bitmap resolution without changing geometry or enlarging originals', () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };
  const placement = { ...box, box };
  const standard = imageResizePlan(placement, 2000, 1200, .75)!;
  const doubled = imageResizePlan(placement, 2000, 1200, .75, 192)!;
  const print = imageResizePlan(placement, 2000, 1200, .75, 150)!;
  const low = imageResizePlan(placement, 2000, 1200, .75, 48)!;
  assert.deepEqual([doubled.pixelWidth, doubled.pixelHeight], [200, 120]);
  assert.deepEqual([print.pixelWidth, print.pixelHeight], [157, 94]);
  assert.deepEqual([low.pixelWidth, low.pixelHeight], [50, 30]);
  assert.deepEqual(doubled.visible, standard.visible); assert.deepEqual(doubled.crop, standard.crop);
  assert.notEqual(resizeKey(doubled), resizeKey(standard));
  const capped = imageResizePlan(placement, 20, 10, .75, 300)!;
  assert.deepEqual([capped.pixelWidth, capped.pixelHeight], [20, 10]);
});

test('temporary JPEG decoding removes EXIF/ICC hints while retaining other markers and scan bytes', () => {
  const icc = [0xff, 0xe2, 0, 16, ...new TextEncoder().encode('ICC_PROFILE\0'), 1, 1];
  const tail = [0xff, 0xe2, 0, 4, 5, 6, 0xff, 0xee, 0, 4, 7, 8, 0xff, 0xda, 0, 2, 0xff, 0xe1, 42, 0xff, 0xd9];
  const input = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4, ...icc, ...tail]);
  assert.deepEqual(jpegWithoutRenderingMetadata(input), Uint8Array.from([0xff, 0xd8, ...tail]));
  const unchanged = Uint8Array.from([0xff, 0xd8, ...tail]);
  assert.equal(jpegWithoutRenderingMetadata(unchanged), unchanged);
  assert.equal(input[3], 0xe1, 'The original image bytes are never mutated.');
});
