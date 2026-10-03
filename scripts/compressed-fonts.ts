import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Compress the complete default fonts for transport; retain every glyph for browser layout. */
export function compressedFonts(): Plugin {
  return {
    name: 'htpo-compressed-fonts', enforce: 'pre',
    load(id) {
      if (!id.endsWith('.ttf?compressed-font')) return;
      const bytes = deflateSync(readFileSync(id.slice(0, -'?compressed-font'.length)), { level: 9 });
      return `export default ${JSON.stringify(`data:application/x-htpo-font-deflate;base64,${bytes.toString('base64')}`)};`;
    },
  };
}
