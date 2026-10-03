import type { PdfWriter } from './pdf/writer';
import regularUrl from '../assets/fonts/DejaVuSans.ttf?compressed-font';
import boldUrl from '../assets/fonts/DejaVuSans-Bold.ttf?compressed-font';
import { base64Bytes, inflate } from './pdf/binary';
import { bytesToBase64, Resources } from './resources';
import type { FontSource } from './types';

export interface LoadedFont { family: string; aliases: string[]; weight: number; style: string; data: string; id: string }
export const defaultFonts: FontSource[] = [
  { family: 'Htpo Sans', src: regularUrl, weight: 400 },
  { family: 'Htpo Sans', src: boldUrl, weight: 700 },
];

export async function loadFonts(fonts: FontSource[], resources: Resources): Promise<LoadedFont[]> {
  return Promise.all([...defaultFonts, ...fonts].map(async (font, index) => ({
    family: font.family, aliases: font.aliases ?? [], weight: font.weight ?? 400, style: font.style ?? 'normal',
    data: bytesToBase64(typeof font.src === 'string'
      ? font.src.startsWith('data:application/x-htpo-font-deflate;base64,')
        ? await decodeDefaultFont(font.src)
        : new Uint8Array(await (await resources.blob(new URL(font.src, location.href).href)).arrayBuffer())
      : font.src),
    id: `htpo-font-${index}`,
  })));
}

async function decodeDefaultFont(src: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Htpo requires a browser with DecompressionStream support to load its embedded fonts.');
  return inflate(base64Bytes(src.slice(src.indexOf(',') + 1)));
}

export function fontCss(fonts: LoadedFont[]): string {
  return fonts.flatMap(font => [font.family, ...font.aliases].map(family => `@font-face{font-family:${JSON.stringify(family)};src:url(data:font/ttf;base64,${font.data}) format('truetype');font-weight:${font.weight};font-style:${font.style};font-display:block;}`)).join('\n');
}

export function registerFonts(pdf: PdfWriter, fonts: LoadedFont[]) {
  for (const font of fonts) pdf.registerFont(font.id, font.data);
}

export function findFont(familyList: string, weight: string, style: string, fonts: LoadedFont[]): LoadedFont {
  const families = familyList.split(',').map(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase());
  let candidates: LoadedFont[] = [];
  for (const family of families) {
    candidates = fonts.filter(f => [f.family, ...f.aliases].some(name => name.toLowerCase() === family));
    if (candidates.length) break;
  }
  if (!candidates.length) candidates = fonts.filter(f => f.family === 'Htpo Sans');
  const target = parseInt(weight, 10) || (weight === 'bold' ? 700 : 400);
  return [...candidates].sort((a, b) => (Math.abs(a.weight - target) + (a.style === style ? 0 : 1000)) - (Math.abs(b.weight - target) + (b.style === style ? 0 : 1000)))[0];
}
