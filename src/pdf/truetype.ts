import { ascii, concat } from './binary';

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const align4 = (n: number) => (n + 3) & ~3;
function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + ((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0;
  return sum;
}

/** Static glyf-based TrueType fonts; no shaping engine or CFF/variable-font conversion. */
export class TrueTypeFont {
  private tables = new Map<string, Uint8Array>();
  private cmap: DataView;
  private locations: number[];
  readonly unitsPerEm: number;
  readonly glyphCount: number;
  readonly ascent: number;
  readonly descent: number;
  readonly bbox: number[];
  readonly italicAngle: number;
  constructor(bytes: Uint8Array) {
    const data = view(bytes);
    if (data.byteLength < 12 || ![0x00010000, 0x74727565].includes(data.getUint32(0))) throw new Error('PDF fonts must be static TrueType (.ttf) fonts with glyf outlines.');
    for (let i = 0; i < data.getUint16(4); i++) {
      const p = 12 + i * 16;
      const tag = String.fromCharCode(...bytes.subarray(p, p + 4));
      const offset = data.getUint32(p + 8), length = data.getUint32(p + 12);
      if (offset + length > bytes.length) throw new Error(`Truncated TrueType table: ${tag}`);
      this.tables.set(tag, bytes.subarray(offset, offset + length));
    }
    if (this.tables.has('fvar')) throw new Error('Variable fonts must be converted to static TrueType fonts before PDF export.');
    const head = view(this.table('head')), hhea = view(this.table('hhea'));
    this.unitsPerEm = head.getUint16(18);
    if (!this.unitsPerEm) throw new Error('Invalid TrueType unitsPerEm.');
    this.glyphCount = view(this.table('maxp')).getUint16(4);
    this.ascent = hhea.getInt16(4); this.descent = hhea.getInt16(6);
    this.bbox = [36, 38, 40, 42].map(p => head.getInt16(p));
    this.italicAngle = this.tables.has('post') ? view(this.table('post')).getInt32(4) / 65536 : 0;
    const loca = view(this.table('loca')), long = head.getInt16(50) === 1;
    this.locations = Array.from({ length: this.glyphCount + 1 }, (_, i) => long ? loca.getUint32(i * 4) : loca.getUint16(i * 2) * 2);
    const glyf = this.table('glyf');
    if (this.locations.some((n, i) => n > glyf.length || (i > 0 && n < this.locations[i - 1]))) throw new Error('Invalid TrueType glyph offsets.');
    const cmap = view(this.table('cmap'));
    const candidates: { offset: number; score: number }[] = [];
    for (let i = 0; i < cmap.getUint16(2); i++) {
      const p = 4 + i * 8, platform = cmap.getUint16(p), encoding = cmap.getUint16(p + 2), offset = cmap.getUint32(p + 4);
      const format = cmap.getUint16(offset);
      if ((platform === 0 || (platform === 3 && [1, 10].includes(encoding))) && [4, 12].includes(format)) candidates.push({ offset, score: format });
    }
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best) throw new Error('TrueType font has no supported Unicode cmap (format 4 or 12).');
    const length = cmap.getUint16(best.offset) === 12 ? cmap.getUint32(best.offset + 4) : cmap.getUint16(best.offset + 2);
    this.cmap = view(this.table('cmap').subarray(best.offset, best.offset + length));
  }
  private table(tag: string): Uint8Array {
    const bytes = this.tables.get(tag);
    if (!bytes) throw new Error(`TrueType font is missing ${tag}.`);
    return bytes;
  }
  glyph(codepoint: number): number {
    const c = this.cmap;
    let glyph = 0;
    if (c.getUint16(0) === 12) {
      let low = 0, high = c.getUint32(12) - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1, p = 16 + mid * 12;
        if (codepoint < c.getUint32(p)) high = mid - 1;
        else if (codepoint > c.getUint32(p + 4)) low = mid + 1;
        else { glyph = c.getUint32(p + 8) + codepoint - c.getUint32(p); break; }
      }
    } else if (codepoint <= 0xffff) {
      const count = c.getUint16(6) / 2;
      for (let i = 0; i < count; i++) {
        if (codepoint > c.getUint16(14 + i * 2)) continue;
        if (codepoint < c.getUint16(16 + count * 2 + i * 2)) break;
        const delta = c.getInt16(16 + count * 4 + i * 2), p = 16 + count * 6 + i * 2, offset = c.getUint16(p);
        if (!offset) glyph = (codepoint + delta) & 0xffff;
        else {
          glyph = c.getUint16(p + offset + 2 * (codepoint - c.getUint16(16 + count * 2 + i * 2)));
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        break;
      }
    }
    return glyph < this.glyphCount ? glyph : 0;
  }
  width(glyph: number): number { return this.metric(glyph)[0] * 1000 / this.unitsPerEm; }
  private metric(glyph: number): [number, number] {
    const n = view(this.table('hhea')).getUint16(34), hmtx = view(this.table('hmtx'));
    return [hmtx.getUint16(Math.min(glyph, n - 1) * 4), hmtx.getInt16(glyph < n ? glyph * 4 + 2 : n * 4 + (glyph - n) * 2)];
  }
  private glyphData(glyph: number): Uint8Array { return this.table('glyf').subarray(this.locations[glyph], this.locations[glyph + 1]); }
  private components(bytes: Uint8Array): number[] {
    if (!bytes.length || view(bytes).getInt16(0) >= 0) return [];
    const data = view(bytes), offsets: number[] = [];
    let p = 10, flags: number;
    do {
      flags = data.getUint16(p); offsets.push(p + 2);
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
      if (p > bytes.length) throw new Error('Truncated composite TrueType glyph.');
    } while (flags & 32);
    return offsets;
  }
  subset(codepoints: number[]): { bytes: Uint8Array; glyphs: Map<number, number> } {
    const glyphs = new Map<number, number>([[0, 0]]);
    for (const cp of codepoints) { const gid = this.glyph(cp); if (!glyphs.has(gid)) glyphs.set(gid, glyphs.size); }
    // Map iteration also visits appended components; each glyph is visited once.
    for (const gid of glyphs.keys()) {
      const bytes = this.glyphData(gid), data = view(bytes);
      for (const p of this.components(bytes)) {
        const child = data.getUint16(p);
        if (child >= this.glyphCount) throw new Error('Invalid composite TrueType glyph reference.');
        if (!glyphs.has(child)) glyphs.set(child, glyphs.size);
      }
    }
    const glyfParts: Uint8Array[] = [], loca = new Uint8Array((glyphs.size + 1) * 4), hmtx = new Uint8Array(glyphs.size * 4);
    let offset = 0;
    for (const [oldId, newId] of glyphs) {
      const original = this.glyphData(oldId), bytes = new Uint8Array(align4(original.length)); bytes.set(original);
      for (const p of this.components(bytes)) view(bytes).setUint16(p, glyphs.get(view(bytes).getUint16(p))!);
      view(loca).setUint32(newId * 4, offset); offset += bytes.length; glyfParts.push(bytes);
      const [advance, bearing] = this.metric(oldId); view(hmtx).setUint16(newId * 4, advance); view(hmtx).setInt16(newId * 4 + 2, bearing);
    }
    view(loca).setUint32(glyphs.size * 4, offset);
    const tables = new Map<string, Uint8Array>();
    for (const tag of ['head', 'hhea', 'maxp', 'name', 'OS/2', 'cvt ', 'fpgm', 'prep', 'gasp']) if (this.tables.has(tag)) tables.set(tag, Uint8Array.from(this.table(tag)));
    view(tables.get('head')!).setUint32(8, 0); view(tables.get('head')!).setInt16(50, 1);
    view(tables.get('hhea')!).setUint16(34, glyphs.size); view(tables.get('maxp')!).setUint16(4, glyphs.size);
    const post = new Uint8Array(32); if (this.tables.has('post')) post.set(this.table('post').subarray(0, 32)); view(post).setUint32(0, 0x00030000);
    const sorted = [...new Set(codepoints)].sort((a, b) => a - b), cmap = new Uint8Array(28 + sorted.length * 12), cv = view(cmap);
    cv.setUint16(2, 1); cv.setUint16(4, 3); cv.setUint16(6, 10); cv.setUint32(8, 12);
    cv.setUint16(12, 12); cv.setUint32(16, cmap.length - 12); cv.setUint32(24, sorted.length);
    sorted.forEach((cp, i) => { const p = 28 + i * 12; cv.setUint32(p, cp); cv.setUint32(p + 4, cp); cv.setUint32(p + 8, glyphs.get(this.glyph(cp))!); });
    tables.set('glyf', concat(glyfParts)); tables.set('loca', loca); tables.set('hmtx', hmtx); tables.set('cmap', cmap); tables.set('post', post);
    const tags = [...tables.keys()].sort(), power = 2 ** Math.floor(Math.log2(tags.length));
    const headerSize = 12 + tags.length * 16;
    const result = new Uint8Array(headerSize + tags.reduce((n, tag) => n + align4(tables.get(tag)!.length), 0)), rv = view(result);
    rv.setUint32(0, 0x00010000); rv.setUint16(4, tags.length); rv.setUint16(6, power * 16); rv.setUint16(8, Math.log2(power)); rv.setUint16(10, tags.length * 16 - power * 16);
    offset = headerSize; let headOffset = 0;
    tags.forEach((tag, i) => {
      const bytes = tables.get(tag)!, p = 12 + i * 16;
      result.set(ascii(tag), p); rv.setUint32(p + 4, checksum(bytes)); rv.setUint32(p + 8, offset); rv.setUint32(p + 12, bytes.length);
      result.set(bytes, offset); if (tag === 'head') headOffset = offset; offset += align4(bytes.length);
    });
    rv.setUint32(headOffset + 8, (0xb1b0afba - checksum(result)) >>> 0);
    return { bytes: result, glyphs };
  }
}
