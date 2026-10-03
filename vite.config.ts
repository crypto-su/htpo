import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { compressedFonts } from './scripts/compressed-fonts';

export default defineConfig({
  plugins: [compressedFonts()],
  esbuild: { legalComments: 'inline' },
  build: {
    lib: { entry: 'src/index.ts', name: 'Htpo', fileName: 'htpo' },
    sourcemap: true,
    rollupOptions: { external: [], output: {
      banner: `/*! Htpo\n${readFileSync('LICENSE', 'utf8').replaceAll('*/', '* /')}*/`,
    } },
  },
});
