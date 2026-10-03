import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PdfWriter } from '../src/pdf/writer';
import { TrueTypeFont } from '../src/pdf/truetype';
import { svgPath } from '../src/pdf/svg';

const regular = readFileSync('assets/fonts/DejaVuSans.ttf');

function objects(pdf: Buffer): Buffer[] {
  const text = pdf.toString('latin1');
  const offset = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
  assert.equal(text.slice(offset, offset + 5), 'xref\n');
  const xref = text.slice(offset).split('\n'), count = Number(xref[1].split(' ')[1]);
  assert.equal(xref[2], '0000000000 65535 f ');
  const offsets = xref.slice(3, count + 2).map((row, i) => {
    assert.match(row, /^\d{10} 00000 n $/);
    const start = Number(row.slice(0, 10)); assert.ok(text.slice(start).startsWith(`${i + 1} 0 obj\n`)); return start;
  });
  return offsets.map((start, i) => pdf.subarray(start, offsets[i + 1] ?? offset));
}
function streams(pdf: Buffer): Buffer[] {
  return objects(pdf).filter(obj => obj.includes(Buffer.from('\nstream\n'))).map(obj => {
    const start = obj.indexOf('\nstream\n') + 8, head = obj.subarray(0, start).toString();
    const bytes = obj.subarray(start, start + Number(head.match(/\/Length (\d+)/)![1]));
    return head.includes('/FlateDecode') ? inflateSync(bytes) : bytes;
  });
}

test('PDF xref offsets, page sizes, Unicode metadata, URI escaping and streams are readable', async () => {
  const pdf = new PdfWriter(200, 100);
  pdf.setProperties({ title: 'ŞĞİı 😀 (\\)\nendobj', author: 'Yazar' });
  pdf.registerFont('regular', regular.toString('base64')); pdf.setFont('regular'); pdf.setFontSize(12);
  pdf.text('Türkçe: ç ğ ı İ ö ş ü ₺ 😀', 12, 30);
  pdf.link(10, 10, 20, 15, { url: 'https://example.com/a(b)?q=ş' });
  pdf.link(0, 0, 20, 20, { url: 'javascript:alert(1)' });
  pdf.addPage([100, 200]); pdf.text('İkinci', 5, 20);
  const bytes = Buffer.from(await (await pdf.output()).arrayBuffer());
  const text = bytes.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.7')); assert.ok(!text.includes('jsPDF'));
  assert.match(text, /\/Producer \(Htpo PDF 0\.1\.0\)/);
  assert.match(text, /\/MediaBox \[0 0 200 100\]/); assert.match(text, /\/MediaBox \[0 0 100 200\]/);
  assert.match(text, /\/Count 2/); assert.match(text, /\/Title <feff015e011e01300131/);
  assert.ok(text.includes('/URI (https://example.com/a\\(b\\)?q=%C5%9F)'));
  assert.ok(text.includes('/Rect [10 75 30 90]')); assert.ok(!text.includes('javascript:'));
  const decoded = streams(bytes).map(b => b.toString('latin1')).join('\n');
  assert.ok(decoded.includes('<d83dde00>')); assert.ok(decoded.includes('<0130>')); assert.ok(decoded.includes('<20ba>'));
  assert.ok(decoded.includes('1 0 0 -1 12 30 Tm')); assert.equal(pdf.missingGlyphs.size, 0);
});

test('TrueType subsets retain Turkish composite outlines and supplementary Unicode glyphs', () => {
  const original = new TrueTypeFont(regular), chars = [...'ÇĞİÖŞÜçğıöşü😀'].map(c => c.codePointAt(0)!);
  const { bytes, glyphs } = original.subset(chars), subset = new TrueTypeFont(bytes);
  assert.ok(bytes.length < regular.length / 5);
  for (const cp of chars) {
    assert.ok(original.glyph(cp) > 0); assert.ok(subset.glyph(cp) > 0);
    assert.equal(subset.width(subset.glyph(cp)), original.width(original.glyph(cp)));
  }
  assert.ok(glyphs.size > new Set(chars.map(cp => original.glyph(cp))).size + 1, 'Composite components must also be included.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0; for (let i = 0; i < bytes.length; i += 4) sum = (sum + data.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba, 'Complete sfnt checksum must match the TrueType specification.');
  // Check every directory entry against the actual table, independently of the subset parser.
  for (let i = 0; i < data.getUint16(4); i++) {
    const p = 12 + 16 * i, tag = Buffer.from(bytes.subarray(p, p + 4)).toString(), offset = data.getUint32(p + 8), size = data.getUint32(p + 12);
    const table = Buffer.alloc(Math.ceil(size / 4) * 4); table.set(bytes.subarray(offset, offset + size));
    if (tag === 'head') table.writeUInt32BE(0, 8);
    let value = 0; for (let j = 0; j < table.length; j += 4) value = (value + table.readUInt32BE(j)) >>> 0;
    assert.equal(value, data.getUint32(p + 4), `${tag} checksum`);
  }
});

test('cmap format 4 and format 12 agree on Turkish characters', () => {
  const bytes = Uint8Array.from(regular), view = new DataView(bytes.buffer);
  let offset = 0;
  for (let i = 0; i < view.getUint16(4); i++) { const p = 12 + i * 16; if (Buffer.from(bytes.subarray(p, p + 4)).toString() === 'cmap') offset = view.getUint32(p + 8); }
  assert.ok(offset);
  // Exclude the format 12 records, forcing the BMP-only Unicode subtable.
  for (let i = 0; i < view.getUint16(offset + 2); i++) {
    const p = offset + 4 + i * 8, table = offset + view.getUint32(p + 4);
    if (view.getUint16(table) === 12) view.setUint16(p, 9);
  }
  const bmp = new TrueTypeFont(bytes), unicode = new TrueTypeFont(regular);
  for (const char of 'ABCçğıİöşü₺') assert.equal(bmp.glyph(char.codePointAt(0)!), unicode.glyph(char.codePointAt(0)!));
  assert.equal(bmp.glyph(0x1f600), 0);
});

test('invalid fonts and non-finite PDF geometry fail explicitly', () => {
  assert.throws(() => new TrueTypeFont(new Uint8Array(12)), /TrueType/);
  assert.throws(() => new PdfWriter(NaN, 100), /dimensions/);
  const pdf = new PdfWriter(100, 100);
  assert.throws(() => pdf.line(0, 0, Infinity, 20), /finite/);
  assert.throws(() => pdf.restoreGraphicsState(), /Unbalanced/);
});

test('SVG paths preserve relative lines, quadratic controls, smooth curves and elliptical arc endpoints', () => {
  assert.deepEqual(svgPath('M10 10h20v20h-20z'), [
    { op: 'moveTo', args: [10, 10] }, { op: 'lineTo', args: [30, 10] }, { op: 'lineTo', args: [30, 30] }, { op: 'lineTo', args: [10, 30] }, { op: 'closePath', args: [] },
  ]);
  const q = svgPath('M0 0Q3 3 6 0T12 0');
  assert.deepEqual(q[1], { op: 'curveTo', args: [2, 2, 4, 2, 6, 0] });
  assert.deepEqual(q[2], { op: 'curveTo', args: [8, -2, 10, -2, 12, 0] });
  const a = svgPath('M0 0A10 10 0 0110 10');
  assert.ok(Math.abs(a.at(-1)!.args[4] - 10) < 1e-10); assert.ok(Math.abs(a.at(-1)!.args[5] - 10) < 1e-10);
  assert.deepEqual(svgPath('M0 0C1 2 3 4 5 6S7 8 9 10')[2], { op: 'curveTo', args: [7, 8, 7, 8, 9, 10] });
  for (const path of ['L0 0', 'M0', 'M0 0 R1 2', 'M0 0A1 1 0 2 0 1 1']) assert.throws(() => svgPath(path));
});
