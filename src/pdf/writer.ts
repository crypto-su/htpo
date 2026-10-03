import { ascii, base64Bytes, concat, decimal as n, deflate, hex16, pdfString, unicodeHex } from './binary';
import { TrueTypeFont } from './truetype';
import { jpegInfo } from './jpeg';

type Paint = 'F' | 'S' | 'DF' | null;
type Matrix = [number, number, number, number, number, number];
interface Font { name: string; bytes: Uint8Array; parsed?: TrueTypeFont; chars: Map<number, number> }
interface Page { width: number; height: number; commands: string[]; links: string[]; fonts: Set<string>; images: Set<string>; states: Set<string> }
interface ImageObject { name: string; ref: number }

/** The PDF subset Htpo needs: pages, paths, embedded Unicode fonts, images and URI links. */
export class PdfWriter {
  private objects: (Uint8Array | undefined)[] = [];
  private pages: Page[] = [];
  private page!: Page;
  private fonts = new Map<string, Font>();
  private font?: Font;
  private fontSize = 12;
  private textColor = '0 0 0';
  private graphics: { font?: Font; fontSize: number; textColor: string }[] = [];
  private images = new Map<string | HTMLImageElement | HTMLCanvasElement, ImageObject>();
  private states = new Map<string, { name: string; ref: number }>();
  private properties = { title: '', author: '', creator: 'Htpo 0.1.0' };
  readonly missingGlyphs = new Set<number>();

  constructor(width: number, height: number, private readonly maxCanvasPixels = 32_000_000) { this.addPage([width, height]); }
  private reserve(): number { this.objects.push(undefined); return this.objects.length; }
  private object(value: string): number { const id = this.reserve(); this.objects[id - 1] = ascii(value); return id; }
  private async stream(bytes: Uint8Array, dictionary = '', compress = true): Promise<number> {
    const compressed = compress && typeof CompressionStream !== 'undefined';
    const data = compressed ? await deflate(bytes) : bytes;
    const id = this.reserve();
    this.objects[id - 1] = concat([ascii(`<<${dictionary}${compressed ? ' /Filter /FlateDecode' : ''} /Length ${data.length}>>\nstream\n`), data, ascii('\nendstream')]);
    return id;
  }
  command(value: string): void { this.page.commands.push(value); }
  addPage(size: number[]): void {
    if (size.length !== 2 || size.some(v => !Number.isFinite(v) || v <= 0 || v > 14400)) throw new RangeError('PDF page dimensions must be between 0 and 14400 points.');
    if (this.graphics.length) throw new Error('Unbalanced PDF graphics state.');
    this.page = { width: size[0], height: size[1], commands: [], links: [], fonts: new Set(), images: new Set(), states: new Set() };
    this.pages.push(this.page);
    // All public drawing coordinates use the browser's top-left, y-down system.
    this.command(`1 0 0 -1 0 ${n(size[1])} cm`);
  }
  setProperties(properties: Partial<typeof this.properties>): void { Object.assign(this.properties, properties); }
  registerFont(id: string, data: string): void {
    this.fonts.set(id, { name: `F${this.fonts.size + 1}`, bytes: base64Bytes(data), chars: new Map() });
  }
  setFont(id: string): void {
    const font = this.fonts.get(id); if (!font) throw new Error(`Unregistered PDF font: ${id}`);
    this.font = font;
  }
  private currentFont(): Font & { parsed: TrueTypeFont } {
    if (!this.font) throw new Error('Select a PDF font before drawing text.');
    this.font.parsed ??= new TrueTypeFont(this.font.bytes);
    return this.font as Font & { parsed: TrueTypeFont };
  }
  setFontSize(size: number): void { this.fontSize = size; }
  getTextWidth(text: string): number {
    const { parsed } = this.currentFont();
    return Array.from(text).reduce((sum, char) => sum + parsed.width(parsed.glyph(char.codePointAt(0)!)), 0) * this.fontSize / 1000;
  }
  text(text: string, x: number, y: number, options: { horizontalScale?: number; baseline?: 'alphabetic' } = {}): void {
    if (!text) return;
    const font = this.currentFont(); let encoded = '';
    for (const char of text) {
      const cp = char.codePointAt(0)!;
      if (!font.chars.has(cp)) {
        if (font.chars.size >= 65535) throw new RangeError('A PDF font cannot encode more than 65535 distinct characters.');
        font.chars.set(cp, font.chars.size + 1);
      }
      if (font.parsed.glyph(cp) === 0) this.missingGlyphs.add(cp);
      encoded += hex16(font.chars.get(cp)!);
    }
    this.page.fonts.add(font.name);
    this.command(`BT /${font.name} ${n(this.fontSize)} Tf ${this.textColor} rg ${n((options.horizontalScale ?? 1) * 100)} Tz 1 0 0 -1 ${n(x)} ${n(y)} Tm <${encoded}> Tj ET`);
  }
  private color(r: number, g = r, b = r): string { return [r, g, b].map(c => n(Math.min(255, Math.max(0, c)) / 255)).join(' '); }
  setTextColor(r: number, g = r, b = r): void { this.textColor = this.color(r, g, b); }
  setFillColor(r: number, g = r, b = r): void { this.command(`${this.color(r, g, b)} rg`); }
  setDrawColor(r: number, g = r, b = r): void { this.command(`${this.color(r, g, b)} RG`); }
  setLineWidth(width: number): void { this.command(`${n(width)} w`); }
  setLineDashPattern(pattern: number[], phase: number): void { this.command(`[${pattern.map(n).join(' ')}] ${n(phase)} d`); }
  setOpacity(fill: number, stroke = fill): void {
    const key = `${n(Math.max(0, Math.min(1, fill)))} ${n(Math.max(0, Math.min(1, stroke)))}`;
    let state = this.states.get(key);
    if (!state) { const [ca, CA] = key.split(' '); state = { name: `GS${this.states.size + 1}`, ref: this.object(`<< /Type /ExtGState /ca ${ca} /CA ${CA} >>`) }; this.states.set(key, state); }
    this.page.states.add(state.name); this.command(`/${state.name} gs`);
  }
  saveGraphicsState(): void { this.graphics.push({ font: this.font, fontSize: this.fontSize, textColor: this.textColor }); this.command('q'); }
  restoreGraphicsState(): void {
    const state = this.graphics.pop(); if (!state) throw new Error('Unbalanced PDF graphics state.');
    this.font = state.font; this.fontSize = state.fontSize; this.textColor = state.textColor; this.command('Q');
  }
  transform(matrix: Matrix): void { this.command(`${matrix.map(n).join(' ')} cm`); }
  rect(x: number, y: number, width: number, height: number, paint: Paint = 'S'): void { this.command(`${[x, y, width, height].map(n).join(' ')} re`); this.paint(paint); }
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, paint: Paint): void {
    rx = Math.min(Math.abs(rx), w / 2); ry = Math.min(Math.abs(ry), h / 2); const k = .5522847498307936;
    this.moveTo(x + rx, y); this.lineTo(x + w - rx, y);
    this.curveTo(x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry); this.lineTo(x + w, y + h - ry);
    this.curveTo(x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h); this.lineTo(x + rx, y + h);
    this.curveTo(x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry); this.lineTo(x, y + ry);
    this.curveTo(x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y); this.closePath(); this.paint(paint);
  }
  moveTo(x: number, y: number): void { this.command(`${n(x)} ${n(y)} m`); }
  lineTo(x: number, y: number): void { this.command(`${n(x)} ${n(y)} l`); }
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void { this.command(`${[x1, y1, x2, y2, x, y].map(n).join(' ')} c`); }
  closePath(): void { this.command('h'); }
  paint(paint: Paint, evenOdd = false): void { if (paint) this.command(paint === 'F' ? (evenOdd ? 'f*' : 'f') : paint === 'DF' ? (evenOdd ? 'B*' : 'B') : 'S'); }
  line(x1: number, y1: number, x2: number, y2: number): void { this.moveTo(x1, y1); this.lineTo(x2, y2); this.paint('S'); }
  clip(evenOdd = false): void { this.command(evenOdd ? 'W*' : 'W'); }
  discardPath(): void { this.command('n'); }
  link(x: number, y: number, width: number, height: number, options: { url: string }): void {
    if (!/^(https?:|mailto:|tel:)/i.test(options.url)) return;
    // Annotation rectangles are in default page space, unaffected by content clipping.
    const left = Math.max(0, x), right = Math.min(this.page.width, x + width), top = Math.max(0, y), bottom = Math.min(this.page.height, y + height);
    if (right <= left || bottom <= top) return;
    const uri = options.url.replace(/[^\x21-\x7e]/gu, char => encodeURIComponent(char));
    this.page.links.push(`<< /Type /Annot /Subtype /Link /Rect [${[left, this.page.height - bottom, right, this.page.height - top].map(n).join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(uri)} >> >>`);
  }
  async addImage(source: HTMLImageElement | HTMLCanvasElement | string, x: number, y: number, width: number, height: number, alias?: string): Promise<void> {
    if (width <= 0 || height <= 0) return;
    const key = alias ? `alias:${alias}` : source;
    let image = this.images.get(key);
    if (!image) {
      let element: HTMLImageElement | HTMLCanvasElement;
      if (typeof source === 'string') { const img = new Image(); img.src = source; await img.decode(); element = img; } else element = source;
      const img = 'naturalWidth' in element ? element : undefined;
      const w = img ? img.naturalWidth : element.width, h = img ? img.naturalHeight : element.height;
      if (!w || !h) throw new Error('Cannot embed an empty PDF image.');
      const src = img ? img.currentSrc || img.src : '';
      let ref: number;
      // DCT streams are copied unchanged. Other formats use the browser's image decoder.
      const encoded = /^data:[^,]*;base64,/i.test(src) ? src.slice(src.indexOf(',') + 1) : '';
      // Some servers label PNG/WebP bytes as image/jpeg. Trust the signature, not the MIME.
      const jpegBytes = encoded.startsWith('/9j/') ? base64Bytes(encoded) : undefined;
      const jpeg = jpegBytes ? jpegInfo(jpegBytes) : undefined;
      if (jpeg && jpeg.components !== 4) {
        const space = jpeg.components === 1 ? '/DeviceGray' : '/DeviceRGB';
        ref = await this.stream(jpegBytes!, ` /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode`, false);
      } else {
        // Let the browser convert CMYK JPEGs; their inversion/color-transform conventions differ.
        if (w * h > this.maxCanvasPixels) throw new RangeError('Image exceeds maxCanvasPixels.');
        const canvas = img ? document.createElement('canvas') : element as HTMLCanvasElement;
        if (img) { canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0); }
        const rgba = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
        const rgb = new Uint8Array((w * 3 + 1) * h), alpha = new Uint8Array((w + 1) * h);
        let transparent = false;
        // PNG Sub predictor: near-flat report graphics compress well without a PNG library.
        for (let row = 0; row < h; row++) {
          const r = row * (w * 3 + 1), a = row * (w + 1); rgb[r] = alpha[a] = 1;
          for (let col = 0; col < w; col++) {
            const p = (row * w + col) * 4;
            for (let c = 0; c < 3; c++) rgb[r + 1 + col * 3 + c] = rgba[p + c] - (col ? rgba[p + c - 4] : 0);
            alpha[a + 1 + col] = rgba[p + 3] - (col ? rgba[p - 1] : 0); transparent ||= rgba[p + 3] !== 255;
          }
        }
        if (img) canvas.width = canvas.height = 0;
        const predictor = (colors: number) => ` /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${w} >>`;
        // Predictor streams require FlateDecode, so require the native codec for raster images.
        if (typeof CompressionStream === 'undefined') throw new Error('This browser needs CompressionStream support to embed PNG/WebP/canvas images.');
        const mask = transparent ? await this.stream(alpha, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8${predictor(1)}`) : 0;
        ref = await this.stream(rgb, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8${predictor(3)}${mask ? ` /SMask ${mask} 0 R` : ''}`);
      }
      image = { name: `Im${this.images.size + 1}`, ref }; this.images.set(key, image);
    }
    this.page.images.add(image.name);
    this.command(`q ${n(width)} 0 0 ${n(-height)} ${n(x)} ${n(y + height)} cm /${image.name} Do Q`);
  }
  private async embedFont(font: Font): Promise<number> {
    const parsed = font.parsed!, chars = [...font.chars.keys()], subset = parsed.subset(chars);
    const tag = font.name.slice(1).split('').map(c => String.fromCharCode(65 + Number(c))).join('').padStart(6, 'A');
    const name = `${tag}+Htpo${font.name}`;
    const file = await this.stream(subset.bytes, ` /Length1 ${subset.bytes.length}`);
    const scale = (v: number) => n(v * 1000 / parsed.unitsPerEm);
    const descriptor = this.object(`<< /Type /FontDescriptor /FontName /${name} /Flags ${32 | (parsed.italicAngle ? 64 : 0)} /FontBBox [${parsed.bbox.map(scale).join(' ')}] /ItalicAngle ${n(parsed.italicAngle)} /Ascent ${scale(parsed.ascent)} /Descent ${scale(parsed.descent)} /CapHeight ${scale(parsed.ascent)} /StemV 80 /FontFile2 ${file} 0 R >>`);
    const map = new Uint8Array((chars.length + 1) * 2), mapView = new DataView(map.buffer);
    chars.forEach((cp, i) => mapView.setUint16((i + 1) * 2, subset.glyphs.get(parsed.glyph(cp))!));
    const cidMap = await this.stream(map);
    const cid = this.object(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${cidMap} 0 R /DW 1000 /W [1 [${chars.map(cp => n(parsed.width(parsed.glyph(cp)))).join(' ')}]] >>`);
    const cmap = ['/CIDInit /ProcSet findresource begin', '12 dict begin begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /HtpoUnicode def /CMapType 2 def', '1 begincodespacerange <0000> <ffff> endcodespacerange'];
    for (let i = 0; i < chars.length; i += 100) {
      const batch = chars.slice(i, i + 100); cmap.push(`${batch.length} beginbfchar`);
      batch.forEach((cp, j) => cmap.push(`<${hex16(i + j + 1)}> <${unicodeHex(String.fromCodePoint(cp))}>`)); cmap.push('endbfchar');
    }
    cmap.push('endcmap CMapName currentdict /CMap defineresource pop end end');
    const unicode = await this.stream(ascii(cmap.join('\n')));
    return this.object(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${unicode} 0 R >>`);
  }
  async output(): Promise<Blob> {
    if (this.graphics.length) throw new Error('Unbalanced PDF graphics state.');
    const fontRefs = new Map<string, number>();
    for (const font of this.fonts.values()) if (font.chars.size) fontRefs.set(font.name, await this.embedFont(font));
    const pageTree = this.reserve(), kids: number[] = [];
    const dict = (refs: { name: string; ref: number }[], used: Set<string>) => refs.filter(r => used.has(r.name)).map(r => `/${r.name} ${r.ref} 0 R`).join(' ');
    for (const page of this.pages) {
      const contents = await this.stream(ascii(page.commands.join('\n')));
      const annotations = page.links.map(link => `${this.object(link)} 0 R`).join(' ');
      const resources = ` /Font <<${dict([...fontRefs].map(([name, ref]) => ({ name, ref })), page.fonts)}>> /XObject <<${dict([...this.images.values()], page.images)}>> /ExtGState <<${dict([...this.states.values()], page.states)}>>`;
      kids.push(this.object(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources <<${resources}>> /Contents ${contents} 0 R${annotations ? ` /Annots [${annotations}]` : ''} >>`));
    }
    this.objects[pageTree - 1] = ascii(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] >>`);
    const root = this.object(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
    const date = `D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
    const info = this.object(`<< /Producer (Htpo PDF 0.1.0) /Creator ${pdfString(this.properties.creator)} /Title ${pdfString(this.properties.title)} /Author ${pdfString(this.properties.author)} /CreationDate (${date}) >>`);
    const chunks = [ascii('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n')], offsets = [0]; let length = chunks[0].length;
    this.objects.forEach((object, i) => {
      if (!object) throw new Error(`Unwritten PDF object ${i + 1}.`);
      offsets.push(length);
      const start = ascii(`${i + 1} 0 obj\n`), end = ascii('\nendobj\n'); chunks.push(start, object, end); length += start.length + object.length + end.length;
    });
    const xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
    chunks.push(ascii(xref));
    return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
  }
}
